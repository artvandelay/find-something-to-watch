# India OTT Search — bring your own key

Live: https://artvandelay.github.io/india-ott-byok/

## What this is

The site ships a static snapshot of what is streaming in India, plus all of the search logic that runs
over it. The visitor brings the other two pieces: their own LLM API key, and their own taste context.

Nothing runs on a server — no backend, no database, no analytics. The key and the watch history live in
the browser's `localStorage`, and the only outbound request goes directly from the browser to the LLM
endpoint the visitor configured.

## Why

OTT catalogs are enormous, and their built-in search only matches titles. You cannot find something by
describing it. This searches meaning across synopses, and then ranks the matches against who you
actually are.

## Bring your own key

Any OpenAI-compatible endpoint works. OpenRouter is the default, at `https://openrouter.ai/api/v1`, but
you can point the app at any other compatible base URL. The key is entered in the in-app **Settings**
dialog.

The key is stored only in `localStorage` on your device — it is never sent anywhere except to the
endpoint you configured. Keyword search works with no key at all; the key only unlocks the LLM-ranked
semantic search.

No catalog key of any kind is needed at runtime. The catalog is a static JSON file built ahead of time
(see below) and shipped with the site.

## Bring your own context

Two optional inputs shape the ranking:

- **You.md** — a free-form markdown description of your taste. Write it however you like: favorite
  directors, moods you are in, things you never want to see again.
- **Netflix viewing history** — import the CSV that Netflix gives you under
  Netflix Account -> Profile -> Viewing activity -> Download all.

Both stay on the device, and both can be exported back out at any time.

## What you can filter on

Results can be narrowed by kind (movie or series), release year, runtime, TMDB rating, provider,
original language (ISO-639-1 codes), and genre. The provider facet covers 26 curated India services,
including Netflix, Prime Video, JioHotstar, ZEE5, SonyLIV, and MUBI.

Ratings shown are TMDB `vote_average` (audience scores out of 10), not IMDb ratings.

## Export

Results export as Markdown, JSON, CSV, or an updated You.md.

## Run it locally

```bash
python3 -m http.server --directory docs
# then open http://localhost:8000
```

There is no build step and no `package.json` — `docs/` is the whole app, served as static files.

## Rebuild the catalog

The catalog is built at **build time** from TMDB. You need a TMDB v4 read access token in the root
`.env` (gitignored, never committed):

```
TMDB_TOKEN=<v4 read access token>
```

(`TMDB_READ_ACCESS_TOKEN` is also accepted.) Then, from the repo root:

```bash
# 1. Sweep TMDB discover + watch/providers (region IN) into catalog/catalog.db
python3 catalog/catalog.py

# 2. Enrich: backfill imdb_id and runtime (only touches rows missing them)
python3 catalog/catalog.py --enrich

# 3. Build the shipped assets: unions catalog.db with the legacy uNoGS /
#    StreamingAvailability dumps under data/ (read from disk only, never
#    re-fetched) and emits:
#      docs/assets/catalog.json       — lean records, synopses blanked
#      docs/assets/catalog.text.json  — synopsis sidecar, lazy-loaded by the app
#      docs/assets/catalog.meta.json  — the meta object alone
python3 scripts/build_catalog_tmdb.py

# 4. Validate
python3 scripts/validate_catalog.py
python3 scripts/validate_catalog.py docs/assets/catalog.json --text docs/assets/catalog.text.json
```

The `--text` flag validates the synopsis sidecar (schema, counts, and that every sidecar key is an id
present in the catalog when the catalog is also given).

See `catalog/README.md` for sweep tuning (sharding, concurrency, change tracking, cron) and
`CONTRACT.md` for the frozen record and file shapes every consumer relies on.

**No RapidAPI anywhere** — not at build time, not at runtime. The old scripts
`scripts/fetch_streaming_availability.py` and `scripts/unogs_dump_catalog.py` remain on disk for
provenance only; they are not part of the build or runtime flow.

## Checks and stress suites

Module checks (development-only; the published site has no build step and no npm dependencies):

```bash
node scripts/check_catalog.mjs
node scripts/check_history.mjs
node scripts/check_tools.mjs
node scripts/check_agent.mjs
node scripts/check_store.mjs
node scripts/check_exporters.mjs
```

Stress suites:

```bash
node scripts/stress_*.mjs
```

`stress_agent_live.mjs` makes real LLM calls and needs `OPENROUTER_API_KEY` in the root `.env`; it
exits non-zero when the key is absent, so it is safe to include in CI where the key may not exist.

To scan the repo for accidentally committed secrets:

```bash
bash scripts/scan_secrets.sh
```

## Repo layout

- `docs/` — the entire app, served as static files (GitHub Pages)
  - `docs/js/catalog.js` — BM25 search over the catalog
  - `docs/js/history.js` — Netflix CSV parsing
  - `docs/js/tools.js` — browser-local agent tools
  - `docs/js/agent.js` — OpenAI-compatible tool-calling loop
  - `docs/js/store.js` — localStorage
  - `docs/js/exporters.js` — output formats
  - `docs/js/ui.js` — the only module that imports the others
  - `docs/assets/` — built catalog JSON, synopsis sidecar, meta, prompts
- `catalog/` — TMDB sweep CLI (`catalog.py`) and the SQLite dump it produces (gitignored)
- `scripts/` — catalog builder/validator, node module checks, stress suites, secret scanner,
  and the retired RapidAPI fetchers kept for provenance
- `data/` — legacy uNoGS / StreamingAvailability dumps (gitignored; read-only builder inputs)
- `research/` — sourcing analysis notes
- `CONTRACT.md` — frozen data shapes every module conforms to
- `CHANGELOG.md` — v0.1.0 release notes
- `RELEASE_CHECKLIST.md` — remaining checks before tagging and publishing

Every browser module except `ui.js` is import-free and receives its dependencies as arguments.

## Data and attribution

The catalog is a point-in-time snapshot built from TMDB (discover + watch/providers, region IN),
unioned with legacy dumps. Availability changes constantly, so treat anything here as a starting
point rather than the truth right now. Ratings are TMDB audience scores. No affiliation with any
streaming service is implied or claimed.

The footer of the app shows TMDB attribution — "This product uses the TMDB API but is not endorsed or
certified by TMDB" — as required by TMDB's API terms. The underlying availability data is JustWatch
data served through TMDB; see `catalog/README.md` for that attribution requirement.

## License

MIT. See [LICENSE](LICENSE).
