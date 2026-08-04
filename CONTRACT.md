# Frozen contract

Every module in this repo conforms to these shapes. Do not change any name, key, or shape without updating every consumer.

## Title record

```js
/**
 * @typedef {Object} Title
 * @property {string} id                       "netflix:81644889"  ("<providerSlug>:<providerTitleId>")
 * @property {string} t                        display title
 * @property {number|null} y                   release year, 1900..2100, else null
 * @property {"movie"|"series"} k              kind
 * @property {number|null} rt                  runtime in MINUTES, 1..600, else null
 * @property {string} s                        synopsis, "" when unknown
 * @property {string|null} im                  imdb id starting "tt", else null
 * @property {number|null} r                   rating, 0 < r <= 10, else null (0 means unknown, store null)
 * @property {string[]} p                      provider slugs, e.g. ["netflix"]
 * @property {Object<string,string>} u         provider slug -> watch URL
 * @property {string|null} img                 art URL, else null (kept short — prefer a CDN path
 *                                               fragment or a size-capped URL over a full original
 *                                               URL when the source offers one)
 */
```

Every record has exactly these 11 keys, always present, in this order.

## Catalog file — `docs/assets/catalog.json`

```json
{
  "schema": 1,
  "meta": {
    "region": "IN",
    "source": "unogs",
    "built_at": "2026-08-04T00:00:00Z",
    "count": 6954,
    "providers": ["netflix"],
    "filters": { "min_year": null, "min_rating": null, "limit": null }
  },
  "records": []
}
```

`docs/assets/catalog.meta.json` is byte-identical to the `meta` object alone (no wrapper).

## Provider registry

```js
const PROVIDERS = {
  netflix: { name: "Netflix", url: (tid) => "https://www.netflix.com/title/" + tid }
};
```

## Storage keys

```js
const KEYS = {
  llm:     "ottbyok.llm",       // { baseUrl, apiKey, model }
  youmd:   "ottbyok.youmd",     // string
  history: "ottbyok.history",   // { importedAt, series, movies, seen }
  chats:   "ottbyok.chats"      // array
};
const DEFAULT_LLM = {
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "anthropic/claude-sonnet-4.6"
};
```

## Search filters object

```js
// every field optional
{ k, yearFrom, yearTo, runtimeMin, runtimeMax, minRating, provider, excludeKeys }
// excludeKeys: string[] of normalizeTitle() outputs to drop
```

## Search index shape

```js
{ N: number, avgLen: number, len: Int32Array, df: Map<string,number>, postings: Map<string, number[]> }
// postings values are FLAT pairs: [docIndex, termFreq, docIndex, termFreq, ...]
```

## Parsed history shape

```js
{
  importedAt: "2026-08-04T00:00:00.000Z",
  series: [{ name: "Seinfeld", episodes: 79, lastWatched: "2026-02-12" }],
  movies: [{ title: "Dhurandhar", lastWatched: "2025-12-25" }],
  seen:   ["seinfeld", "dhurandhar"]
}
```

## Pick shape

```js
{ id, t, y, k, rt, r, p, u, img, reason }
```

## Agent event shapes

```js
{ type: "status",      text: string }
{ type: "tool_call",   name: string, args: object }
{ type: "tool_result", name: string, count: number }
{ type: "delta",       text: string }
{ type: "done",        picks: Pick[], usage: { prompt_tokens, completion_tokens } | null }
{ type: "error",       code: "auth"|"credit"|"rate"|"context"|"network"|"aborted"|"budget"|"parse", message: string }
```

## Tool names

Exactly four: `search_titles`, `filter_titles`, `get_titles`, `sample_titles`.

## Frozen DOM IDs

`app`, `catalog-status`, `query-form`, `query-input`, `send-btn`, `stop-btn`, `mood-select`, `results`, `trace`, `settings-btn`, `settings-dialog`, `llm-base-url`, `llm-api-key`, `llm-model`, `settings-save`, `settings-close`, `context-btn`, `context-dialog`, `youmd-input`, `history-file`, `history-summary`, `context-save`, `context-close`, `export-md`, `export-json`, `export-csv`, `export-youmd`, `error-banner`, `attribution`
