#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime
import gzip
import html
import json
import re
import sys
from pathlib import Path

NETFLIX_TITLE_URL = "https://www.netflix.com/title/"

_ZERO_WIDTH_RE = re.compile("[\u200b\u200c\u200d\u2060\ufeff]")
_WHITESPACE_RE = re.compile(r"\s+")


def _clean_text(v: str) -> str:
    # Unescape first: &nbsp; and friends decode into characters we then normalize away.
    v = html.unescape(v)
    v = _ZERO_WIDTH_RE.sub("", v)
    v = v.replace("\u00a0", " ")
    return _WHITESPACE_RE.sub(" ", v).strip()


DEFAULT_SA_SERVICES = "netflix,prime,hotstar,zee5,sonyliv,apple,mubi,crunchyroll,curiosity"

# Preferred key order when picking the smallest-size image variant from an
# imageSet.*Poster dict (falls back to any other key if none of these exist).
_IMG_SIZE_PREFERENCE = ("w240", "w360", "w480", "w600")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Build the static search catalog from a dumped provider catalog")
    p.add_argument("--source", default="unogs", choices=["unogs", "streaming_availability"])
    p.add_argument("--input", default="data/unogs_catalog/IN_india.jsonl.gz")
    p.add_argument("--provider", default="netflix")
    p.add_argument("--region", default="IN")
    p.add_argument("--out", default="docs/assets/catalog.json")
    p.add_argument("--meta-out", default="docs/assets/catalog.meta.json")
    p.add_argument("--min-year", type=int, default=None)
    p.add_argument("--min-rating", type=float, default=None)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--sa-dir", default="data/streaming_availability")
    p.add_argument("--sa-services", default=DEFAULT_SA_SERVICES)
    return p


def normalize_unogs(row: dict, provider: str) -> dict | None:
    nid = row.get("netflixid")
    if nid is None or not str(nid).isdigit():
        return None

    t = _clean_text(row.get("title") or "")
    if not t:
        return None

    y: int | None
    try:
        y = int(row.get("year"))
    except (TypeError, ValueError):
        y = None
    if y is not None and not (1900 <= y <= 2100):
        y = None

    k = "movie" if row.get("type") == "movie" else "series"

    rt: int | None = None
    secs = row.get("runtime")
    try:
        secs_f = float(secs)
    except (TypeError, ValueError):
        secs_f = 0.0
    if secs_f > 0:
        mins = round(secs_f / 60)
        if 1 <= mins <= 600:
            rt = mins

    s = _clean_text(row.get("synopsis") or "")

    imdbid = row.get("imdbid")
    im = imdbid if isinstance(imdbid, str) and imdbid.startswith("tt") else None

    r: float | None
    try:
        r = float(row.get("imdbrating"))
    except (TypeError, ValueError):
        r = None
    if r is not None and not (0 < r <= 10):
        r = None

    p = [provider]
    u = {provider: NETFLIX_TITLE_URL + str(nid)}
    img = row.get("img") or row.get("poster") or None

    return {
        "id": provider + ":" + str(nid),
        "t": t,
        "y": y,
        "k": k,
        "rt": rt,
        "s": s,
        "im": im,
        "r": r,
        "p": p,
        "u": u,
        "img": img,
    }


def _smallest_image(image_set: dict) -> str | None:
    """Pick the smallest-size URL out of an imageSet.*Poster dict, preferring
    verticalPoster over horizontalPoster, else None."""
    if not isinstance(image_set, dict):
        return None

    for key in ("verticalPoster", "horizontalPoster"):
        variants = image_set.get(key)
        if not isinstance(variants, dict) or not variants:
            continue
        for size_key in _IMG_SIZE_PREFERENCE:
            url = variants.get(size_key)
            if isinstance(url, str) and url:
                return url
        for url in variants.values():
            if isinstance(url, str) and url:
                return url

    return None


def normalize_streaming_availability(row: dict, provider: str) -> dict | None:
    rid = row.get("id")
    if not rid:
        return None

    t = _clean_text(row.get("title") or "")
    if not t:
        return None

    y: int | None
    y_raw = row.get("releaseYear")
    if y_raw is None:
        y_raw = row.get("firstAirYear")
    try:
        y = int(y_raw)
    except (TypeError, ValueError):
        y = None
    if y is not None and not (1900 <= y <= 2100):
        y = None

    k = "movie" if row.get("showType") == "movie" else "series"

    rt: int | None = None
    if k == "movie":
        try:
            rt_raw = int(row.get("runtime"))
        except (TypeError, ValueError):
            rt_raw = None
        if rt_raw is not None and 1 <= rt_raw <= 600:
            rt = rt_raw

    s = _clean_text(row.get("overview") or "")

    imdbid = row.get("imdbId")
    im = imdbid if isinstance(imdbid, str) and imdbid.startswith("tt") else None

    r: float | None = None
    rating_raw = row.get("rating")
    if isinstance(rating_raw, (int, float)) and not isinstance(rating_raw, bool) and rating_raw > 0:
        r = round(rating_raw / 10.0, 1)
        if not (0 < r <= 10):
            r = None

    options = row.get("streamingOptions")
    matches = []
    if isinstance(options, dict):
        in_options = options.get("in")
        if isinstance(in_options, list):
            for entry in in_options:
                if not isinstance(entry, dict):
                    continue
                service = entry.get("service")
                if isinstance(service, dict) and service.get("id") == provider:
                    matches.append(entry)

    chosen = None
    for entry in matches:
        if entry.get("type") == "subscription":
            chosen = entry
            break
    if chosen is None and matches:
        chosen = matches[0]

    link = chosen.get("link") if chosen else None
    if not isinstance(link, str) or not link.startswith("http"):
        return None

    p = [provider]
    u = {provider: link}
    img = _smallest_image(row.get("imageSet"))

    return {
        "id": provider + ":" + str(rid),
        "t": t,
        "y": y,
        "k": k,
        "rt": rt,
        "s": s,
        "im": im,
        "r": r,
        "p": p,
        "u": u,
        "img": img,
    }


def _merge_records(rec, records, seen, skipped, args):
    if rec is None:
        return skipped + 1

    if args.min_year is not None and (rec["y"] is None or rec["y"] < args.min_year):
        return skipped + 1
    if args.min_rating is not None and (rec["r"] is None or rec["r"] < args.min_rating):
        return skipped + 1

    if rec["id"] in seen:
        return skipped + 1
    seen.add(rec["id"])
    records.append(rec)
    return skipped


def build(args) -> None:
    records: list[dict] = []
    seen: set[str] = set()
    skipped = 0

    if args.source == "streaming_availability":
        services = [s.strip() for s in args.sa_services.split(",") if s.strip()]
        for service in services:
            path = Path(args.sa_dir) / f"IN_{service}.jsonl.gz"
            with gzip.open(path, "rt", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        row = json.loads(line)
                    except Exception:
                        skipped += 1
                        continue
                    if not isinstance(row, dict):
                        skipped += 1
                        continue

                    rec = normalize_streaming_availability(row, service)
                    skipped = _merge_records(rec, records, seen, skipped, args)
    else:
        with gzip.open(args.input, "rt", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except Exception:
                    skipped += 1
                    continue
                if not isinstance(row, dict):
                    skipped += 1
                    continue

                rec = normalize_unogs(row, args.provider)
                skipped = _merge_records(rec, records, seen, skipped, args)

    records.sort(key=lambda rec: (rec["t"].lower(), rec["y"] or 0))

    if args.limit is not None:
        records = records[: args.limit]

    providers_list = sorted({p for rec in records for p in rec["p"]}) or [args.provider]

    built_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta = {
        "region": args.region,
        "source": args.source,
        "built_at": built_at,
        "count": len(records),
        "providers": providers_list,
        "filters": {
            "min_year": args.min_year,
            "min_rating": args.min_rating,
            "limit": args.limit,
        },
    }

    out_path = Path(args.out)
    meta_out_path = Path(args.meta_out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    meta_out_path.parent.mkdir(parents=True, exist_ok=True)

    with out_path.open("w", encoding="utf-8") as f:
        json.dump({"schema": 1, "meta": meta, "records": records}, f, ensure_ascii=False, separators=(",", ":"))

    with meta_out_path.open("w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"), indent=2)
        f.write("\n")

    size_kb = round(out_path.stat().st_size / 1024)
    print(f"built {len(records)} records -> {out_path} ({size_kb} KB), skipped {skipped}", file=sys.stderr)


def main(argv) -> int:
    args = build_parser().parse_args(argv)
    try:
        build(args)
    except OSError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
