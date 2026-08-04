#!/usr/bin/env python3
"""Local smoke test for catalog.py. Stdlib only, no network, no httpx.

Exercises:
  1. shard parameter builder (year buckets incl. the pre-1950 open-ended
     bucket, and the language-subdivision path on 500-page overflow)
  2. schema DDL
  3. availability upsert path (first_seen preserved, last_seen updated)

Run: python3 catalog/smoke_test.py
"""

import asyncio
import sqlite3
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import catalog  # noqa: E402  (must import cleanly without httpx installed)

FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print(f"ok   {name}")
    else:
        print(f"FAIL {name} {detail}")
        FAILURES.append(name)


# --- 1a. year buckets -------------------------------------------------------

buckets = catalog.year_buckets(today=date(2026, 8, 4))
check("first bucket is open-ended pre-1950",
      buckets[0] == (None, "1949-12-31"), f"got {buckets[0]}")
check("year buckets run 1950..current+1",
      buckets[1] == ("1950-01-01", "1950-12-31")
      and buckets[-1] == ("2027-01-01", "2027-12-31")
      and len(buckets) == 1 + (2027 - 1950 + 1),
      f"got {buckets[1]} ... {buckets[-1]} (n={len(buckets)})")

# --- 1b. shard params -------------------------------------------------------

p = catalog.build_shard_params("IN", 8, "movie", "flatrate",
                               "2001-01-01", "2001-12-31")
check("movie shard uses primary_release_date window",
      p["primary_release_date.gte"] == "2001-01-01"
      and p["primary_release_date.lte"] == "2001-12-31")
check("shard is one provider, sorted by popularity",
      p["with_watch_providers"] == "8" and p["sort_by"] == "popularity.desc")
check("shard carries region and monetization",
      p["watch_region"] == "IN"
      and p["with_watch_monetization_types"] == "flatrate")

p = catalog.build_shard_params("IN", 119, "tv", "flatrate", None, "1949-12-31")
check("tv shard uses first_air_date and open-ended gte is omitted",
      p["first_air_date.lte"] == "1949-12-31"
      and "first_air_date.gte" not in p)

p = catalog.build_shard_params("IN", 8, "movie", "flatrate",
                               "2001-01-01", "2001-12-31", language="hi")
check("language subdivision sets with_original_language",
      p["with_original_language"] == "hi")

check("page count caps at 500",
      catalog.shard_page_count(900) == 500
      and catalog.shard_page_count(3) == 3)
check("overflow split only at depth 0 and only beyond cap",
      catalog.needs_language_split(501, 0)
      and not catalog.needs_language_split(501, 1)
      and not catalog.needs_language_split(500, 0))

# --- 1c. overflow recursion end-to-end with a fake fetcher ------------------

async def fake_overflow_shard():
    requested = []

    async def fetch_page(params):
        requested.append(dict(params))
        if "with_original_language" in params:
            # language subshards are small: 2 pages each
            if params["page"] == 1:
                return {"total_pages": 2,
                        "results": [{"id": ("lang", params["with_original_language"], 1)}]}
            return {"total_pages": 2,
                    "results": [{"id": ("lang", params["with_original_language"], params["page"])}]}
        # unsplit shard overflows: 900 pages reported
        return {"total_pages": 900,
                "results": [{"id": ("base", params["page"])}]}

    base = catalog.build_shard_params("IN", 8, "movie", "flatrate",
                                      "2001-01-01", "2001-12-31")
    results = await catalog.fetch_shard(fetch_page, base, desc="test")
    return requested, results


requested, results = asyncio.run(fake_overflow_shard())
unsplit = [r for r in requested if "with_original_language" not in r]
langs_hit = {r["with_original_language"] for r in requested
             if "with_original_language" in r}
check("overflow: unsplit shard still paged up to the 500 cap",
      len(unsplit) == 500 and max(r["page"] for r in unsplit) == 500,
      f"got {len(unsplit)} unsplit requests")
check("overflow: recursed once across the full language list",
      langs_hit == set(catalog.OVERFLOW_LANGUAGES),
      f"missing {set(catalog.OVERFLOW_LANGUAGES) - langs_hit}")
check("overflow: language subshards paged fully (2 pages each)",
      all(sum(1 for r in requested
              if r.get("with_original_language") == lang) == 2
          for lang in catalog.OVERFLOW_LANGUAGES))
check("overflow: results merged from unsplit + subshards",
      len(results) == 500 + 2 * len(catalog.OVERFLOW_LANGUAGES),
      f"got {len(results)}")


async def fake_small_shard():
    async def fetch_page(params):
        return {"total_pages": 1, "results": [{"id": 1}]}
    return await catalog.fetch_shard(fetch_page, {}, desc="small")


check("non-overflow shard costs exactly one call and is not split",
      len(asyncio.run(fake_small_shard())) == 1)

# --- 2. schema DDL ----------------------------------------------------------

conn = catalog.init_db(":memory:")
tables = {r[0] for r in conn.execute(
    "SELECT name FROM sqlite_master WHERE type='table'")}
check("schema creates the four tables",
      {"provider", "title", "availability", "snapshot"} <= tables,
      f"got {tables}")
indexes = {r[0] for r in conn.execute(
    "SELECT name FROM sqlite_master WHERE type='index'")}
check("schema creates the three indexes",
      {"idx_availability_provider", "idx_availability_last_seen",
       "idx_title_popularity"} <= indexes, f"got {indexes}")

# --- 3. upsert paths --------------------------------------------------------

item = {"id": 42, "title": "Test Film", "original_title": "Test Film",
        "original_language": "hi", "release_date": "2001-01-01",
        "genre_ids": [18, 80], "overview": "o", "poster_path": "/p.jpg",
        "popularity": 9.5, "vote_average": 7.1, "vote_count": 100}
catalog.upsert_title(conn, "movie", item)
catalog.upsert_availability(conn, 42, "movie", 8, "flatrate", "2026-08-01")
conn.commit()

row = conn.execute(
    "SELECT first_seen, last_seen FROM availability").fetchone()
check("availability insert sets first_seen = last_seen = run date",
      row == ("2026-08-01", "2026-08-01"), f"got {row}")

# re-run upsert on a later date: first_seen preserved, last_seen updated
catalog.upsert_availability(conn, 42, "movie", 8, "flatrate", "2026-08-04")
conn.commit()
row = conn.execute(
    "SELECT first_seen, last_seen FROM availability").fetchone()
check("upsert preserves first_seen and updates last_seen",
      row == ("2026-08-01", "2026-08-04"), f"got {row}")

# title re-upsert must not clobber enrichment columns
conn.execute("UPDATE title SET imdb_id='tt0047478', runtime=88 "
             "WHERE tmdb_id=42 AND media_type='movie'")
item["popularity"] = 10.0
catalog.upsert_title(conn, "movie", item)
conn.commit()
row = conn.execute(
    "SELECT imdb_id, runtime, popularity FROM title").fetchone()
check("title upsert preserves imdb_id/runtime, refreshes metadata",
      row == ("tt0047478", 88, 10.0), f"got {row}")

row = conn.execute("SELECT genre_ids FROM title").fetchone()
check("genre_ids stored as JSON array", row[0] == "[18, 80]", f"got {row}")

conn.close()

print()
if FAILURES:
    print(f"{len(FAILURES)} FAILURES: {FAILURES}")
    sys.exit(1)
print("all smoke tests passed")
