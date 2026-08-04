# Frozen contract

Every module in this repo conforms to these shapes. Do not change any name, key, or shape without updating every consumer.

## Title record

```js
/**
 * @typedef {Object} Title
 * @property {string} id      "tmdb:m1013577" (movie) | "tmdb:t240983" (tv) | "netflix:81644889" (uNoGS-only leftover)
 * @property {string} t       display title
 * @property {number|null} y  release year, 1900..2100, else null
 * @property {"movie"|"series"} k  kind; TMDB media_type "tv" maps to "series"
 * @property {number|null} rt runtime MINUTES, 1..600, else null
 * @property {string} s       synopsis. ALWAYS "" in catalog.json; real text lives in catalog.text.json
 * @property {string|null} im imdb id starting "tt", else null
 * @property {number|null} r  TMDB vote_average, 0 < r <= 10, else null (0 means unknown, store null)
 * @property {string[]} p     curated provider slugs, non-empty
 * @property {Object<string,string>} u  provider slug -> watch URL, every key must appear in p
 * @property {string|null} img "https://image.tmdb.org/t/p/w185" + poster_path when v >= 10, else null.
 *                              SPARSE BY RULE (payload budget): posters are only shipped for titles
 *                              with v >= 10 votes; lower-vote records always ship img null and the UI
 *                              renders the initials fallback for them.
 * @property {string|null} l  ISO-639-1 original language code, e.g. "hi", "ml", "en", else null
 * @property {string[]} g     TMDB genre names, [] when unknown
 * @property {number} v       TMDB vote_count, integer >= 0, 0 when unknown
 */
```

Every record has exactly these 14 keys, always present, in this order:
id, t, y, k, rt, s, im, r, p, u, img, l, g, v

## Catalog file — docs/assets/catalog.json

```json
{
  "schema": 2,
  "meta": {
    "region": "IN",
    "source": "tmdb+unogs+streaming_availability",
    "built_at": "2026-08-04T00:00:00Z",
    "count": 0,
    "providers": [],
    "provider_order": [],
    "languages": [],
    "genres": [],
    "text_file": "catalog.text.json",
    "filters": { "min_year": null, "min_rating": null, "limit": null }
  },
  "records": []
}
```

meta.providers is the sorted list of curated slugs actually present.
meta.provider_order is the same slugs ordered by the India display_priority from
catalog.db's provider table (ascending, ties alphabetical by label). The UI renders the
provider facet in this order, never alphabetically.
meta.languages is the sorted list of ISO-639-1 codes actually present.
meta.genres is the sorted list of genre names actually present.
docs/assets/catalog.meta.json is byte-identical to the meta object alone (no wrapper).

## Synopsis sidecar — docs/assets/catalog.text.json

```json
{ "schema": 2, "count": 0, "s": { "tmdb:m1013577": "A synopsis." } }
```

Keys of "s" are a subset of the catalog record ids. Records with no synopsis are omitted.

## Provider registry (curated, 26 slugs, region IN only)

TMDB provider lists are per-region. watch_region=IN returns 85 providers, US returns 330,
and no region parameter returns the global union of 881 across 139 regions. Every id below
comes from the IN list, and every availability row in catalog/catalog.db was fetched with
watch_region=IN. Never emit a provider outside this table, and never drop the region filter.

slug | label | TMDB provider ids merged into it | watch URL template
netflix     | Netflix         | 8, 175        | https://www.netflix.com/search?q={q}
prime       | Prime Video     | 119, 10, 2100 | https://www.primevideo.com/search?phrase={q}
hotstar     | JioHotstar      | 2336, 122     | https://www.hotstar.com/in/search?q={q}
zee5        | ZEE5            | 232           | https://www.zee5.com/search?q={q}
sonyliv     | SonyLIV         | 237           | https://www.sonyliv.com/search?searchTerm={q}
mubi        | MUBI            | 11, 201       | https://mubi.com/en/in/search/films?query={q}
crunchyroll | Crunchyroll     | 283, 1968     | https://www.crunchyroll.com/search?q={q}
sunnxt      | Sun NXT         | 309           | TMDB_FALLBACK
mxplayer    | MX Player       | 515, 1898     | TMDB_FALLBACK
discovery   | Discovery+      | 510, 584      | TMDB_FALLBACK
shemaroo    | ShemarooMe      | 474           | TMDB_FALLBACK
lionsgate   | Lionsgate Play  | 561, 2074, 2053 | TMDB_FALLBACK
manoramamax | ManoramaMAX     | 482, 2177     | TMDB_FALLBACK
hungama     | Hungama Play    | 437           | TMDB_FALLBACK
hoichoi     | Hoichoi         | 315, 2176     | TMDB_FALLBACK
aha         | aha             | 532           | TMDB_FALLBACK
curiosity   | CuriosityStream | 190, 603      | TMDB_FALLBACK
appletv     | Apple TV+       | 350           | TMDB_FALLBACK
epicon      | EPIC ON         | 476           | TMDB_FALLBACK
tataplay    | Tata Play       | 502           | TMDB_FALLBACK
plex        | Plex            | 538           | TMDB_FALLBACK
tubi        | Tubi            | 73            | TMDB_FALLBACK
docubay     | DocuBay         | 604           | TMDB_FALLBACK
bbcplayer   | BBC Player      | 285           | TMDB_FALLBACK
chaupal     | Chaupal         | 2178          | TMDB_FALLBACK
erosnow     | Eros Now        | 2059          | TMDB_FALLBACK

TMDB_FALLBACK means the URL is https://www.themoviedb.org/{movie|tv}/{tmdbId}/watch?locale=IN
(verified HTTP 200), which lists the real provider links. The five explicit templates above
were verified HTTP 200; zee5 and crunchyroll return 403 to curl due to Cloudflare bot
protection but the patterns are correct. {q} is encodeURIComponent of the title.
Sun NXT and MX Player search patterns were tested and returned 404, so they use TMDB_FALLBACK.

Excluded TMDB provider ids (rent/buy storefronts and unmapped channel aliases), never emitted:
2 (Apple TV Store), 3 (Google Play Movies), 192 (YouTube), 100, 444, 475, 546, 551, 554,
559, 562, 567, 569, 124, 2285, and every remaining "* Amazon Channel" id not listed above.

Netflix deep links: where a uNoGS record and a TMDB record share an imdb_id, u.netflix is the
uNoGS value https://www.netflix.com/title/{netflixId} instead of the search template.

## Genre vocabulary (27 names, from TMDB /genre/movie/list and /genre/tv/list)

Movie ids: 28 Action, 12 Adventure, 16 Animation, 35 Comedy, 80 Crime, 99 Documentary,
18 Drama, 10751 Family, 14 Fantasy, 36 History, 27 Horror, 10402 Music, 9648 Mystery,
10749 Romance, 878 Science Fiction, 10770 TV Movie, 53 Thriller, 10752 War, 37 Western
TV ids: 10759 Action & Adventure, 16 Animation, 35 Comedy, 80 Crime, 99 Documentary,
18 Drama, 10751 Family, 10762 Kids, 9648 Mystery, 10763 News, 10764 Reality,
10765 Sci-Fi & Fantasy, 10766 Soap, 10767 Talk, 10768 War & Politics, 37 Western

The builder MUST fetch both lists from the TMDB API at build time and emit the resulting
id->name map; the list above is for validation only. Exactly 27 distinct ids appear in
catalog/catalog.db, matching this union.

## LLM localStorage key (compatibility)

```js
const KEYS = {
  llm: "ottbyok.llm" // { baseUrl, apiKey, model, webSearch }
};
const DEFAULT_LLM = {
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "anthropic/claude-sonnet-4.6",
  webSearch: false
};
```

LLM configuration, including the API key, remains in `localStorage` for backward
compatibility. It is intentionally absent from IndexedDB and `memory.json` exports.
`webSearch` is a boolean, defaults to `false`, and is an explicit opt-in. It is valid
only when the configured chat-completions endpoint is OpenRouter
(`https://openrouter.ai/...`); the UI rejects an enabled setting for every other
endpoint rather than silently ignoring it. When enabled, the client requests
OpenRouter's web-search facility for that agent turn. This can send the prompt and
relevant model context to OpenRouter and its search providers, may retrieve current
web content, and can incur provider/search charges. It is not used for catalog
search, which remains local.

## Shared chat-completions client

`docs/js/llm-client.js` is the only reusable HTTP adapter for model calls:

```js
createChatCompletionsUrl(baseUrl) // -> absolute URL string
callChatCompletion(config, body, { fetchImpl = globalThis.fetch, signal = null } = {})
```

`createChatCompletionsUrl` appends `chat/completions` to the configured base path
(for example, `https://openrouter.ai/api/v1` becomes
`https://openrouter.ai/api/v1/chat/completions`). It rejects relative URLs and every
scheme except HTTP and HTTPS before a request can be issued. `callChatCompletion`
sends JSON with the configured `model` and `stream: false`, a
`Content-Type: application/json` header, and `Authorization: Bearer <apiKey>`. It
adds the OpenRouter web-search request field only for the valid opt-in above.
Failures use the stable error codes `auth`, `credit`, `rate`, `context`, `network`,
and `config`; abort errors from the supplied signal/fetch implementation propagate
unchanged.

## Catalog execution runtime

The model has one catalog-analysis tool, `run_catalog_js`. It replaces the separate
search, filter, sample, and get tool surface. The tool accepts only a JavaScript
`code` body; its fixed helper object is supplied by the runtime. It does not accept a
URL, arbitrary module name, or a caller-supplied catalog.

`docs/js/catalog-worker.js` is the long-lived, trusted catalog Worker. It loads the
catalog, applies the visitor's subscription boundary, builds basic and rich indexes,
and performs final title resolution. For each `run_catalog_js` call it creates a
fresh disposable `docs/js/catalog-executor.js` module Worker. The executor receives
the whole subscription-scoped analytical catalog and the fixed optional helper
surface (`search`, `where`, `get`, `sample`, and `normalizeTitle`), then returns
bounded structured JSON. It never receives watch URLs or poster URLs.

The analytical projection contains:

```js
{ id, t, y, k, rt, s, im, r, p, l, g, v }
```

It deliberately excludes `u` and `img`. Only the trusted catalog Worker may resolve
the model's observed IDs into complete, subscription-scoped display records. This
keeps watch links and image URLs out of code supplied by a model and re-applies the
subscription gate at the final boundary.

The disposable executor is fault containment, not a hostile-code security sandbox.
It has no DOM, and the app does not pass it storage adapters, credentials, user
context, network APIs, or direct catalog-worker authority. It best-effort disables
common Worker globals and rejects dynamic import syntax, then is terminated after
completion, timeout, or a protocol failure. Browser Workers do not make hostile
JavaScript safe; the runtime must not be presented as a security boundary.

### Runtime protocol, limits, and errors

Main thread to trusted-host requests are `{v:1,type:"request",epoch,id,op,payload}`.
Responses use the same `epoch` and `id` with `{type:"response",ok,value}` or a
structured `{code,message,retryable,phase}` error. Host state events are
`BOOTING`, `READY_BASIC`, `READY_RICH`, and `RESTARTING`. Operations are
`initialize`, `describe`, `keywordSearch`, `resolve`, `seedQueue`, and
`tool.execute`. The runtime owns worker lifecycle, ignores stale epochs, and rejects
pending requests from a failed host with `WORKER_RESTARTED`.

`run_catalog_js` is bounded to one active disposable executor per call. Code is
limited to 12,000 characters; executor initialization to 10 seconds; execution to
3 seconds; output to depth 8, 5,000 nodes, 100 array items per level, 2,000
characters per string, and 65,536 UTF-8 bytes. A queue may contain at most 20 IDs.
The agent's existing limits still apply: a query is at most 6,000 characters, You.md
context is at most 8,000 characters, prior conversation context is at most 18,000
characters, and a turn has at most eight model steps or 120 seconds.

Runtime errors include `NOT_READY`, `INVALID_ARGUMENT`, `CODE_TOO_LARGE`,
`COMPILE_ERROR`, `RUNTIME_ERROR`, `EXECUTOR_TIMEOUT`, `OUTPUT_NOT_JSON`,
`OUTPUT_LIMIT`, `WORKER_RESTARTED`, and `DISPOSED`. These remain distinct from
model-client errors (`auth`, `credit`, `rate`, `context`, `network`, and `config`).

### Readiness tiers

The catalog becomes **basic-ready** when the lean catalog has loaded and the trusted
Worker can serve the scoped analytical projection. Basic-ready turns may run title,
metadata, and provider analysis immediately. It becomes **rich-ready** when the
synopsis sidecar has loaded and the Worker has rebuilt the rich projection/index.
Rich-ready improves plot and theme analysis; a missing or failed sidecar must leave
basic-ready catalog analysis available rather than blocking the app.

## Browser memory

`docs/js/memory.js` owns local user memory in IndexedDB:

```js
const MEMORY_DB_NAME = "ottbyok.memory";
const MEMORY_DB_VERSION = 1;
const MEMORY_SCHEMA_VERSION = 1;
const MEMORY_STORE = "memory";
const MEMORY_KEYS = {
  profile: "profile",
  conversation: "conversation",
  queue: "queue",
  youmd: "youmd",
  history: "history"
};
```

The adapter is local-only; it does not use accounts, a backend, cloud sync, or
encryption. Browser storage can be cleared by the visitor or browser.

### Profile

```js
{
  schema: 1,
  updatedAt: "2026-08-05T00:00:00.000Z",
  onboardingComplete: false,
  providers: ["netflix", "prime"] // unique, lower-case curated provider slugs; maximum 26
}
```

### Current conversation

Exactly one current conversation is stored; there is no archived-chat collection.

```js
{
  schema: 1,
  updatedAt: "2026-08-05T00:00:00.000Z",
  messages: [
    { role: "user", content: "Something funny", createdAt: "2026-08-05T00:00:00.000Z" },
    { role: "assistant", content: "Try these.", createdAt: "2026-08-05T00:00:01.000Z" }
  ]
}
```

`role` is exactly `"user"` or `"assistant"`. The adapter keeps the newest 24 valid
messages and truncates each `content` string to 6,000 characters.
For model requests, `agent.js` applies a second transport budget: at most 18,000
characters of the newest complete prior turns and 8,000 characters of You.md.

### Recommendation queue

```js
{
  schema: 1,
  updatedAt: "2026-08-05T00:00:00.000Z",
  ids: ["tmdb:m1013577", "tmdb:t240983"]
}
```

`ids` are unique, non-empty catalog IDs in display order. The adapter keeps at most
20 items. `saveConversationAndQueue(conversation, queue)` writes both records in one
IndexedDB transaction for completed agent turns.

### User context

`youmd` is a string, capped at 50,000 characters. `history` is either `null` when no
file has been imported or uses the parsed-history shape below, with a serialized size
limit of 1 MiB.

### Migration, failure handling, and backups

On `initialize()`, the adapter imports legacy `localStorage` values only when their
IndexedDB records do not already exist:

```js
"ottbyok.youmd"    // string
"ottbyok.history"  // parsed-history JSON
```

It removes each old key only after the IndexedDB write is read back and verified. A
malformed legacy history value remains untouched and is surfaced as a `corrupt` issue.
Malformed IndexedDB records read as safe defaults and are surfaced through
`getIssues()` / the optional `onIssue` callback. Write, clear, and availability
failures reject with `BrowserMemoryError`, whose `code` is one of `quota`, `storage`,
`unavailable`, `blocked`, `aborted`, or `invalid`.

`exportBackup()` returns the versioned, key-free `memory.json` shape:

```js
{
  schema: 1,
  exportedAt: "2026-08-05T00:00:00.000Z",
  profile,
  conversation,
  queue,
  youmd,
  history
}
```

`importBackup(memoryJson)` validates every record before replacing them together in
one transaction. `clear()` deletes only these IndexedDB memory records; callers that
offer “clear local data” must additionally clear the compatible LLM localStorage key.

## Provider/language module — docs/js/providers.js

Single source of truth for the 26 curated provider slugs/labels and the 30 language
codes shown in the UI. `docs/js/catalog.js` stays import-free; the trusted catalog
runtime, `docs/js/exporters.js`, and `docs/js/ui.js` import these maps rather than
duplicating them.

```js
export const PROVIDER_LABELS       // { netflix: "Netflix", ... } — 26 entries
export const PROVIDER_SLUGS        // Object.keys(PROVIDER_LABELS)
export const DEFAULT_PROVIDER_ORDER // India display_priority fallback order, used
                                     // only until docs/assets/catalog.meta.json's own
                                     // provider_order has loaded
export const LANGUAGE_NAMES        // { en: "English", hi: "Hindi", ... } — 30 entries
export function providerLabel(slug)
export function languageLabel(code)
export function linkKind(slug, url)   // "direct" | "search" | "fallback" | null
export function watchCta(slug, url)   // CTA text matching the link kind, e.g.
                                       // "Watch on Netflix" / "Find on ZEE5" /
                                       // "See where to watch (TMDB)"
export function intersectProviders(rec, allowed) // returns rec with p/u restricted
                                                  // to the given Set/array of slugs
```

`linkKind`/`watchCta` distinguish the three link kinds from the Provider registry
table above instead of implying every link starts playback directly: a true per-title
deep link (currently only `u.netflix` values shaped like `.../title/{id}`) is
`"direct"`; any other provider-templated URL is `"search"`; a
`themoviedb.org/{movie|tv}/{id}/watch` URL is `"fallback"`.

## Search filters object

```js
// every field optional
{ k, yearFrom, yearTo, runtimeMin, runtimeMax, minRating, provider, lang, genre, excludeKeys, providers }
// lang: ISO-639-1 string, matched against rec.l exactly
// genre: genre name string, matched with rec.g.includes(genre)
// excludeKeys: string[] of normalizeTitle() outputs to drop
// provider: single slug, matched with rec.p.includes(provider) — a caller-requested
//           facet narrowing (e.g. "only Netflix")
// providers: Set<string> | string[], the visitor's subscription gate — a record
//            survives only if rec.p includes at least one member. AND-ed on top of
//            every other filter, including `provider`. An empty set excludes
//            everything. The trusted catalog Worker applies this to every
//            run_catalog_js execution and resolve operation; callers that build
//            filters by hand (e.g. the local queue seed) pass it explicitly.
```

## Local recommendation queue seed — catalog.js seedQueue()

```js
seedQueue(records, { providers, excludeKeys, limit = 20 }) // -> string[] of catalog ids
```

Used before the first message in a chat to populate the recommendation display with
no LLM call: `filterIndices(records, { providers, excludeKeys })`, then ranked by
`rating * (1 + 0.12 * Math.log10(1 + votes))` — the same popularity-prior shape as
`search()`'s bm25 boost, with `rec.r` (defaulting to 0) standing in for bm25 — and
capped at `limit`.

## Search index shape

```js
{ N: number, avgLen: number, len: Int32Array, df: Map<string,number>,
  postings: Map<string, number[]>, votes: Int32Array }
// postings values are FLAT pairs: [docIndex, termFreq, docIndex, termFreq, ...]
// votes[i] is records[i].v, or 0 when absent
```

## Popularity prior (frozen formula)

In search(), the final score for document d is:
  bm25 * (1 + 0.12 * Math.log10(1 + votes))
where votes = index.votes ? index.votes[d] : 0. A record with v=0 therefore scores
exactly bm25 (boost is exactly 1.0), so existing tests are unaffected.

## Parsed history shape

```js
{
  importedAt: "2026-08-04T00:00:00.000Z",
  series: [{ name: "Seinfeld", episodes: 79, lastWatched: "2026-02-12" }],
  movies: [{ title: "Dhurandhar", lastWatched: "2025-12-25" }],
  seen:   ["seinfeld", "dhurandhar"]
}
```

## Pick / hydrated-card shape

```js
{ id, t, y, k, rt, r, p, u, img, reason }
```

`p` and `u` are already restricted to the visitor's subscribed providers (see
`intersectProviders` above). `reason` is `""` when nothing supplied one; the model
returns a chat-level reply rather than per-title reasons. Hydrating a persisted queue
ID after reload always yields `reason: ""`.

## docs/js/agent.js runAgent() call shape

```js
runAgent({
  config,               // { baseUrl, apiKey, model, webSearch }
  prompts,               // docs/assets/prompts.json
  runtime,               // trusted catalog runtime; exposes run_catalog_js
  context: { youmd, history, mood },
  query,                 // this turn's new user message (string)
  conversation,          // prior turns only, [{ role: "user"|"assistant", content }],
                         // i.e. memory's conversation.messages BEFORE this turn is
                         // appended — included as real chat messages ahead of the
                         // planner prompt so multi-turn context reaches the model
  onEvent, signal, fetchImpl, budget // unchanged
})
// -> { ok: boolean, reply: string, queue: string[] | null, usage }
```

`ok` is `true` only for a successfully parsed final response. Authentication,
configuration, catalog-runtime, network, abort, budget, and parse failures return
`ok: false`; callers must not persist those failures as assistant replies.

## Agent event shapes

```js
{ type: "status",      text: string }
{ type: "tool_call",   name: string, args: object }
{ type: "tool_result", name: string, count: number }
{ type: "done",        reply: string, queue: string[] | null, usage: { prompt_tokens, completion_tokens } | null }
{ type: "error",       code: "auth"|"config"|"credit"|"rate"|"context"|"network"|"aborted"|"budget"|"parse"|
                         "catalog_unavailable"|"catalog_not_ready"|"invalid_request"|"invalid_code"|"protocol"|
                         "execution"|"timeout"|"output_limit"|"resolve_failed", message: string }
```

`"done"` carries `reply` (shown verbatim as the assistant's chat message for this
turn) and `queue`, not per-card picks. `queue` is `null` when the model omitted a
queue update — leave the display unchanged — and an array when it supplied one,
including an explicit empty array to clear the display. The `"delta"` event is not
emitted; a complete reply is available only at `"done"`.

## Final response and queue grounding

Every no-tool model answer is the final answer for that turn. It must be JSON on the
first such answer; the agent does not make a rerank or formatting follow-up request.
The final response must be exactly:

```json
{ "reply": "<1-4 sentences shown verbatim in the chat transcript>", "queue": ["<catalog id>", "..."] }
```

`reply` is required and is plain prose (no markdown, JSON fences, or code fences).
`queue` is optional: it is 0–20 catalog IDs, best first, with duplicates dropped.
Omitting `queue` means leave the current display untouched; an explicit
`"queue": []` clears it.

Queue IDs are grounded in the set of IDs observed in successful `run_catalog_js`
results for the current turn. The agent drops IDs that were not observed, then asks
the trusted catalog Worker to resolve the remaining IDs. Resolution re-checks the
current subscription scope; unresolved or out-of-scope IDs are silently omitted.
The model can discuss a title freely, but it cannot place an invented, unobserved, or
unavailable ID into the saved recommendation queue.

## Tool names

Exactly one: `run_catalog_js`. The agent exposes no per-operation title tools. The
trusted runtime applies the visitor's subscription gate to every execution and to
every subsequent resolve operation, so model code cannot widen its catalog scope.

## Frozen DOM IDs

This list changed substantially for the sidebar/chat/recommendation-display shell
overhaul (onboarding screen + sidebar + chat + queue, replacing the single-form
layout); the data shapes elsewhere in this document did not change because of it.

Always present:
app, error-banner, attribution

Onboarding (shown once, gated by `profile.onboardingComplete`):
onboarding-screen, onboarding-form, onboarding-provider-list, onboarding-llm-base-url,
onboarding-llm-api-key, onboarding-llm-model, onboarding-youmd-input,
onboarding-history-file, onboarding-history-summary, onboarding-continue

Shell:
shell, sidebar-toggle, sidebar, backdrop, new-chat-btn, conversation-indicator,
subscriptions-summary, context-btn, settings-btn, disclosure-btn, export-backup-btn,
import-backup-btn, import-backup-file, clear-data-btn, catalog-status, workspace

Chat region:
chat-region, chat-transcript, chat-note, query-form, query-input, mood-select,
language-select, genre-select, provider-select, send-btn, stop-btn

Recommendation display:
queue-region, queue-status, queue-viewport, queue-track, queue-prev, queue-next,
queue-empty

Dialogs:
settings-dialog, settings-provider-list, llm-base-url, llm-api-key, llm-model,
settings-feedback, settings-save, settings-close, context-dialog, youmd-input,
history-file, history-summary, history-remove, context-feedback, context-save,
context-close, disclosure-dialog, catalog-detail, trace, export-md, export-json,
export-csv, export-youmd, disclosure-feedback, disclosure-close

Removed from schema 2 (no longer in the markup): `results` (the recommendation
display is now `queue-track`, a 2x3 paged grid, not a single-column list).
mood-select/language-select/genre-select/provider-select all survive unchanged by
id, just relocated into `chat-region`'s composer row; `provider-select` now only
ever lists the visitor's *subscribed* providers, not all 26.
