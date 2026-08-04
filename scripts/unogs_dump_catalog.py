#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_BASE_URL = "https://unogsng.p.rapidapi.com"
DEFAULT_HOST_HEADER = "unogsng.p.rapidapi.com"


class CliError(RuntimeError):
    pass


def _read_env_file(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.exists():
        return data
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k:
            data[k] = v
    return data


def find_project_root_env(start: Path | None = None) -> Path:
    cur = (start or Path.cwd()).resolve()
    for p in [cur, *cur.parents]:
        candidate = p / ".env"
        if candidate.exists():
            return candidate
    raise CliError("Could not find a `.env` in this directory or any parent directory.")


def load_rapidapi_key() -> str:
    env_path = find_project_root_env()
    env = _read_env_file(env_path)
    key = env.get("RAPIDAPI") or os.environ.get("RAPIDAPI")
    if not key:
        raise CliError(f"Missing RAPIDAPI key. Expected `RAPIDAPI=...` in {env_path}.")
    return key


def _http_get_json(
    *,
    base_url: str,
    path: str,
    params: dict[str, Any] | None,
    rapidapi_key: str,
    timeout_s: int = 45,
) -> Any:
    qs = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
    url = f"{base_url}{path}"
    if qs:
        url = f"{url}?{qs}"

    req = urllib.request.Request(
        url,
        headers={
            "X-RapidAPI-Key": rapidapi_key,
            "X-RapidAPI-Host": DEFAULT_HOST_HEADER,
            "Accept": "application/json",
            "User-Agent": "llm-search-netflix/unogs-dump",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        raise CliError(f"HTTP {e.code} for {path}: {body[:500]}") from e
    except urllib.error.URLError as e:
        raise CliError(f"Network error calling {path}: {e}") from e
    except json.JSONDecodeError as e:
        raise CliError(f"Non-JSON response calling {path}: {e}") from e


def _as_list(x: Any) -> list[Any]:
    if x is None:
        return []
    if isinstance(x, list):
        return x
    if isinstance(x, dict):
        for k in ("results", "Result", "items", "data"):
            if k in x and isinstance(x[k], list):
                return x[k]
    return []


@dataclass(frozen=True)
class Country:
    id: int
    name: str
    code: str | None = None


def _norm(s: str) -> str:
    return "".join(ch.lower() for ch in s.strip() if ch.isalnum() or ch.isspace()).strip()


def get_countries(*, base_url: str, rapidapi_key: str) -> list[Country]:
    payload = _http_get_json(base_url=base_url, path="/countries", params=None, rapidapi_key=rapidapi_key)
    countries: list[Country] = []
    for row in _as_list(payload):
        if not isinstance(row, dict):
            continue
        cid = row.get("id") or row.get("countryid") or row.get("country_id")
        name = row.get("country") or row.get("name")
        code = row.get("countrycode") or row.get("code") or row.get("country_code")
        try:
            if cid is not None and name:
                countries.append(Country(id=int(cid), name=str(name), code=str(code) if code else None))
        except Exception:
            continue
    if not countries:
        raise CliError("Could not parse `/countries` response (no countries found).")
    return countries


def match_country(countries: list[Country], country_query: str) -> Country:
    q = _norm(country_query)
    for c in countries:
        if _norm(c.name) == q:
            return c
    for c in countries:
        if c.code and _norm(c.code) == q:
            return c
    hits = [c for c in countries if q and q in _norm(c.name)]
    if len(hits) == 1:
        return hits[0]
    if hits:
        return sorted(hits, key=lambda c: len(c.name))[0]
    raise CliError(f"Unknown country: {country_query!r}.")


def _search_page(
    *,
    base_url: str,
    rapidapi_key: str,
    country_id: int,
    limit: int,
    offset: int,
    orderby: str,
) -> dict[str, Any]:
    payload = _http_get_json(
        base_url=base_url,
        path="/search",
        params={
            "query": "",
            "countrylist": str(country_id),
            "limit": int(limit),
            "offset": int(offset),
            "orderby": orderby,
        },
        rapidapi_key=rapidapi_key,
    )
    if not isinstance(payload, dict):
        raise CliError("Unexpected /search response type (expected JSON object).")
    return payload


def _canonicalize_title(row: dict[str, Any]) -> dict[str, Any]:
    netflixid = row.get("nfid") or row.get("netflixid") or row.get("id")
    return {
        "netflixid": int(netflixid) if netflixid is not None and str(netflixid).isdigit() else netflixid,
        "title": row.get("title") or row.get("name"),
        "type": row.get("vtype") or row.get("type"),
        "year": row.get("year") or row.get("released") or row.get("filmyear"),
        "titledate": row.get("titledate") or row.get("date"),
        "runtime": row.get("runtime"),
        "imdbid": row.get("imdbid"),
        "imdbrating": row.get("imdbrating") or row.get("imdb_rating") or row.get("rating"),
        "synopsis": row.get("synopsis"),
        "img": row.get("img"),
        "poster": row.get("poster"),
        "clist": row.get("clist"),
        "raw": row,
    }


def dump_country_catalog(
    *,
    base_url: str,
    rapidapi_key: str,
    country: Country,
    out_dir: Path,
    limit: int = 100,
    orderby: str = "title",
    sleep_s: float = 0.35,
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = "_".join(_norm(country.name).split()) or "country"
    cc = (country.code or "XX").upper()
    out_path = out_dir / f"{cc}_{slug}.jsonl.gz"
    tmp_path = out_path.with_suffix(out_path.suffix + ".partial")
    manifest_path = out_dir / f"{cc}_{slug}.manifest.json"

    start = time.time()
    fetched_at = dt.datetime.now(dt.timezone.utc).isoformat()

    offset = 0
    total: int | None = None
    wrote = 0

    with gzip.open(tmp_path, "wt", encoding="utf-8") as f:
        while True:
            # Basic backoff for intermittent 429s/5xx
            attempt = 0
            while True:
                try:
                    payload = _search_page(
                        base_url=base_url,
                        rapidapi_key=rapidapi_key,
                        country_id=country.id,
                        limit=limit,
                        offset=offset,
                        orderby=orderby,
                    )
                    break
                except CliError as e:
                    msg = str(e)
                    is_retryable = ("HTTP 429" in msg) or ("HTTP 5" in msg)
                    if not is_retryable or attempt >= 8:
                        raise
                    delay = min(60.0, (2.0**attempt) + 0.25)
                    print(f"[{country.name}] retrying after error: {msg} (sleep {delay:.1f}s)", file=sys.stderr)
                    time.sleep(delay)
                    attempt += 1

            if total is None:
                try:
                    total = int(payload.get("total")) if payload.get("total") is not None else None
                except Exception:
                    total = None

            rows = [r for r in _as_list(payload) if isinstance(r, dict)]
            if not rows:
                break

            for r in rows:
                f.write(json.dumps(_canonicalize_title(r), ensure_ascii=False) + "\n")
                wrote += 1

            offset += len(rows)
            print(
                f"[{country.name}] fetched {offset}"
                + (f"/{total}" if total is not None else "")
                + f" (last page {len(rows)})",
                file=sys.stderr,
            )
            if total is not None and offset >= total:
                break
            time.sleep(sleep_s)

    tmp_path.replace(out_path)

    manifest = {
        "country": {"id": country.id, "name": country.name, "code": country.code},
        "request": {"query": "", "limit": limit, "orderby": orderby},
        "stats": {
            "total_reported": total,
            "rows_written": wrote,
            "elapsed_s": round(time.time() - start, 3),
            "fetched_at_utc": fetched_at,
        },
        "output": {"path": str(out_path), "format": "jsonl.gz"},
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out_path


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Dump full uNoGS country catalogs for offline search")
    p.add_argument("--base-url", default=DEFAULT_BASE_URL)
    p.add_argument(
        "--country",
        action="append",
        dest="countries",
        help="Country name/code as shown by /countries. Repeatable. Example: --country India --country US",
        required=True,
    )
    p.add_argument("--out-dir", default="data/unogs_catalog", help="Output directory (relative to repo root)")
    p.add_argument("--limit", type=int, default=100, help="Page size (uNoGSNG appears to cap at 100)")
    p.add_argument("--orderby", default="title", help="Sort order for stable paging (default: title)")
    p.add_argument("--sleep", type=float, default=0.35, help="Sleep between requests (seconds)")
    return p


def main(argv: list[str]) -> int:
    try:
        args = build_parser().parse_args(argv)
        key = load_rapidapi_key()
        countries = get_countries(base_url=args.base_url, rapidapi_key=key)

        out_dir = Path(args.out_dir).resolve()
        out_dir.mkdir(parents=True, exist_ok=True)

        # Dump each requested country (continue on unknowns)
        for cq in args.countries:
            try:
                c = match_country(countries, cq)
            except CliError as e:
                print(f"error: {e} (skipping)", file=sys.stderr)
                # Suggestions
                q = _norm(cq)
                suggestions = [c for c in countries if q and (q in _norm(c.name) or (c.code and q == _norm(c.code)))]
                if suggestions:
                    print(
                        "  suggestions: "
                        + ", ".join(f"{s.name}{' (' + s.code + ')' if s.code else ''}" for s in suggestions[:10]),
                        file=sys.stderr,
                    )
                continue

            dump_country_catalog(
                base_url=args.base_url,
                rapidapi_key=key,
                country=c,
                out_dir=out_dir,
                limit=args.limit,
                orderby=args.orderby,
                sleep_s=args.sleep,
            )
        return 0
    except CliError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

