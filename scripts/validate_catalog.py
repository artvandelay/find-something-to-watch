#!/usr/bin/env python3
"""Validate the shape of a built OTT catalog JSON file."""

import argparse
import json
import re
import sys
from pathlib import Path

DOC_KEYS = {"schema", "meta", "records"}
META_KEYS = {"region", "source", "built_at", "count", "providers", "filters"}
FILTER_KEYS = {"min_year", "min_rating", "limit"}
RECORD_KEYS = ["id", "t", "y", "k", "rt", "s", "im", "r", "p", "u", "img"]
ID_RE = re.compile(r"[a-z0-9]+:[A-Za-z0-9_-]+")


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _validate_record(rec, i):
    prefix = "records[%d] (%s): " % (i, rec.get("id") if isinstance(rec, dict) else None)
    if not isinstance(rec, dict):
        return ["records[%d]: expected object, got %s" % (i, type(rec).__name__)]

    errors = []
    if list(rec.keys()) != RECORD_KEYS:
        errors.append(prefix + "keys must be exactly %r, got %r" % (RECORD_KEYS, list(rec.keys())))

    rid = rec.get("id")
    if not isinstance(rid, str) or not ID_RE.fullmatch(rid):
        errors.append(prefix + "id must match 'provider:key', got %r" % (rid,))

    title = rec.get("t")
    if not isinstance(title, str) or not title:
        errors.append(prefix + "t must be a non-empty string, got %r" % (title,))

    year = rec.get("y")
    if year is not None and not (_is_int(year) and 1900 <= year <= 2100):
        errors.append(prefix + "y must be null or int in 1900..2100, got %r" % (year,))

    kind = rec.get("k")
    if kind not in ("movie", "series"):
        errors.append(prefix + "k must be 'movie' or 'series', got %r" % (kind,))

    runtime = rec.get("rt")
    if runtime is not None and not (_is_int(runtime) and 1 <= runtime <= 600):
        errors.append(prefix + "rt must be null or int in 1..600, got %r" % (runtime,))

    synopsis = rec.get("s")
    if not isinstance(synopsis, str):
        errors.append(prefix + "s must be a string, got %r" % (synopsis,))

    imdb = rec.get("im")
    if imdb is not None and not (isinstance(imdb, str) and imdb.startswith("tt")):
        errors.append(prefix + "im must be null or a string starting with 'tt', got %r" % (imdb,))

    rating = rec.get("r")
    if rating is not None and not (_is_number(rating) and 0 < rating <= 10):
        errors.append(prefix + "r must be null or a number in (0, 10], got %r" % (rating,))

    providers = rec.get("p")
    if not isinstance(providers, list) or not providers or not all(isinstance(p, str) for p in providers):
        errors.append(prefix + "p must be a non-empty list of strings, got %r" % (providers,))
        providers = []

    urls = rec.get("u")
    if not isinstance(urls, dict):
        errors.append(prefix + "u must be an object, got %r" % (urls,))
    else:
        for key, value in urls.items():
            if key not in providers:
                errors.append(prefix + "u key %r is not listed in p" % (key,))
            if not isinstance(value, str) or not value.startswith("http"):
                errors.append(prefix + "u[%r] must be a URL starting with 'http', got %r" % (key, value))

    img = rec.get("img")
    if img is not None and not (isinstance(img, str) and img.startswith("http")):
        errors.append(prefix + "img must be null or a string starting with 'http', got %r" % (img,))

    return errors


def validate(doc) -> list[str]:
    if not isinstance(doc, dict):
        return ["top level must be an object, got %s" % type(doc).__name__]

    errors = []
    if set(doc.keys()) != DOC_KEYS:
        errors.append("top-level keys must be %r, got %r" % (sorted(DOC_KEYS), sorted(doc.keys())))

    if doc.get("schema") != 1:
        errors.append("schema must be 1, got %r" % (doc.get("schema"),))

    meta = doc.get("meta")
    if not isinstance(meta, dict):
        return errors + ["meta must be an object, got %s" % type(meta).__name__]

    if set(meta.keys()) != META_KEYS:
        errors.append("meta keys must be %r, got %r" % (sorted(META_KEYS), sorted(meta.keys())))

    filters = meta.get("filters")
    if not isinstance(filters, dict):
        errors.append("meta.filters must be an object, got %s" % type(filters).__name__)
    elif set(filters.keys()) != FILTER_KEYS:
        errors.append("meta.filters keys must be %r, got %r" % (sorted(FILTER_KEYS), sorted(filters.keys())))

    records = doc.get("records")
    if not isinstance(records, list):
        return errors + ["records must be a list, got %s" % type(records).__name__]

    count = meta.get("count")
    if count != len(records):
        errors.append("meta.count %r does not match len(records) %d" % (count, len(records)))

    providers = meta.get("providers")
    if not isinstance(providers, list) or not providers or not all(isinstance(p, str) for p in providers):
        errors.append("meta.providers must be a non-empty list of strings, got %r" % (providers,))

    for i, rec in enumerate(records):
        errors.extend(_validate_record(rec, i))

    seen = set()
    duplicates = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        rid = rec.get("id")
        if not isinstance(rid, str):
            continue
        if rid in seen and rid not in duplicates:
            duplicates.append(rid)
        seen.add(rid)
    if duplicates:
        errors.append("duplicate record ids (first 5): %r" % (duplicates[:5],))

    return errors


def main(argv):
    parser = argparse.ArgumentParser(description="Validate a built OTT catalog JSON file.")
    parser.add_argument("path", nargs="?", default="docs/assets/catalog.json")
    parser.add_argument("--max-errors", type=int, default=20)
    args = parser.parse_args(argv)

    path = Path(args.path)
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print("FAIL: file not found: %s" % path, file=sys.stderr)
        return 1
    except OSError as exc:
        print("FAIL: cannot read %s: %s" % (path, exc), file=sys.stderr)
        return 1
    except json.JSONDecodeError as exc:
        print("FAIL: invalid JSON in %s: %s" % (path, exc), file=sys.stderr)
        return 1

    errors = validate(doc)
    if not errors:
        records = doc["records"]
        providers = doc["meta"]["providers"]
        print("OK: %d records, schema 1, providers=%s" % (len(records), providers))
        return 0

    print("FAIL: %d error(s)" % len(errors), file=sys.stderr)
    for error in errors[: args.max_errors]:
        print(error, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
