#!/usr/bin/env python3
"""Validate the shape of a built OTT catalog JSON file."""

import argparse
import json
import re
import sys
from pathlib import Path

DOC_KEYS = {"schema", "meta", "records"}
META_KEYS = {
    "region",
    "source",
    "built_at",
    "count",
    "providers",
    "provider_order",
    "languages",
    "genres",
    "text_file",
    "filters",
}
FILTER_KEYS = {"min_year", "min_rating", "limit"}
RECORD_KEYS = ["id", "t", "y", "k", "rt", "s", "im", "r", "p", "u", "img", "l", "g", "v"]
TEXT_KEYS = {"schema", "count", "s"}
ID_RE = re.compile(r"(?:tmdb:[mt]|netflix:)\d+")

DEFAULT_CATALOG = "docs/assets/catalog.json"


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
        errors.append(prefix + "id must match 'tmdb:m<n>', 'tmdb:t<n>' or 'netflix:<n>', got %r" % (rid,))

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
    if synopsis != "":
        errors.append(prefix + "s must be exactly '' in catalog.json, got %r" % (synopsis,))

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
    if img is not None and not (isinstance(img, str) and img.startswith("https://image.tmdb.org/t/p/w185")):
        errors.append(prefix + "img must be null or a w185 TMDB https URL, got %r" % (img,))

    language = rec.get("l")
    if language is not None and not isinstance(language, str):
        errors.append(prefix + "l must be null or a string, got %r" % (language,))

    genres = rec.get("g")
    if not isinstance(genres, list) or not all(isinstance(g, str) for g in genres):
        errors.append(prefix + "g must be a list of strings, got %r" % (genres,))

    votes = rec.get("v")
    if not (_is_int(votes) and votes >= 0):
        errors.append(prefix + "v must be an integer >= 0, got %r" % (votes,))
    elif img is not None and votes < 10:
        errors.append(prefix + "img must be null when v < 10")

    return errors


def validate(doc) -> list[str]:
    if not isinstance(doc, dict):
        return ["top level must be an object, got %s" % type(doc).__name__]

    errors = []
    if set(doc.keys()) != DOC_KEYS:
        errors.append("top-level keys must be %r, got %r" % (sorted(DOC_KEYS), sorted(doc.keys())))

    if doc.get("schema") != 2:
        errors.append("schema must be 2, got %r" % (doc.get("schema"),))

    meta = doc.get("meta")
    if not isinstance(meta, dict):
        return errors + ["meta must be an object, got %s" % type(meta).__name__]

    if set(meta.keys()) != META_KEYS:
        errors.append("meta keys must be %r, got %r" % (sorted(META_KEYS), sorted(meta.keys())))

    for key in ("region", "source", "built_at", "text_file"):
        if not isinstance(meta.get(key), str) or not meta.get(key):
            errors.append("meta.%s must be a non-empty string, got %r" % (key, meta.get(key)))

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

    provider_order = meta.get("provider_order")
    if not isinstance(provider_order, list) or not all(isinstance(p, str) for p in provider_order):
        errors.append("meta.provider_order must be a list of strings, got %r" % (provider_order,))
    elif isinstance(providers, list) and set(provider_order) != set(providers):
        errors.append("meta.provider_order must contain the same slugs as meta.providers")

    for key in ("languages", "genres"):
        value = meta.get(key)
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            errors.append("meta.%s must be a list of strings, got %r" % (key, value))

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


def validate_text(doc, catalog_ids=None) -> list[str]:
    if not isinstance(doc, dict):
        return ["top level must be an object, got %s" % type(doc).__name__]

    errors = []
    if set(doc.keys()) != TEXT_KEYS:
        errors.append("top-level keys must be %r, got %r" % (sorted(TEXT_KEYS), sorted(doc.keys())))

    if doc.get("schema") != 2:
        errors.append("schema must be 2, got %r" % (doc.get("schema"),))

    texts = doc.get("s")
    if not isinstance(texts, dict):
        return errors + ["s must be an object, got %s" % type(texts).__name__]

    count = doc.get("count")
    if count != len(texts):
        errors.append("count %r does not match len(s) %d" % (count, len(texts)))

    for key, value in texts.items():
        if not ID_RE.fullmatch(key):
            errors.append("s key %r must match 'tmdb:m<n>', 'tmdb:t<n>' or 'netflix:<n>'" % (key,))
        if not isinstance(value, str) or not value:
            errors.append("s[%r] must be a non-empty string, got %r" % (key, value))
        if catalog_ids is not None and key not in catalog_ids:
            errors.append("s key %r is not an id present in the catalog" % (key,))

    return errors


def _load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except FileNotFoundError:
        return None, "file not found: %s" % path
    except OSError as exc:
        return None, "cannot read %s: %s" % (path, exc)
    except json.JSONDecodeError as exc:
        return None, "invalid JSON in %s: %s" % (path, exc)


def main(argv):
    parser = argparse.ArgumentParser(description="Validate a built OTT catalog JSON file.")
    parser.add_argument("path", nargs="?", help="catalog JSON path (default: %s)" % DEFAULT_CATALOG)
    parser.add_argument("--text", help="synopsis sidecar JSON path (e.g. docs/assets/catalog.text.json)")
    parser.add_argument("--max-errors", type=int, default=20)
    args = parser.parse_args(argv)

    if args.path is None and args.text is None:
        args.path = DEFAULT_CATALOG

    failed = False
    catalog_ids = None

    if args.path is not None:
        path = Path(args.path)
        doc, error = _load_json(path)
        if error:
            print("FAIL: %s" % error, file=sys.stderr)
            return 1

        errors = validate(doc)
        if errors:
            print("FAIL: %d error(s)" % len(errors), file=sys.stderr)
            for error in errors[: args.max_errors]:
                print(error, file=sys.stderr)
            failed = True
        else:
            records = doc["records"]
            providers = doc["meta"]["providers"]
            print("OK: %d records, schema 2, providers=%s" % (len(records), providers))

        records = doc.get("records") if isinstance(doc, dict) else None
        if isinstance(records, list):
            catalog_ids = {
                rec.get("id")
                for rec in records
                if isinstance(rec, dict) and isinstance(rec.get("id"), str)
            }

    if args.text is not None:
        path = Path(args.text)
        doc, error = _load_json(path)
        if error:
            print("FAIL: %s" % error, file=sys.stderr)
            return 1

        errors = validate_text(doc, catalog_ids)
        if errors:
            print("FAIL: %d error(s) in %s" % (len(errors), path), file=sys.stderr)
            for error in errors[: args.max_errors]:
                print(error, file=sys.stderr)
            failed = True
        else:
            print("OK: %d synopsis entries, schema 2, sidecar=%s" % (len(doc["s"]), path))

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
