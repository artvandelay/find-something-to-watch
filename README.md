# Find Something to Watch

**A hobby watch-decision tool for people who want to configure it themselves.**

Live: https://artvandelay.github.io/find-something-to-watch/

## What this is

This is a hobby project for technically curious viewers. It ships a dated India streaming-catalog
snapshot and local search over it. Bring your preferred compatible model and your own taste context. The
app opens into a three-panel shell — a collapsible sidebar, chat with a pinned composer, and a vertical
picks rail — that remembers conversations, ranked decisions, and playlists across reloads. Configure
your subscriptions and model key in **Settings**, then optionally import watch history from **Profile &
context**.

Stored in this browser. Relevant context is sent to the model endpoint you configure. There is no
account, backend, analytics, or cloud sync. The API key is held in `localStorage`; subscriptions, You.md,
watch history, conversations, queues, learned preferences, and playlists are held in IndexedDB via
`docs/js/memory.js`. During watch-history import, bounded filenames, structural metadata, and samples are
sent to the configured model endpoint to infer the file layout; the complete upload stays in the browser.

Model-generated catalog analysis runs in a disposable Worker for fault containment; it is not a
hostile-code security sandbox. The main thread keeps the trusted catalog records used to render cards,
playlists, and the initial queue. The model sees bounded results from one local `run_catalog_js` tool,
never watch URLs or poster URLs.

## Why

OTT catalogs are enormous, and their built-in search only matches titles. You cannot find something by
describing it. This searches meaning across synopses, and then ranks the matches against who you
actually are.

## Bring your preferred compatible model

Chat requires a nonempty OpenRouter key. Add it in the in-app **Settings** dialog, where you can also
configure a compatible endpoint and model.

The key is stored only in `localStorage` on your device — it is never sent anywhere except to the
configured endpoint.

**Web search is off by default.** The Settings dialog can enable it only when the base URL hostname is
exactly `openrouter.ai`. When enabled, OpenRouter may process relevant queries with web search and can
add cost. It does not change the local catalog or subscription boundary.

No catalog key of any kind is needed at runtime. The catalog is a static JSON file built ahead of time
(see below) and shipped with the site.

## Bring your own context

Two optional inputs shape the ranking:

- **You.md** — a free-form markdown description of your taste. Write it however you like: favorite
  directors, moods you are in, and things you never want to see again. It is editable in **Profile &
  context**.
- **Watch history** — import a `.csv`, `.json`, or `.zip` export. ZIP files may contain CSV or JSON
  candidates. The parser works locally; only a bounded structural sample is sent to OpenRouter for
  schema inference, never the full file.

Both stay in this browser. The app limits upload, archive, sample, and normalized-history sizes to keep
the import bounded.

The app can also learn explicit, durable entertainment preferences from recent chat requests. Those facts
are structured rather than appended to You.md: inspect, edit, disable, or clear them in **Profile &
context**. Disabling learned memory stops it from being included in future model requests; manual You.md
remains separate.

## Subscriptions are a hard boundary

Settings asks which of the 26 curated India services you actually subscribe to. Every local search,
model catalog analysis, recommendation card, and normal provider link is restricted to titles available
on at least one selected service. The title-details dialog is the one exception: it
groups the catalog record's providers into **On your subscriptions** and **Other known platforms**. “All
platforms” means the curated providers recorded in that dated catalog entry, not exhaustive or live
market availability. A title's link is labelled to match what it actually is: a true per-title deep link
("Watch on ..."), a provider search page ("Find on ..."), or the shared TMDB watch page that lists real
providers itself ("See where to watch").

## Ask naturally

The composer is a minimal natural-language prompt. Ask for runtime, language, genre, mood, provider, or
anything else in ordinary words; the agent's `run_catalog_js` analysis retains those constraints while selected
subscriptions remain a hard boundary.

Ratings shown are TMDB `vote_average` (audience scores out of 10), not IMDb ratings.

## Decisions, conversations, and streaming

Each update can rank up to 20 catalog-grounded titles, but the rail emphasizes one **Top pick**, then two
**Alternatives**. Remaining titles stay behind **Show N more**. The source query and fit reason make the
latest decision traceable to the conversation.

Use **New chat** to archive a non-empty conversation and begin another. The sidebar keeps up to 20 recent
conversations, including each conversation's ranked decision, so switching back restores both.

The agent shows `PLANNING`, `SEARCHING CATALOG`, `ANALYZING MATCHES`, and `WRITING`, then streams the
answer. **Stop** cancels an active turn. A turn that has not progressed for 20 seconds says `TAKING LONGER
THAN USUAL` and retains Stop. Completed turns show latency, token totals, and either provider-reported
cost or **Cost unavailable**. Reported cost is not an estimate.

## Export

Playlists have user-facing exports in Markdown, JSON, and CSV. Every visitor gets an immutable
**Watch later** playlist, can create named playlists, and can save a synopsis-rich card with its `+`
button.

## Run it locally

```bash
python3 -m http.server --directory docs
# then open http://localhost:8000
```

`docs/` is the static app served without a build step. Development checks use npm for the vendored ZIP
reader dependency:

```bash
npm install --ignore-scripts
npm run check
```

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

# 3. Build the shipped assets from catalog.db and emit:
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

## Checks and stress suites

Module checks (development-only):

```bash
npm run check
node scripts/stress_agent_hostile.mjs
node scripts/stress_search_perf.mjs
bash scripts/scan_secrets.sh
```

### Whole-app boot test

`scripts/check_app_boot.mjs` boots the real `docs/index.html` and the real `docs/js/ui.js` in jsdom,
against a small catalog fixture and a fresh IndexedDB, and drives the app the way a user would:
configuring subscriptions and a key, creating and exporting playlists, reloading, exporting a key-free
memory backup, using the mobile drawer and developer shortcut, and verifying the no-key chat gate.

It exists because these are integration failures — a control that is never rendered, or a hidden
`required` input that silently blocks a form — which unit tests on individual modules cannot see and
which are slow and flaky to chase in a live browser. The whole run takes about a second, so prefer it
over manual browser testing:

```bash
node scripts/check_app_boot.mjs
```

`scripts/harness/app.mjs` provides the boot helper. Pass `storage` from `createStorage()` to share
state between two boots and simulate a reload, `mobile: true` to start at the drawer breakpoint, and
`records` to substitute catalog fixtures.

### Deterministic browser test

The browser pass uses a real catalog Worker and mocks only chat completions. It never reads the root
`.env` or sends a real key:

```bash
node scripts/e2e_catalog_server.mjs
# In another terminal, open:
# http://127.0.0.1:8916/?testMode=1&testProviders=netflix,prime
```

Verify one `run_catalog_js` call, a subscription-scoped queue, bounded timeout recovery, and a second
successful query after the timeout. Run one live `stress_agent_live.mjs --limit 1` query separately with
`OPENROUTER_API_KEY` in the root `.env`; never log that key.

Stress suites:

```bash
node scripts/stress_*.mjs
```

`stress_agent_live.mjs` makes real LLM calls and needs `OPENROUTER_API_KEY` in the root `.env`; it
exits non-zero when the key is absent, so it is safe to include in CI where the key may not exist.

### Local testing bypass

Mostly superseded by the boot test above; useful when you want to poke at the live UI by hand.
`?testMode=1` preconfigures a test profile when the hostname is exactly `localhost` or `127.0.0.1`.
Add `testProviders=netflix,prime` to select known providers; without it, the default is Netflix.
Production hosts and localhost-like subdomains ignore this flag, and it never creates or stores an API
key.

To scan the repo for accidentally committed secrets:

```bash
bash scripts/scan_secrets.sh
```

## Repo layout

- `docs/` — the entire app, served as static files (GitHub Pages)
  - `docs/js/catalog.js` — BM25 search, subscription/facet filtering, and the local
    (no-LLM) recommendation-queue seed
  - `docs/js/history.js`, `docs/js/archive.js`, `docs/js/history-model.js` — bounded local CSV/JSON/ZIP
    history import and sampled schema inference
  - `docs/js/llm-client.js` — validated OpenAI-compatible chat-completions client
  - `docs/js/playlists.js` — immutable Watch later and named-playlist domain rules
  - `docs/js/providers.js` — shared provider slugs/labels, language names, and
    watch-link-kind helpers (the one module `tools.js`/`exporters.js` import)
  - `docs/js/catalog-runtime.js` / `docs/js/catalog-worker.js` — trusted Worker host,
    subscription-scoped catalog protocol, and final card resolution
  - `docs/js/catalog-execution.js` / `docs/js/catalog-executor.js` — disposable
    bounded JavaScript executor for model-authored catalog analysis
  - `docs/js/tools.js` — one `run_catalog_js` model tool with observed-ID queue grounding
  - `docs/js/agent.js` — shared-client, two-stage tool and rerank loop with bounded
    multi-turn history and a reply + optional queue-update response
  - `docs/js/memory.js` — versioned IndexedDB adapter for profile, conversation, queue, You.md, watch
    history, and playlists (see CONTRACT.md's "Browser memory" section)
  - `docs/js/store.js` — localStorage for the LLM key, model, base URL, and OpenRouter-only web-search opt-in
  - `docs/js/exporters.js` — output formats
  - `docs/js/views/` — onboarding, sidebar, chat, Markdown, picks-rail, playlist, and dialog
    UI modules, coordinated by `docs/js/ui.js`
  - `docs/js/ui.js` — the slim coordinator; the only module that imports the views
  - `docs/assets/` — built catalog JSON, synopsis sidecar, meta, prompts
- `catalog/` — TMDB sweep CLI (`catalog.py`) and the SQLite dump it produces (gitignored)
- `scripts/` — catalog builder/validator, node module checks, stress suites, and secret scanner
- `data/` — local builder inputs (gitignored)
- `research/` — sourcing analysis notes
- `CONTRACT.md` — frozen data shapes every module conforms to
- `CHANGELOG.md` — v0.1.0 release notes
- `RELEASE_CHECKLIST.md` — remaining checks before tagging and publishing

`docs/js/ui.js` coordinates the DOM-facing views. The history importer keeps complete files local and
uses the shared LLM client only for its bounded schema-inference request. The trusted Worker applies
subscription scope before model analysis and resolution, while the main thread retains trusted
presentation data. The disposable executor is fault containment, not a hostile-code security sandbox.

## Data and attribution

The catalog is a point-in-time snapshot built from TMDB (discover + watch/providers, region IN).
Availability changes constantly, so treat anything here as a starting point rather than the truth
right now. Ratings are TMDB audience scores. No affiliation with any streaming service is implied or
claimed.

The footer of the app shows TMDB attribution — "This product uses the TMDB API but is not endorsed or
certified by TMDB" — as required by TMDB's API terms.

## License

MIT. See [LICENSE](LICENSE).
