#!/usr/bin/env python3
"""Full-region streaming catalog dump (default region: India).

Builds a local SQLite dump of TMDB discover/watch-provider availability,
sharded by provider_id x media_type x monetization_type x release_year so no
query ever silently truncates at the 500-page / 10,000-result discover cap.
Re-runnable: availability.first_seen / last_seen track arrivals and removals.

Stdlib + httpx only. Auth: TMDB v4 read access token from TMDB_TOKEN
(root .env is loaded if present, then process env). The token is never
written to disk or into the DB.
"""

import argparse
import asyncio
import json
import os
import random
import sqlite3
import sys
from datetime import date
from pathlib import Path

try:
    import httpx
except ImportError:  # smoke_test.py and --diff must work without httpx
    httpx = None

BASE_URL = "https://api.themoviedb.org/3"
PAGE_CAP = 500  # discover hard cap: 500 pages x 20 results, silently truncated
YEAR_FLOOR = 1950  # everything earlier goes into one open-ended bucket

# Overflow subdivision list: major Indian languages plus common imports.
OVERFLOW_LANGUAGES = [
    "hi", "en", "ta", "te", "ml", "kn", "bn", "mr", "gu", "pa", "ur",
    "or", "as", "ja", "ko", "es", "fr", "de", "zh",
]

MONETIZATION_TYPES = {"flatrate", "free", "ads", "rent", "buy"}
MEDIA_TYPES = {"movie", "tv"}

SCHEMA_DDL = """
CREATE TABLE IF NOT EXISTS provider (
    provider_id      INTEGER PRIMARY KEY,
    name             TEXT,
    logo_path        TEXT,
    display_priority INTEGER
);
CREATE TABLE IF NOT EXISTS title (
    tmdb_id           INTEGER NOT NULL,
    media_type        TEXT NOT NULL,
    name              TEXT,
    original_name     TEXT,
    original_language TEXT,
    release_date      TEXT,
    genre_ids         TEXT,  -- JSON array
    overview          TEXT,
    poster_path       TEXT,
    popularity        REAL,
    vote_average      REAL,
    vote_count        INTEGER,
    imdb_id           TEXT,     -- filled only by --enrich
    runtime           INTEGER,  -- filled only by --enrich
    PRIMARY KEY (tmdb_id, media_type)
);
CREATE TABLE IF NOT EXISTS availability (
    tmdb_id      INTEGER NOT NULL,
    media_type   TEXT NOT NULL,
    provider_id  INTEGER NOT NULL,
    monetization TEXT NOT NULL,
    first_seen   TEXT,
    last_seen    TEXT,
    PRIMARY KEY (tmdb_id, media_type, provider_id, monetization)
);
CREATE TABLE IF NOT EXISTS snapshot (
    snapshot_date TEXT PRIMARY KEY,
    region        TEXT,
    row_count     INTEGER,
    api_calls     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_availability_provider ON availability(provider_id);
CREATE INDEX IF NOT EXISTS idx_availability_last_seen ON availability(last_seen);
CREATE INDEX IF NOT EXISTS idx_title_popularity ON title(popularity DESC);
"""


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Config / auth
# ---------------------------------------------------------------------------

def load_dotenv(path):
    """Tiny hand-rolled dotenv reader. Never overrides existing env vars."""
    try:
        text = Path(path).read_text()
    except OSError:
        return
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def get_token():
    """Load root .env (cwd and repo root) if present, then process env."""
    here = Path(__file__).resolve().parent
    for candidate in (Path.cwd() / ".env", here.parent / ".env", here / ".env"):
        load_dotenv(candidate)
    token = os.environ.get("TMDB_TOKEN") or os.environ.get(
        "TMDB_READ_ACCESS_TOKEN")
    if not token:
        sys.exit(
            "TMDB_TOKEN not found. Add TMDB_TOKEN=<v4 read access token> "
            "(or TMDB_READ_ACCESS_TOKEN) to the root .env or export it."
        )
    return token


# ---------------------------------------------------------------------------
# Sharding (pure functions, exercised by smoke_test.py)
# ---------------------------------------------------------------------------

def year_buckets(today=None):
    """(gte, lte) date pairs. First bucket is open-ended pre-1950 (gte=None),
    then one bucket per year from 1950 through current year + 1."""
    current = (today or date.today()).year
    buckets = [(None, f"{YEAR_FLOOR - 1}-12-31")]
    for year in range(YEAR_FLOOR, current + 2):
        buckets.append((f"{year}-01-01", f"{year}-12-31"))
    return buckets


def build_shard_params(region, provider_id, media_type, monetization,
                       gte, lte, language=None):
    """Base discover params for one provider x media_type x monetization x
    release_year shard. One provider per query, always: with_watch_providers
    OR-lists don't say which provider matched, so we never batch providers."""
    if media_type == "movie":
        date_prefix = "primary_release_date"
    else:
        date_prefix = "first_air_date"
    params = {
        "watch_region": region,
        "with_watch_providers": str(provider_id),
        "with_watch_monetization_types": monetization,
        "sort_by": "popularity.desc",  # if a shard overflows, keep what matters
    }
    if gte is not None:
        params[f"{date_prefix}.gte"] = gte
    if lte is not None:
        params[f"{date_prefix}.lte"] = lte
    if language is not None:
        params["with_original_language"] = language
    return params


def shard_page_count(total_pages):
    """Pages we can actually fetch for a shard: discover caps at 500."""
    return min(total_pages, PAGE_CAP)


def needs_language_split(total_pages, depth):
    """Overflow rule: if page 1 reports more than the 500-page cap, recurse
    once (depth 0 only) subdividing by with_original_language."""
    return total_pages > PAGE_CAP and depth == 0


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def init_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.executescript(SCHEMA_DDL)
    conn.commit()
    return conn


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        return True  # exists, owned by someone else
    return True


def acquire_lock(db_path):
    """One catalog.py writer per DB at a time. Concurrent sweeps/enrichments
    against the same file raced into `database is locked` crashes and, worse,
    silently interleaved writes. A stale lock (owner pid no longer alive) is
    reclaimed automatically."""
    lock_path = f"{db_path}.lock"
    if os.path.exists(lock_path):
        try:
            owner = int(Path(lock_path).read_text().strip())
        except (ValueError, OSError):
            owner = None
        if owner is not None and _pid_alive(owner):
            sys.exit(
                f"Another catalog.py process (pid {owner}) is already "
                f"writing {db_path}. Wait for it to finish, or remove "
                f"{lock_path} if you're sure it's stale."
            )
        log(f"info: removing stale lock {lock_path} (owner pid {owner} not running)")
    Path(lock_path).write_text(str(os.getpid()))
    return lock_path


def release_lock(lock_path):
    try:
        os.remove(lock_path)
    except OSError:
        pass


def upsert_provider(conn, p):
    conn.execute(
        """INSERT INTO provider (provider_id, name, logo_path, display_priority)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(provider_id) DO UPDATE SET
               name=excluded.name,
               logo_path=excluded.logo_path,
               display_priority=excluded.display_priority""",
        (p["provider_id"], p.get("provider_name"), p.get("logo_path"),
         p.get("display_priority")),
    )


def upsert_title(conn, media_type, item):
    """Insert/update discover metadata. Never touches imdb_id/runtime so the
    enrichment pass is not clobbered by re-sweeps."""
    name = item.get("title") or item.get("name")
    original_name = item.get("original_title") or item.get("original_name")
    release_date = item.get("release_date") or item.get("first_air_date") or None
    conn.execute(
        """INSERT INTO title (tmdb_id, media_type, name, original_name,
                              original_language, release_date, genre_ids,
                              overview, poster_path, popularity,
                              vote_average, vote_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tmdb_id, media_type) DO UPDATE SET
               name=excluded.name,
               original_name=excluded.original_name,
               original_language=excluded.original_language,
               release_date=excluded.release_date,
               genre_ids=excluded.genre_ids,
               overview=excluded.overview,
               poster_path=excluded.poster_path,
               popularity=excluded.popularity,
               vote_average=excluded.vote_average,
               vote_count=excluded.vote_count""",
        (item["id"], media_type, name, original_name,
         item.get("original_language"), release_date,
         json.dumps(item.get("genre_ids") or []),
         item.get("overview"), item.get("poster_path"),
         item.get("popularity"), item.get("vote_average"),
         item.get("vote_count")),
    )


def upsert_availability(conn, tmdb_id, media_type, provider_id, monetization,
                        run_date):
    """The entire change-tracking mechanism: first_seen is set on insert and
    preserved on conflict; only last_seen moves."""
    conn.execute(
        """INSERT INTO availability (tmdb_id, media_type, provider_id,
                                     monetization, first_seen, last_seen)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(tmdb_id, media_type, provider_id, monetization)
           DO UPDATE SET last_seen=excluded.last_seen""",
        (tmdb_id, media_type, provider_id, monetization, run_date, run_date),
    )


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------

async def fetch_json(client, sem, path, params, stats, retries=6):
    """GET with retry: exponential backoff on transport errors and 5xx,
    honor Retry-After on 429. Returns parsed JSON or None on failure."""
    delay = 1.0
    for attempt in range(retries):
        async with sem:
            try:
                stats["calls"] += 1
                resp = await client.get(path, params=params)
            except httpx.TransportError as exc:
                if attempt == retries - 1:
                    log(f"warn: {path} transport error after {retries} tries: {exc}")
                    stats["failed"] = stats.get("failed", 0) + 1
                    return None
                await asyncio.sleep(delay + random.random())
                delay *= 2
                continue
        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After")
            try:
                wait = float(retry_after) if retry_after else delay
            except ValueError:
                wait = delay
            await asyncio.sleep(wait)
            delay *= 2
            continue
        if resp.status_code >= 500:
            if attempt == retries - 1:
                log(f"warn: {path} HTTP {resp.status_code} after {retries} tries")
                stats["failed"] = stats.get("failed", 0) + 1
                return None
            await asyncio.sleep(delay + random.random())
            delay *= 2
            continue
        if resp.status_code != 200:
            log(f"warn: {path} HTTP {resp.status_code}: {resp.text[:200]}")
            stats["failed"] = stats.get("failed", 0) + 1
            return None
        return resp.json()
    return None


async def fetch_shard(fetch_page, base_params, desc="", depth=0):
    """Fetch every reachable page of one shard. fetch_page is an async
    callable(params) -> dict|None, so the smoke test can drive this with a
    fake fetcher and no network.

    Overflow: if page 1 reports total_pages beyond the 500 cap, recurse once
    subdividing by with_original_language, then still page the unsplit shard
    up to the cap so titles in other languages are not lost. Overflows are
    logged to stderr as informational, not errors."""
    page1 = await fetch_page({**base_params, "page": 1})
    if page1 is None:
        return []
    total_pages = page1.get("total_pages") or 1
    results = list(page1.get("results") or [])

    if needs_language_split(total_pages, depth):
        log(f"info: overflow ({total_pages} pages > {PAGE_CAP}) in shard "
            f"{desc}; subdividing by original_language")
        sub = await asyncio.gather(*[
            fetch_shard(fetch_page,
                        {**base_params, "with_original_language": lang},
                        desc=f"{desc} lang={lang}", depth=depth + 1)
            for lang in OVERFLOW_LANGUAGES
        ])
        for sub_results in sub:
            results.extend(sub_results)

    for page in range(2, shard_page_count(total_pages) + 1):
        data = await fetch_page({**base_params, "page": page})
        if data is None:
            log(f"warn: lost page {page}/{total_pages} of shard {desc}")
            continue
        results.extend(data.get("results") or [])
    return results


# ---------------------------------------------------------------------------
# Sweep
# ---------------------------------------------------------------------------

async def get_providers(client, sem, region, stats):
    """Enumerate provider IDs at runtime from /watch/providers/{movie,tv}.
    Never hardcoded."""
    merged = {}
    for media_type in ("movie", "tv"):
        data = await fetch_json(client, sem, f"/watch/providers/{media_type}",
                                {"watch_region": region}, stats)
        for p in (data or {}).get("results") or []:
            merged[p["provider_id"]] = p
    return [merged[k] for k in sorted(merged)]


async def sweep_provider_media(client, sem, conn, provider, media_type,
                               monetizations, args, run_date, stats):
    """Fetch all year shards for one provider x media_type, persist, commit.
    This is the crash checkpoint: a failure 80% in loses at most one
    provider x media_type of work."""
    pid = provider["provider_id"]
    rows = 0
    for monetization in monetizations:

        async def fetch_page(params, _mt=media_type):
            return await fetch_json(client, sem, f"/discover/{_mt}", params, stats)

        shards = [
            fetch_shard(
                fetch_page,
                build_shard_params(args.region, pid, media_type, monetization,
                                   gte, lte),
                desc=f"provider={pid} {media_type} {monetization} "
                     f"{gte or '...'}..{lte}",
            )
            for gte, lte in year_buckets()
        ]
        for shard_results in await asyncio.gather(*shards):
            for item in shard_results:
                upsert_title(conn, media_type, item)
                upsert_availability(conn, item["id"], media_type, pid,
                                    monetization, run_date)
                rows += 1
    conn.commit()
    log(f"{provider.get('provider_name')} ({pid}) {media_type}: "
        f"{rows} availability rows | api calls so far: {stats['calls']}")


async def cmd_sweep(args):
    token = get_token()
    lock_path = acquire_lock(args.db)
    try:
        conn = init_db(args.db)
        stats = {"calls": 0, "failed": 0}
        sem = asyncio.Semaphore(args.concurrency)
        media_types = [t.strip() for t in args.types.split(",") if t.strip()]
        for t in media_types:
            if t not in MEDIA_TYPES:
                sys.exit(f"unknown media type: {t}")
        monetizations = [m.strip() for m in args.monetization.split(",") if m.strip()]
        for m in monetizations:
            if m not in MONETIZATION_TYPES:
                sys.exit(f"unknown monetization type: {m}")
        run_date = date.today().isoformat()

        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(base_url=BASE_URL, headers=headers,
                                     timeout=30.0) as client:
            providers = await get_providers(client, sem, args.region, stats)
            if args.providers:
                wanted = {int(p) for p in args.providers.split(",")}
                providers = [p for p in providers if p["provider_id"] in wanted]
            for p in providers:
                upsert_provider(conn, p)
            conn.commit()
            log(f"{len(providers)} providers in region {args.region}; "
                f"sweeping {media_types} x {monetizations}")

            for provider in providers:
                for media_type in media_types:
                    await sweep_provider_media(client, sem, conn, provider,
                                               media_type, monetizations, args,
                                               run_date, stats)

        # Only rows this run actually touched, not the whole table's history
        # (which also holds rows from earlier snapshots that have since left).
        row_count = conn.execute(
            "SELECT COUNT(*) FROM availability WHERE last_seen = ?", (run_date,)
        ).fetchone()[0]
        titles = conn.execute("SELECT COUNT(*) FROM title").fetchone()[0]
        failed = stats["failed"]

        # A snapshot row is a claim that this run saw the *whole* catalog for
        # `region`. A --providers-restricted run or one with permanently
        # failed calls saw only part of it; recording it as a full snapshot
        # would make --diff report every untouched/failed title as removed.
        if args.providers:
            log("restricted run (--providers): skipping snapshot row so the "
                "full-catalog diff isn't corrupted by this partial sweep")
        elif failed:
            log(f"warn: {failed} API calls failed permanently; skipping "
                f"snapshot row so --diff isn't corrupted with false "
                f"removals. Re-run the sweep to fill the gap.")
        else:
            conn.execute(
                """INSERT INTO snapshot (snapshot_date, region, row_count, api_calls)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(snapshot_date) DO UPDATE SET
                       region=excluded.region,
                       row_count=excluded.row_count,
                       api_calls=excluded.api_calls""",
                (run_date, args.region, row_count, stats["calls"]),
            )
            conn.commit()
        log(f"sweep done: {titles} titles, {row_count} availability rows, "
            f"{stats['calls']} api calls, {failed} failed calls")
        conn.close()
    finally:
        release_lock(lock_path)


# ---------------------------------------------------------------------------
# Enrichment
# ---------------------------------------------------------------------------

async def cmd_enrich(args):
    """Optional backfill of imdb_id and runtime, one call per title. Only
    touches rows where imdb_id is null, so re-runs are cheap. Individual
    failures are tolerated; the pass never aborts on one bad title."""
    token = get_token()
    lock_path = acquire_lock(args.db)
    try:
        await _run_enrich(token, args)
    finally:
        release_lock(lock_path)


async def _run_enrich(token, args):
    conn = init_db(args.db)
    stats = {"calls": 0}
    sem = asyncio.Semaphore(args.concurrency)
    pending = conn.execute(
        "SELECT tmdb_id, media_type FROM title WHERE imdb_id IS NULL"
    ).fetchall()
    log(f"enriching {len(pending)} titles")

    headers = {"Authorization": f"Bearer {token}"}
    done = 0
    async with httpx.AsyncClient(base_url=BASE_URL, headers=headers,
                                 timeout=30.0) as client:
        for i in range(0, len(pending), 500):
            batch = pending[i:i + 500]

            async def one(tmdb_id, media_type):
                data = await fetch_json(
                    client, sem, f"/{media_type}/{tmdb_id}",
                    {"append_to_response": "external_ids"}, stats)
                if data is None:
                    return
                imdb_id = (data.get("external_ids") or {}).get("imdb_id")
                if media_type == "movie":
                    runtime = data.get("runtime")
                else:
                    ert = data.get("episode_run_time") or []
                    runtime = ert[0] if ert else None
                conn.execute(
                    """UPDATE title SET imdb_id = COALESCE(?, imdb_id),
                                        runtime = COALESCE(?, runtime)
                       WHERE tmdb_id = ? AND media_type = ?""",
                    (imdb_id, runtime, tmdb_id, media_type),
                )

            await asyncio.gather(*[one(tid, mt) for tid, mt in batch])
            conn.commit()
            done += len(batch)
            log(f"enrich {done}/{len(pending)} | api calls so far: "
                f"{stats['calls']}")
    conn.close()
    log(f"enrich done: {stats['calls']} api calls")


# ---------------------------------------------------------------------------
# Diff (offline)
# ---------------------------------------------------------------------------

def cmd_diff(args):
    """Print added/removed vs the previous snapshot. No network calls."""
    conn = init_db(args.db)
    snaps = [r[0] for r in conn.execute(
        "SELECT snapshot_date FROM snapshot ORDER BY snapshot_date DESC LIMIT 2"
    )]
    if not snaps:
        print("No snapshots in this database yet. Run a sweep first.")
        return
    cur = snaps[0]
    if len(snaps) == 1:
        prev = None
        print(f"Only one snapshot ({cur}); everything in it counts as added.")
        added_where, added_params = "a.first_seen <= ?", (cur,)
        removed_where, removed_params = "1=0", ()
    else:
        prev = snaps[1]
        print(f"Diff: {prev} -> {cur}")
        added_where = "a.first_seen > ? AND a.first_seen <= ?"
        added_params = (prev, cur)
        removed_where = "a.last_seen < ? AND a.last_seen >= ?"
        removed_params = (cur, prev)

    def report(label, where, params):
        total = conn.execute(
            f"SELECT COUNT(*) FROM availability a WHERE {where}", params
        ).fetchone()[0]
        print(f"\n{label}: {total} rows")
        for name, n in conn.execute(
            f"""SELECT p.name, COUNT(*) AS n FROM availability a
                JOIN provider p ON p.provider_id = a.provider_id
                WHERE {where}
                GROUP BY a.provider_id ORDER BY n DESC""", params
        ):
            print(f"  {name}: {n}")
        print(f"  sample (by popularity):")
        for title_name, mt, pname in conn.execute(
            f"""SELECT t.name, a.media_type, p.name
                FROM availability a
                JOIN title t ON t.tmdb_id = a.tmdb_id
                            AND t.media_type = a.media_type
                JOIN provider p ON p.provider_id = a.provider_id
                WHERE {where}
                ORDER BY t.popularity DESC LIMIT 15""", params
        ):
            print(f"    {title_name} [{mt}] on {pname}")

    report("ADDED", added_where, added_params)
    report("REMOVED / LEFT", removed_where, removed_params)
    conn.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Full-region streaming availability catalog dump (TMDB).")
    ap.add_argument("--region", default="IN")
    ap.add_argument("--db", default="catalog.db")
    ap.add_argument("--types", default="movie,tv")
    ap.add_argument("--monetization", default="flatrate",
                    help="comma-separated: flatrate,free,ads,rent,buy")
    ap.add_argument("--providers", default=None,
                    help="comma-separated provider_ids to restrict to (testing)")
    ap.add_argument("--concurrency", type=int, default=24)
    ap.add_argument("--enrich", action="store_true",
                    help="backfill imdb_id and runtime (one call per title)")
    ap.add_argument("--diff", action="store_true",
                    help="print added/removed vs previous snapshot (offline)")
    args = ap.parse_args()

    if args.diff:
        cmd_diff(args)
        return
    if httpx is None:
        sys.exit("httpx is required for network commands: "
                 "uv pip install --python ~/pyenv/tmdb-catalog/bin/python httpx")
    if args.enrich:
        asyncio.run(cmd_enrich(args))
    else:
        asyncio.run(cmd_sweep(args))


if __name__ == "__main__":
    main()
