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
you can point the app at any other compatible base URL.

The key is stored only in `localStorage` on your device — it is never sent anywhere except to the
endpoint you configured. Keyword search works with no key at all; the key only unlocks the LLM-ranked
semantic search.

## Bring your own context

Two optional inputs shape the ranking:

- **You.md** — a free-form markdown description of your taste. Write it however you like: favorite
  directors, moods you are in, things you never want to see again.
- **Netflix viewing history** — import the CSV that Netflix gives you under
  Netflix Account -> Profile -> Viewing activity -> Download all.

Both stay on the device, and both can be exported back out at any time.

## Export

Results export as Markdown, JSON, CSV, or an updated You.md.

## Run it locally

```bash
python3 -m http.server 8000 --directory docs
# then open http://localhost:8000
```

## Rebuild the catalog

The shipped catalog merges two sources: a uNoGS-derived Netflix dump, and the movieofthenight Streaming
Availability API for eight more India services (Prime Video, JioHotstar, Zee5, SonyLIV, Apple TV, Mubi,
Crunchyroll, Curiosity Stream).

```bash
python3 scripts/build_catalog.py --source unogs
python3 scripts/fetch_streaming_availability.py
python3 scripts/build_catalog.py --source streaming_availability \
  --out docs/assets/catalog.sa.json --meta-out docs/assets/catalog.sa.meta.json
python3 scripts/validate_catalog.py docs/assets/catalog.json
```

Both inputs (`data/unogs_catalog/*.jsonl.gz` and `data/streaming_availability/`) are fetched from
RapidAPI-gated sources and are not committed to this repo. Merging the two builds into the single shipped
`docs/assets/catalog.json` is currently a manual step (see `research/CATALOG-STRATEGY.md`); the merge
drops the smaller, redundant Netflix rows from the Streaming Availability source (uNoGS's Netflix data is
deeper) and drops poster images from that source, since its CDN URLs are signed and expire after a few
months.

## Development checks

```bash
node scripts/check_catalog.mjs
node scripts/check_history.mjs
node scripts/check_tools.mjs
node scripts/check_agent.mjs
node scripts/check_store.mjs
node scripts/check_exporters.mjs
```

These are development-only. The published site has no build step and no npm dependencies.

## Architecture

- `docs/js/catalog.js` — BM25 search
- `docs/js/history.js` — Netflix CSV parsing
- `docs/js/tools.js` — browser-local agent tools
- `docs/js/agent.js` — OpenAI-compatible tool-calling loop
- `docs/js/store.js` — localStorage
- `docs/js/exporters.js` — output formats
- `docs/js/ui.js` — the only module that imports the others

Every other module is import-free and receives its dependencies as arguments.

## Data and attribution

The catalog is a point-in-time snapshot spanning nine India OTT providers: Netflix, Prime Video,
JioHotstar, Zee5, SonyLIV, Apple TV, Mubi, Crunchyroll, and Curiosity Stream. Availability changes
constantly, so treat anything here as a starting point rather than the truth right now. Poster art is
only available for Netflix titles — the other providers' CDN image URLs are signed and expire, so they
are intentionally omitted rather than shipped as a time bomb. No affiliation with any streaming service
is implied or claimed.

See `research/CATALOG-STRATEGY.md` for the full sourcing analysis, including which aggregators were
evaluated and why, and what still needs a paid key (TMDB enrichment, Watchmode for the regional long
tail) to go further.

> TODO before making this repo public: confirm redistribution terms for both catalog sources (uNoGS via
> RapidAPI, and the Streaming Availability API via RapidAPI/movieofthenight), and add the required
> attribution line for whichever sources ship.

## License

MIT. See [LICENSE](LICENSE).
