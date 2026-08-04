# India OTT Search — bring your own key

Live: https://artvandelay.github.io/india-ott-byok/

## What this is

The site ships a static snapshot of what is streaming in India, plus all of the search logic that runs
over it. The visitor brings the other two pieces: their own LLM API key, and their own taste context. An
onboarding flow collects the services you subscribe to, a required OpenRouter key, and an optional
watch-history export. It has exactly three steps: subscriptions, key, and history. Afterward, a
three-region shell — sidebar, chat, and a recommendation display — remembers your current conversation,
recommendation queue, and saved playlists across reloads.

Nothing runs on a server — no backend, no database, no analytics, no accounts, no cloud sync. Your API
key is held in `localStorage`; subscriptions, You.md, watch history, conversation, recommendation queue,
and playlists are held in IndexedDB via `docs/js/memory.js`. Chat queries and bounded context are sent
directly to the configured endpoint with the key for authentication. When you import history, only
filenames, structural metadata, and deterministic bounded sample rows or records are sent directly to
OpenRouter to infer the file layout; the complete upload stays in your browser.

## Why

OTT catalogs are enormous, and their built-in search only matches titles. You cannot find something by
describing it. This searches meaning across synopses, and then ranks the matches against who you
actually are.

## Bring your own key

Onboarding requires a nonempty OpenRouter key. It stores the app's default OpenRouter endpoint and model;
you can change compatible endpoint and model settings later in the in-app **Settings** dialog.

The key is stored only in `localStorage` on your device — it is never sent anywhere except to the
configured endpoint. It is required to enter the normal app experience.

No catalog key of any kind is needed at runtime. The catalog is a static JSON file built ahead of time
(see below) and shipped with the site.

## Bring your own context

Two optional inputs shape the ranking:

- **You.md** — a free-form markdown description of your taste. Write it however you like: favorite
  directors, moods you are in, and things you never want to see again. It is editable later in
  **Profile & context**, not during onboarding.
- **Watch history** — import a `.csv`, `.json`, or `.zip` export. ZIP files may contain CSV or JSON
  candidates. The parser works locally; only a bounded structural sample is sent to OpenRouter for
  schema inference, never the full file.

Both stay in this browser. The app limits upload, archive, sample, and normalized-history sizes to keep
the import bounded.

## Subscriptions are a hard boundary

Onboarding (and Settings, later) asks which of the 26 curated India services you actually subscribe to.
Every search, filter, sample, and recommendation-display card is restricted to titles available on at
least one of those services, and every watch link shown is intersected down to just your subscriptions —
you never see a provider or a link for a service you didn't select. A title's link is labelled to match
what it actually is: a true per-title deep link ("Watch on ..."), a provider search page ("Find on ..."),
or the shared TMDB watch page that lists real providers itself ("See where to watch").

## Ask naturally

The composer is a minimal natural-language prompt. Ask for runtime, language, genre, mood, provider, or
anything else in ordinary words; the agent's structured catalog tools retain those filters while selected
subscriptions remain a hard boundary.

Ratings shown are TMDB `vote_average` (audience scores out of 10), not IMDb ratings.

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

Module checks (development-only):

```bash
npm run check
```

### Whole-app boot test

`scripts/check_app_boot.mjs` boots the real `docs/index.html` and the real `docs/js/ui.js` in jsdom,
against a small catalog fixture and a fresh IndexedDB, and drives the app the way a user would:
onboarding step by step, creating and exporting playlists, reloading, round-tripping a memory backup,
rejecting a malformed backup without data loss, the mobile drawer, the developer shortcut, and a query
with no key configured.

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

Stress suites:

```bash
node scripts/stress_*.mjs
```

`stress_agent_live.mjs` makes real LLM calls and needs `OPENROUTER_API_KEY` in the root `.env`; it
exits non-zero when the key is absent, so it is safe to include in CI where the key may not exist.

### Local testing bypass

Mostly superseded by the boot test above; useful when you want to poke at the live UI by hand.
`?testMode=1` bypasses onboarding when the hostname is exactly `localhost` or
`127.0.0.1`. Add `testProviders=netflix,prime` to select known providers; without it, the default is
Netflix. Production hosts and localhost-like subdomains ignore this flag, and it never creates or stores
an API key.

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
  - `docs/js/tools.js` — browser-local agent tools, subscription-gated
  - `docs/js/agent.js` — OpenAI-compatible tool-calling loop with bounded multi-turn
    history and a reply + optional queue-update response
  - `docs/js/memory.js` — versioned IndexedDB adapter for profile, conversation, queue, You.md, watch
    history, and playlists (see CONTRACT.md's "Browser memory" section)
  - `docs/js/store.js` — localStorage, now scoped to just the LLM key/model/baseUrl
  - `docs/js/exporters.js` — output formats
  - `docs/js/views/` — onboarding, sidebar, chat, Markdown, recommendation-queue, playlist, and dialog
    UI modules, coordinated by `docs/js/ui.js`
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

`docs/js/ui.js` coordinates the DOM-facing views. The history importer keeps complete files local and
uses the shared LLM client only for its bounded schema-inference request; catalog and agent tools still
enforce subscription gating before candidates and links reach the UI.

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
