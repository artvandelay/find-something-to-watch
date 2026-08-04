# catalog — full-region streaming availability dump (India)

A single-file Python CLI (`catalog.py`) that dumps the complete streaming
availability catalog for a region (default `IN`) into SQLite, using TMDB's
`discover` + `watch/providers` endpoints (a licensed JustWatch integration,
refreshed daily with ~24h lag). Re-runnable: successive runs give you an
"added / removed" diff for free via `first_seen` / `last_seen` columns.

Downstream, an agent with your cross-platform watch history reads this DB as
candidate inventory + availability for a personalized "what to watch"
homepage. Personal use.

## Setup

```bash
uv venv ~/pyenv/tmdb-catalog
uv pip install --python ~/pyenv/tmdb-catalog/bin/python httpx
```

Add your TMDB v4 read access token to the root `.env` (one line, never
committed, never written into the DB):

```
TMDB_TOKEN=<v4 read access token>
```

## The four commands you will actually run

```bash
# 1. full availability sweep (default: region IN, movie+tv, flatrate)
~/pyenv/tmdb-catalog/bin/python catalog/catalog.py

# 2. tiny restricted run for testing (Netflix only, movies)
~/pyenv/tmdb-catalog/bin/python catalog/catalog.py --providers 8 --types movie

# 3. optional enrichment: backfill imdb_id + runtime (one call per title,
#    only touches rows where imdb_id is null, so re-runs are cheap)
~/pyenv/tmdb-catalog/bin/python catalog/catalog.py --enrich

# 4. offline diff vs the previous snapshot (no network, no token needed)
~/pyenv/tmdb-catalog/bin/python catalog/catalog.py --diff
```

Useful knobs: `--region IN`, `--db catalog.db`, `--types movie,tv`,
`--monetization flatrate` (also accepts `free,ads,rent,buy`),
`--providers 8,119`, `--concurrency 24`.

A sweep or enrichment run takes an exclusive lock on the DB file
(`<db>.lock`) so two writers never race each other. A `--providers`-restricted
run, or one where some API calls failed permanently after retries, does not
record a snapshot row — only a full, clean run does, so `--diff` never
reports untouched or failed titles as removed.

## Attribution requirement (not optional)

The availability data in this database is **JustWatch data**, served through
TMDB's API. TMDB's API terms require JustWatch attribution anywhere this data
is shown. If you build any page that friends (or anyone) see, credit JustWatch
on it — e.g. "Streaming availability data provided by JustWatch" with a link
to https://www.justwatch.com.

## How it works (and why)

- `discover` silently truncates at 500 pages / 10,000 results per query, and
  Netflix IN / Prime Video IN each exceed that by a wide margin. So the sweep
  shards by **provider_id x media_type x monetization_type x release_year**
  (years 1950..current+1, plus one open-ended pre-1950 bucket), sorted by
  `popularity.desc` so any residual overflow keeps the part that matters.
- If a shard's page 1 still reports more than 500 pages, it recurses once,
  subdividing by `with_original_language` (major Indian languages + common
  imports), then still pages the unsplit shard up to the cap so nothing in
  other languages is lost. Overflows are logged to stderr as info.
- One query per provider, always: `with_watch_providers` OR-lists don't say
  which provider matched.
- Provider IDs are enumerated at runtime from
  `/watch/providers/{movie,tv}?watch_region=IN` — never hardcoded.
- Change tracking is two columns: rows with `first_seen` = today are new
  arrivals; rows with `last_seen` < today are gone or leaving. No delta
  pipeline — a full re-sweep is cheap.

## Expected volumes (sanity check)

- ~30 providers in IN; ~4,700 shards for movie+tv at one monetization type
  (most return zero results and cost exactly one call).
- 8k–15k API calls for a sweep; minutes of wall clock at concurrency 24
  (TMDB's practical ceiling is ~50 rps).
- 25k–50k unique titles, 40k–90k availability rows at flatrate for movie+tv.
  Single-digit thousands of rows means sharding is broken or the token is
  scoped wrong.

## Cron (weekly re-sweep)

```
0 4 * * 1 cd /Users/jigar/projects/messing-around/llm-search-netflix && ~/pyenv/tmdb-catalog/bin/python catalog/catalog.py --db catalog/catalog.db >> catalog/sweep.log 2>&1
```

## Out of scope

Deep links (TMDB deliberately withholds them), episode-level TV data, the
recommender itself, and any deployment/scheduling infra beyond the cron line
above.
