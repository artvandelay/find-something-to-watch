#!/usr/bin/env python3
"""Fetch India OTT catalogs from the Streaming Availability API (movieofthenight).

Writes one gzipped JSON Lines file per service with the raw show objects exactly as
returned by the API. Normalization is deliberately left to a later step.

Quota is the binding constraint: each page costs one request and returns 20 shows, so
the script enforces a hard global request budget and degrades gracefully (writing
whatever it has collected) when the plan runs dry.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_BASE_URL = "https://streaming-availability.p.rapidapi.com"
DEFAULT_HOST_HEADER = "streaming-availability.p.rapidapi.com"
DEFAULT_SERVICES = "netflix,prime,hotstar,zee5,sonyliv,apple,mubi,crunchyroll,curiosity"

PAGE_SIZE_HINT = 20
QUOTA_SAFETY_MARGIN = 20

REMAINING_HEADERS = (
    "x-ratelimit-api-request-remaining",
    "x-ratelimit-requests-remaining",
)
LIMIT_HEADERS = (
    "x-ratelimit-api-request-limit",
    "x-ratelimit-requests-limit",
)

MAX_ATTEMPTS = 5
BACKOFF_CAP_S = 60.0


class CliError(RuntimeError):
    pass


class QuotaExhausted(RuntimeError):
    """Raised when the plan is out of requests (429 after retries, or remaining == 0)."""


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


def _quota_from_headers(headers: Any) -> dict[str, Any]:
    """Pull the RapidAPI quota counters out of a response's headers (case-insensitive)."""
    lowered: dict[str, str] = {}
    try:
        for k, v in headers.items():
            lowered[str(k).lower()] = str(v)
    except Exception:
        return {"remaining": None, "limit": None, "seen": {}}

    def _first_int(names: tuple[str, ...]) -> int | None:
        for name in names:
            raw = lowered.get(name)
            if raw is None:
                continue
            try:
                return int(str(raw).strip())
            except ValueError:
                continue
        return None

    ratelimit_headers = {k: v for k, v in lowered.items() if k.startswith("x-ratelimit")}
    return {
        # RapidAPI uses `x-ratelimit-<quota-name>-remaining`, and this listing's quota is
        # named "api-request"; keep the generic spelling as a fallback.
        "remaining": _first_int(REMAINING_HEADERS),
        "limit": _first_int(LIMIT_HEADERS),
        "seen": ratelimit_headers,
    }


class ApiClient:
    """Thin GET client that tracks request spend and the last-seen quota counters."""

    def __init__(self, *, base_url: str, rapidapi_key: str, max_requests: int, sleep_s: float) -> None:
        self._base_url = base_url.rstrip("/")
        self._key = rapidapi_key
        self.max_requests = max_requests
        self.sleep_s = sleep_s
        self.requests_used = 0
        self.quota_remaining: int | None = None
        self.quota_limit: int | None = None
        self.quota_exhausted = False
        self.last_ratelimit_headers: dict[str, str] = {}

    @property
    def budget_left(self) -> int:
        return max(0, self.max_requests - self.requests_used)

    def _request_once(self, path: str, params: dict[str, Any] | None) -> tuple[Any, dict[str, Any]]:
        qs = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
        url = f"{self._base_url}{path}"
        if qs:
            url = f"{url}?{qs}"

        req = urllib.request.Request(
            url,
            headers={
                "X-RapidAPI-Key": self._key,
                "X-RapidAPI-Host": DEFAULT_HOST_HEADER,
                "Accept": "application/json",
                "User-Agent": "find-something-to-watch/streaming-availability-fetch",
            },
            method="GET",
        )
        self.requests_used += 1
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                quota = _quota_from_headers(resp.headers)
                raw = resp.read().decode("utf-8", errors="replace")
                return json.loads(raw), quota
        except urllib.error.HTTPError as e:
            quota = _quota_from_headers(getattr(e, "headers", {}) or {})
            self._record_quota(quota)
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            raise CliError(f"HTTP {e.code} for {path}: {body[:300]}") from e
        except urllib.error.URLError as e:
            raise CliError(f"Network error calling {path}: {e}") from e
        except json.JSONDecodeError as e:
            raise CliError(f"Non-JSON response calling {path}: {e}") from e

    def _record_quota(self, quota: dict[str, Any]) -> None:
        if quota.get("remaining") is not None:
            self.quota_remaining = quota["remaining"]
        if quota.get("limit") is not None:
            self.quota_limit = quota["limit"]
        if quota.get("seen"):
            self.last_ratelimit_headers = dict(quota["seen"])

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        if self.quota_exhausted:
            raise QuotaExhausted("quota already reported exhausted")
        if self.budget_left <= 0:
            raise QuotaExhausted(f"request budget of {self.max_requests} spent")
        if self.quota_remaining is not None and self.quota_remaining <= 0:
            self.quota_exhausted = True
            raise QuotaExhausted("plan reports 0 requests remaining")

        attempt = 0
        while True:
            try:
                payload, quota = self._request_once(path, params)
                self._record_quota(quota)
                return payload
            except CliError as e:
                msg = str(e)
                if "HTTP 401" in msg or "HTTP 403" in msg:
                    raise
                is_429 = "HTTP 429" in msg
                is_5xx = any(f"HTTP 5{d}" in msg for d in ("0", "1", "2", "3"))
                if not (is_429 or is_5xx) or attempt >= MAX_ATTEMPTS - 1:
                    if is_429:
                        self.quota_exhausted = True
                        raise QuotaExhausted("repeated HTTP 429 — treating quota as exhausted") from e
                    raise
                delay = min(BACKOFF_CAP_S, (2.0**attempt) + 0.25)
                print(f"  retrying after error: {msg[:160]} (sleep {delay:.1f}s)", file=sys.stderr)
                time.sleep(delay)
                attempt += 1
                if self.budget_left <= 0:
                    raise QuotaExhausted(f"request budget of {self.max_requests} spent during retries") from e


def apply_quota_guardrail(client: ApiClient) -> None:
    """Shrink the budget when the plan reports fewer requests left than we planned to spend."""
    remaining = client.quota_remaining
    if remaining is None:
        return
    if remaining <= 0:
        client.quota_exhausted = True
        client.max_requests = client.requests_used
        print("quota: 0 requests remaining — nothing further will be fetched.", file=sys.stderr)
        return
    allowed = client.requests_used + max(0, remaining - QUOTA_SAFETY_MARGIN)
    if allowed < client.max_requests:
        print(
            f"quota: only {remaining} requests remaining — shrinking budget from "
            f"{client.max_requests} to {allowed} (safety margin {QUOTA_SAFETY_MARGIN}).",
            file=sys.stderr,
        )
        client.max_requests = allowed


def probe(client: ApiClient, country: str) -> int:
    payload = client.get(f"/countries/{urllib.parse.quote(country)}")
    services: list[str] = []
    if isinstance(payload, dict):
        raw_services = payload.get("services")
        if isinstance(raw_services, dict):
            services = sorted(str(k) for k in raw_services.keys())
        elif isinstance(raw_services, list):
            for s in raw_services:
                if isinstance(s, dict) and s.get("id"):
                    services.append(str(s["id"]))
            services = sorted(services)

    print(f"probe: country={country} services={len(services)}", file=sys.stderr)
    print("  " + (", ".join(services) if services else "(none parsed)"), file=sys.stderr)
    print(f"  requests used: {client.requests_used}", file=sys.stderr)
    print(f"  quota remaining: {client.quota_remaining if client.quota_remaining is not None else 'unknown'}", file=sys.stderr)
    print(f"  quota limit: {client.quota_limit if client.quota_limit is not None else 'unknown'}", file=sys.stderr)
    if client.last_ratelimit_headers:
        print(
            "  rate-limit headers seen: "
            + ", ".join(f"{k}={v}" for k, v in sorted(client.last_ratelimit_headers.items())),
            file=sys.stderr,
        )
    else:
        print("  rate-limit headers seen: (none returned by the API)", file=sys.stderr)
    return 0


def fetch_service(
    *,
    client: ApiClient,
    service: str,
    country: str,
    order_by: str,
    out_dir: Path,
    max_pages: int,
) -> dict[str, Any]:
    cc = country.upper()
    out_path = out_dir / f"{cc}_{service}.jsonl.gz"
    tmp_path = out_path.with_name(out_path.name + ".partial")
    manifest_path = out_dir / f"{cc}_{service}.manifest.json"

    fetched_at = dt.datetime.now(dt.timezone.utc).isoformat()
    started_requests = client.requests_used

    cursor: str | None = None
    pages = 0
    wrote = 0
    has_more = False
    stop_reason = "exhausted_catalog"
    rows_for_analysis: list[dict[str, Any]] = []

    with gzip.open(tmp_path, "wt", encoding="utf-8") as f:
        while pages < max_pages:
            if client.budget_left <= 0:
                stop_reason = "global_budget"
                has_more = True
                break
            params: dict[str, Any] = {
                "country": country,
                "catalogs": service,
                "order_by": order_by,
            }
            if cursor:
                params["cursor"] = cursor
            try:
                payload = client.get("/shows/search/filters", params)
            except QuotaExhausted as e:
                stop_reason = f"quota:{e}"
                has_more = True
                break

            if not isinstance(payload, dict):
                stop_reason = "unexpected_payload"
                break

            shows = payload.get("shows")
            rows = [r for r in shows if isinstance(r, dict)] if isinstance(shows, list) else []
            pages += 1
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
                wrote += 1
                rows_for_analysis.append(r)

            has_more = bool(payload.get("hasMore"))
            cursor = payload.get("nextCursor") if isinstance(payload.get("nextCursor"), str) else None
            if not rows:
                stop_reason = "empty_page"
                break
            if not has_more or not cursor:
                stop_reason = "exhausted_catalog"
                has_more = False
                break
            if pages >= max_pages:
                stop_reason = "page_cap"
                break
            time.sleep(client.sleep_s)

    tmp_path.replace(out_path)
    requests_used = client.requests_used - started_requests

    manifest = {
        "service": service,
        "country": country,
        "order_by": order_by,
        "pages_fetched": pages,
        "rows_written": wrote,
        "has_more_remaining": bool(has_more),
        "fetched_at_utc": fetched_at,
        "requests_used": requests_used,
        "stop_reason": stop_reason,
        "output": {"path": str(out_path), "format": "jsonl.gz"},
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        f"[{service}] pages={pages} rows={wrote} has_more={bool(has_more)} "
        f"requests={requests_used} budget_left={client.budget_left} stop={stop_reason}",
        file=sys.stderr,
    )
    manifest["_rows"] = rows_for_analysis
    return manifest


def observed_service_ids(rows: list[dict[str, Any]], country: str) -> set[str]:
    seen: set[str] = set()
    for row in rows:
        opts = row.get("streamingOptions")
        if not isinstance(opts, dict):
            continue
        for opt in opts.get(country) or []:
            if not isinstance(opt, dict):
                continue
            svc = opt.get("service")
            if isinstance(svc, dict) and svc.get("id"):
                seen.add(str(svc["id"]))
    return seen


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Fetch India OTT catalogs from the Streaming Availability API")
    p.add_argument("--base-url", default=DEFAULT_BASE_URL)
    p.add_argument("--services", default=DEFAULT_SERVICES, help="Comma-separated service ids")
    p.add_argument("--country", default="in")
    p.add_argument("--order-by", default="popularity_1year")
    p.add_argument("--out-dir", default="data/streaming_availability")
    p.add_argument("--max-pages-per-service", type=int, default=15, help="20 titles per page")
    p.add_argument("--max-requests", type=int, default=300, help="Hard global request budget")
    p.add_argument("--sleep", type=float, default=0.4, help="Sleep between requests (seconds)")
    p.add_argument(
        "--probe",
        action="store_true",
        help="Spend exactly one request on /countries/<country>, print services + quota, write nothing",
    )
    return p


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    try:
        key = load_rapidapi_key()
    except CliError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    client = ApiClient(
        base_url=args.base_url,
        rapidapi_key=key,
        max_requests=max(0, args.max_requests),
        sleep_s=args.sleep,
    )

    if args.probe:
        try:
            return probe(client, args.country)
        except QuotaExhausted as e:
            print(f"quota exhausted before probe: {e}", file=sys.stderr)
            return 0
        except CliError as e:
            msg = str(e)
            if "HTTP 401" in msg or "HTTP 403" in msg:
                print(f"error: key lacks access to {DEFAULT_HOST_HEADER} ({msg[:200]})", file=sys.stderr)
                return 3
            print(f"error: {e}", file=sys.stderr)
            return 2

    services = [s.strip() for s in args.services.split(",") if s.strip()]
    if not services:
        print("error: no services requested", file=sys.stderr)
        return 2

    out_dir = Path(args.out_dir)
    if not out_dir.is_absolute():
        out_dir = (find_project_root_env().parent / out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    # First real request doubles as the quota check, so pay for it up front on a
    # cheap endpoint and shrink the budget before spending it on catalog pages.
    try:
        client.get(f"/countries/{urllib.parse.quote(args.country)}")
    except QuotaExhausted as e:
        print(f"quota exhausted immediately: {e} — nothing fetched.", file=sys.stderr)
        return 0
    except CliError as e:
        msg = str(e)
        if "HTTP 401" in msg or "HTTP 403" in msg:
            print(f"error: key lacks access to {DEFAULT_HOST_HEADER} ({msg[:200]})", file=sys.stderr)
            return 3
        print(f"error: {e}", file=sys.stderr)
        return 2

    print(
        f"quota: remaining={client.quota_remaining if client.quota_remaining is not None else 'unknown'} "
        f"limit={client.quota_limit if client.quota_limit is not None else 'unknown'}",
        file=sys.stderr,
    )
    apply_quota_guardrail(client)

    # Breadth beats depth: never let the earlier services eat the whole budget.
    per_service_cap = args.max_pages_per_service
    if client.budget_left > 0:
        fair_share = client.budget_left // len(services)
        if fair_share < per_service_cap:
            per_service_cap = max(1, fair_share)
            print(
                f"budget: {client.budget_left} requests across {len(services)} services — "
                f"capping at {per_service_cap} page(s) per service for breadth.",
                file=sys.stderr,
            )

    manifests: list[dict[str, Any]] = []
    all_rows: list[dict[str, Any]] = []
    for service in services:
        if client.budget_left <= 0 or client.quota_exhausted:
            print(f"[{service}] skipped — request budget spent.", file=sys.stderr)
            continue
        m = fetch_service(
            client=client,
            service=service,
            country=args.country,
            order_by=args.order_by,
            out_dir=out_dir,
            max_pages=per_service_cap,
        )
        all_rows.extend(m.pop("_rows"))
        manifests.append(m)
        time.sleep(client.sleep_s)

    summary = {
        "country": args.country,
        "order_by": args.order_by,
        "services_requested": services,
        "max_requests": args.max_requests,
        "max_pages_per_service_effective": per_service_cap,
        "requests_used_total": client.requests_used,
        "quota_remaining_at_end": client.quota_remaining,
        "quota_limit": client.quota_limit,
        "quota_exhausted": client.quota_exhausted,
        "fetched_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "rows_by_service": {m["service"]: m["rows_written"] for m in manifests},
        "pages_by_service": {m["service"]: m["pages_fetched"] for m in manifests},
        "has_more_remaining_by_service": {m["service"]: m["has_more_remaining"] for m in manifests},
        "observed_streaming_service_ids": sorted(observed_service_ids(all_rows, args.country)),
        "distinct_show_ids": len({str(r.get("id")) for r in all_rows if r.get("id") is not None}),
    }
    (out_dir / "_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        f"done: {client.requests_used} requests used, {sum(summary['rows_by_service'].values())} rows written, "
        f"{summary['distinct_show_ids']} distinct show ids, quota_remaining="
        f"{client.quota_remaining if client.quota_remaining is not None else 'unknown'}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
