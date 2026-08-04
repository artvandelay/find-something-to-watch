# India OTT Search — bring your own key

Live: https://artvandelay.github.io/india-ott-byok/

## What this is

The site ships a static snapshot of what is streaming in India, plus all of the search logic that runs
over it. The visitor brings the other two pieces: their own LLM API key, and their own taste context. An
onboarding screen collects the services you subscribe to, your key, and (optionally) a taste note and
Netflix viewing history CSV; after that, a three-region shell — sidebar, chat, and a recommendation
display — remembers your one current conversation and up to 20 queued titles across reloads.

Nothing runs on our server — no backend, no database, no analytics, no accounts, no cloud sync. Your API
key, subscriptions, You.md, watch history, and conversation live only in this browser (the key in
`localStorage`, everything else in IndexedDB via `docs/js/memory.js`). When you send a message, the
message and a bounded slice of your mood/You.md/recent-watch context go directly from your browser to
the LLM endpoint you configured, together with your API key for authentication. Catalog analysis itself
runs locally in browser Workers; the model receives tool results, not direct access to watch URLs.

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

**Web search is off by default.** Settings can enable it only for an OpenRouter endpoint. With the
opt-in enabled, OpenRouter may send the applicable prompt/context to its search providers, retrieve
current web pages, and bill for the extra search/model work. It is separate from the static India OTT
catalog and is not available for a custom OpenAI-compatible endpoint.

No catalog key of any kind is needed at runtime. The catalog is a static JSON file built ahead of time
(see below) and shipped with the site.

## Bring your own context

Two optional inputs shape the ranking:

- **You.md** — a free-form markdown description of your taste. Write it however you like: favorite
  directors, moods you are in, things you never want to see again.
- **Netflix viewing history** — import the CSV that Netflix gives you under
  Netflix Account -> Profile -> Viewing activity -> Download all.

Both stay on the device, and both can be exported back out at any time.

## Subscriptions are a hard boundary

Onboarding (and Settings, later) asks which of the 26 curated India services you actually subscribe to.
Every search, filter, sample, and recommendation-display card is restricted to titles available on at
least one of those services, and every watch link shown is intersected down to just your subscriptions —
you never see a provider or a link for a service you didn't select. A title's link is labelled to match
what it actually is: a true per-title deep link ("Watch on ..."), a provider search page ("Find on ..."),
or the shared TMDB watch page that lists real providers itself ("See where to watch").

## What you can filter on

Results can be narrowed by kind (movie or series), release year, runtime, TMDB rating, provider (limited
to your subscriptions), original language (ISO-639-1 codes), and genre.

Ratings shown are TMDB `vote_average` (audience scores out of 10), not IMDb ratings.

## Export

Results export as Markdown, JSON, CSV, or an updated You.md.

## Run it locally

```bash
npm install
python3 -m http.server --directory docs
# then open http://localhost:8000
```

There is no production build step — `docs/` is the static app served by GitHub Pages. `package.json`
only supplies the development check command and the browser-side ZIP dependency.

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

Module checks (development-only; the published site has no build step):

```bash
node scripts/check_catalog.mjs
node scripts/check_history.mjs
node scripts/check_tools.mjs
node scripts/check_catalog_runtime.mjs
node scripts/check_llm_client.mjs
node scripts/check_agent.mjs
node scripts/check_store.mjs
node scripts/check_exporters.mjs
node scripts/check_memory.mjs
# or run all nine:
npm test
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
  - `docs/js/catalog.js` — local catalog indexing, filtering, and the no-LLM
    recommendation-queue seed
  - `docs/js/history.js` — Netflix CSV parsing
  - `docs/js/providers.js` — shared provider slugs/labels, language names, and
    watch-link-kind helpers used by the catalog runtime and exporters
  - `docs/js/catalog-worker.js` — trusted catalog Worker: scoped analytical data,
    readiness, and final title resolution
  - `docs/js/catalog-runtime.js` — generic `run_catalog_js` bridge and disposable
    executor-Worker lifecycle
  - `docs/js/agent.js` — bounded tool-calling loop using the one generic catalog
    tool; its first no-tool answer is the required JSON final response
  - `docs/js/llm-client.js` — shared OpenAI-compatible HTTP adapter, including the
    explicit OpenRouter-only web-search option
  - `docs/js/memory.js` — versioned IndexedDB adapter for profile, conversation,
    queue, You.md, and watch history (see CONTRACT.md's "Browser memory" section)
  - `docs/js/store.js` — localStorage, now scoped to just the LLM key/model/baseUrl
  - `docs/js/exporters.js` — output formats
  - `docs/js/views/` — onboarding, sidebar, chat, recommendation-queue, and dialog UI
    modules, coordinated by `docs/js/ui.js`
  - `docs/js/ui.js` — the slim coordinator; the only module that imports the views
  - `docs/assets/` — built catalog JSON, synopsis sidecar, meta, prompts
- `catalog/` — TMDB sweep CLI (`catalog.py`) and the SQLite dump it produces (gitignored)
- `scripts/` — catalog builder/validator, node module checks, stress suites, secret scanner,
  and the retired RapidAPI fetchers kept for provenance
- `data/` — legacy uNoGS / StreamingAvailability dumps (gitignored; read-only builder inputs)
- `research/` — sourcing analysis notes
- `CONTRACT.md` — frozen data shapes every module conforms to
- `CHANGELOG.md` — v0.1.0 release notes
- `RELEASE_CHECKLIST.md` — remaining checks before tagging and publishing

`docs/js/catalog.js`, `docs/js/history.js`, and `docs/js/store.js` stay import-free. The catalog runtime
owns Worker messages: a long-lived trusted Worker has the subscription-scoped catalog, while each
`run_catalog_js` evaluation has a disposable executor Worker. This is fault containment for malformed
or runaway analysis, not a hostile-code security sandbox. The DOM-facing `docs/js/views/*` modules and
`docs/js/ui.js` import from the runtime and presentation modules as needed.

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
