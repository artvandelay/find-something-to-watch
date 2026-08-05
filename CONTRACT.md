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

## Shared title-details model

The main thread resolves title details directly from the full shipped record and
synopsis sidecar; it must never hydrate a Worker-projected card to create this model.

```js
{
  status: "available" | "missing",
  id: string,
  title: null | { t, y, k, rt, s, im, r, img, l, g, v },
  availability: [{
    slug: string,
    label: string,
    subscribed: boolean,
    url: string | null,
    cta: string | null
  }],
  catalog: {
    region: string | null,
    source: string | null,
    builtAt: string | null
  }
}
```

`availability` preserves the record's `p` order and includes every curated provider
slug known for that title. The title-details overlay is the sole display exception to
the subscription boundary: it groups availability into “On your subscriptions” and
“Other known platforms.” Recommendations, search, Worker analysis, normal cards, and
normal provider links remain subscription-scoped.

The UI may display only catalog fields above. It must not manufacture cast, directors,
trailers, certification, pricing, provider logos, or playback certainty. “All
platforms” means all curated provider slugs recorded in `p`, not exhaustive or
real-time availability.

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
  llm: "ottbyok.llm",      // { baseUrl, apiKey, model, webSearch }
  sidebar: "ottbyok.sidebar" // "1" collapsed | "0" expanded — presentation only
};
const DEFAULT_LLM = {
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "anthropic/claude-sonnet-4.6",
  webSearch: false
};
```

`ottbyok.sidebar` holds only the sidebar collapse preference so the icon rail survives
a reload; it carries no user data and is cleared by "Clear local data" along with the
other keys. Below 1280px the sidebar auto-collapses regardless of the stored value, and
below 900px the drawer replaces the rail entirely.

LLM configuration, including the API key, remains in `localStorage` for backward
compatibility. It is intentionally absent from IndexedDB and `memory.json` exports.
`webSearch` is a strict boolean and defaults to `false`. The Settings-only checkbox
may persist it as `true` only when the configured base URL hostname is exactly
`openrouter.ai`; onboarding has no web-search control. An enabled turn may append
`{ type: "openrouter:web_search" }` to the model tools, which can add OpenRouter
search and model cost. Catalog search remains local.

## Shared chat-completions client

`docs/js/llm-client.js` is the only reusable HTTP adapter for model calls:

```js
createChatCompletionsUrl(baseUrl) // -> absolute URL string
callChatCompletion(config, body, { fetchImpl = globalThis.fetch, signal = null } = {})
streamChatCompletion(config, body, {
  fetchImpl = globalThis.fetch,
  signal = null,
  onEvent
})
```

`createChatCompletionsUrl` appends `chat/completions` to the configured base path
(for example, `https://openrouter.ai/api/v1` becomes
`https://openrouter.ai/api/v1/chat/completions`). It rejects relative URLs and every
scheme except HTTP and HTTPS before a request can be issued. `callChatCompletion`
sends JSON with the configured `model` and `stream: false`, a
`Content-Type: application/json` header, and `Authorization: Bearer <apiKey>`.
Failures use the stable error codes `auth`, `credit`, `rate`, `context`, `network`,
and `config`; abort errors from the supplied signal/fetch implementation propagate
unchanged.

`streamChatCompletion()` is used for agent requests; non-streaming
`callChatCompletion()` remains the history-import inference client. The streaming
client parses complete SSE events across arbitrary chunks, CRLF, multiline data,
comments, `[DONE]`, terminal usage, and fragmented tool calls. It resolves to:

```js
{
  id: string | null,
  model: string | null,
  message: { role: "assistant", content: string, tool_calls?: [] },
  usage: object | null
}
```

`onEvent` receives only `{ type: "content", text }` and `{ type: "heartbeat" }`.
Its parser bounds retained buffers and tool arguments, and cancels the stream reader
when the supplied signal aborts or when processing fails.

## Catalog execution runtime

The model has exactly one catalog-analysis function, `run_catalog_js`. It accepts an
explicit JavaScript `code` string and runs it against subscription-scoped analytical
data. The main thread retains the trusted presentation catalog used for cards,
playlists, initial queue seeding, and no-key keyword search. Model-authored analysis
runs in Workers.

`createCatalogRuntime({ workerFactory, onState, requestTimeoutMs })` exposes
`initialize`, `describe`, `runCode`, `keywordSearch`, `resolve`, `seedQueue`,
`dispose`, `state`, and `epoch`. Its outer Worker protocol is version 2:

```js
{ v: 2, type: "request", epoch, id, op, payload }
{ v: 2, type: "cancel", epoch, id }
```

The runtime states are `BOOTING`, `READY_BASIC`, `READY_RICH`, and `RESTARTING`.
The supported operations are `initialize`, `describe`, `keywordSearch`, `resolve`,
`seedQueue`, and `tool.execute`. The host uses bounded request timeouts; initialization
and normal requests default to 30 seconds, catalog code has a 15-second host timeout,
and a disposable executor has 10 seconds to initialize and 3 seconds to run. A rich
synopsis-sidecar failure is non-fatal: `READY_BASIC` remains usable.

Aborting a request removes its pending host entry, posts one matching `cancel`, rejects
with a named `AbortError`, and suppresses late responses. Cancellation terminates only
the matching disposable executor; it never restarts the trusted catalog host.

The trusted catalog Worker applies `{ subscriptions: string[] }` to every operation.
For each tool call it creates a fresh disposable executor Worker. The executor receives
only the analytical projection and fixed helpers (`search`, `where`, `get`, `sample`,
and `normalizeTitle`):

```js
{ id, t, y, k, rt, s, im, r, p, l, g, v }
```

The projection deliberately excludes `u` and `img`. It is frozen before execution.
Source is limited to 12,000 characters and rejects the standalone `import` keyword.
Returned values must be plain JSON-like data: depth 8, 5,000 nodes, 100 array items,
2,000 characters per string, and 65,536 UTF-8 output bytes; cycles, accessors, array
holes, non-finite values, and unsupported values are rejected.

Trusted resolved cards contain:

```js
{ id, t, y, k, rt, r, p, u, img, s, l, g, reason }
```

`createTools({ runtime, scope, currentQueueIds, seenKeys })` exposes one public
schema and forwards normalized `seenKeys` as `excludeKeys` in every `runCode` request.
Only IDs observed in a successful `run_catalog_js` result, or already in
`currentQueueIds`, can reach `runtime.resolve`; resolution re-applies subscriptions
and caps requests at 20 IDs.

The disposable executor is fault containment, not a hostile-code security sandbox.
It receives no keys, user memory, watch history, watch URLs, images, DOM access, or
network capabilities. Reassess this prototype boundary before adding accounts,
authenticated APIs, session cookies, cloud memory, payment data, or other sensitive
data.

## Browser memory

`docs/js/memory.js` owns local user memory in IndexedDB:

```js
const MEMORY_DB_NAME = "ottbyok.memory";
const MEMORY_DB_VERSION = 1;
const MEMORY_SCHEMA_VERSION = 3;
const MEMORY_STORE = "memory";
const MEMORY_KEYS = {
  profile: "profile",
  conversation: "conversation",
  queue: "queue",
  threads: "threads",
  learned: "learned",
  youmd: "youmd",
  history: "history",
  playlists: "playlists"
};
```

The adapter is local-only; it does not use accounts, a backend, cloud sync, or
encryption. Browser storage can be cleared by the visitor or browser.

### Profile

```js
{
  schema: 3,
  updatedAt: "2026-08-05T00:00:00.000Z",
  onboardingComplete: false,
  providers: ["netflix", "prime"], // unique, lower-case curated provider slugs; maximum 26
  memoryEnabled: true
}
```

### Current conversation

```js
{
  schema: 3,
  id: "conversation-id",
  title: "Something funny",
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
  messages: [
    { role: "user", content: "Something funny", createdAt: "2026-08-05T00:00:00.000Z" },
    {
      role: "assistant",
      content: "Try these.",
      createdAt: "2026-08-05T00:00:01.000Z",
      meta: {
        status: "complete",
        timing: { totalMs: 18400, firstTokenMs: 320 },
        usage: { promptTokens: 320, completionTokens: 98, totalTokens: 418, requestCount: 2 },
        billing: {
          basis: "provider_reported",
          amountUsd: 0.0042,
          complete: true,
          requestCount: 2,
          pricedRequestCount: 2
        }
      }
    }
  ]
}
```

`role` is exactly `"user"` or `"assistant"`. The adapter keeps the newest 24 valid
messages and truncates each `content` string to 6,000 characters. `title` is the first
user query with collapsed whitespace, capped at 72 characters. Assistant `meta` exists
only for a complete streamed turn and contains only the shapes above.
For model requests, `agent.js` applies a second transport budget: at most 18,000
characters of the newest complete prior turns and 8,000 characters of You.md.

### Recommendation queue

```js
{
  schema: 3,
  updatedAt: "2026-08-05T00:00:00.000Z",
  source: {
    conversationId: "conversation-id",
    turnId: "turn-id",
    query: "something short, no horror"
  },
  items: [
    { id: "tmdb:m1013577", reason: "A catalog-grounded fit explanation." },
    { id: "tmdb:t240983", reason: "A second catalog-grounded fit explanation." }
  ]
}
```

`source` is `null` or contains a current conversation and turn ID plus a collapsed,
120-character maximum query. `items` contains at most 20 unique, non-empty catalog
IDs in rank order, each with a catalog-grounded `reason` capped at 180 characters.
The first item is the Top pick, items two and three are Alternatives, and later items
are initially collapsed. Invalid or missing reasons fall back to “Selected from your
catalog for this request.” An omitted queue update preserves the current decision; an
explicit empty queue clears it. Every persisted ID must have passed current
tool-grounding rules.

Schema-2 `{ ids }` queues migrate to schema 3 in the same order, with `source: null`
and fallback reasons.

### Conversation archive

```js
{
  schema: 3,
  updatedAt: "2026-08-05T00:00:00.000Z",
  items: [{ ...conversation, queue }]
}
```

`threads.items` stores up to 20 non-empty inactive conversations, newest first, each
with its full ranked queue. A current conversation is never duplicated in its archive.
`appendUserMessage`, `completeTurn`, `startNewConversation`,
`activateArchivedConversation`, and `getConversationList` are atomic memory APIs.
They reject stale conversation IDs and retain playlists, history, subscriptions, and
LLM configuration when starting or activating a conversation.

`completeTurn(conversationId, { content, queue, meta, learned })` writes the completed
assistant message, ranked queue, and an optional validated learned-preference record in
one atomic browser-memory write. The caller persists the user message before starting
model work and only supplies `meta` for a complete streamed turn.

### Learned preferences

```js
{
  schema: 1,
  updatedAt: "2026-08-05T00:00:00.000Z",
  revision: 1,
  items: [{
    id: "learned-id",
    kind: "genre" | "language" | "theme" | "pace" |
          "creator" | "format" | "content",
    polarity: "like" | "avoid",
    value: "documentaries",
    createdAt: "2026-08-05T00:00:00.000Z",
    lastConfirmedAt: "2026-08-05T00:00:00.000Z"
  }]
}
```

The adapter stores at most 100 facts with values capped at 80 characters and renders
at most 4,000 characters into model context. A turn considers at most eight candidates.
It learns only explicit, durable entertainment preferences where the evidence is an
exact case-insensitive substring of the latest user query. Each model-produced candidate
must include `explicit: true` and `durable: true`; candidates with missing or false flags,
missing or mismatched evidence, or malformed fields are rejected. The model owns the
semantic judgment and must omit ordinary requests (for example, “horror recommendations”),
temporary requests, and sensitive inferences. Local validation performs no keyword-based
semantic inference. Evidence itself is never persisted.
Manually authored You.md remains separate. The generated “Learned from chats” context
is inspectable, editable, disableable, and clearable by the user.

### User context

`youmd` is a string, capped at 50,000 characters. `history` is either `null` when no
file has been imported or uses the parsed-history shape below, with a serialized size
limit of 1 MiB.

### Playlists

The `playlists` memory record has its own domain schema:

```js
{
  schema: 1,
  updatedAt: "2026-08-05T00:00:00.000Z",
  playlists: [
    {
      id: "watch-later",
      name: "Watch later",
      titleIds: ["tmdb:m1013577"],
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z"
    }
  ]
}
```

The `watch-later` playlist is always first and cannot be renamed or deleted. Names
are trimmed, 1–80 characters, and unique case-insensitively. A browser may store at
most 50 playlists and 500 unique, non-empty catalog title IDs in each playlist.
Recommendation queue and playlist state are independent: New chat may replace only
conversation and queue and must never clear or rewrite playlists.

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

Existing databases remain at IndexedDB version 1. Initialization adds a default,
empty Watch later record when `playlists` is absent; it does not discard any other
record. Logical record schemas are upgraded to `MEMORY_SCHEMA_VERSION` 3.

`exportBackup()` returns the versioned, key-free `memory.json` shape:

```js
{
  schema: 3,
  exportedAt: "2026-08-05T00:00:00.000Z",
  profile,
  conversation,
  queue,
  threads,
  learned,
  youmd,
  history,
  playlists
}
```

Backups are export-only in this version. The browser-memory adapter and user interface
do not expose backup import. Backup exports do not contain LLM configuration or the
adapter's diagnostic `issues` list.

`clear()` deletes all eight IndexedDB memory records, including playlists. Callers that
offer “clear local data” must additionally clear the compatible LLM localStorage key.

## Provider/language module — docs/js/providers.js

Single source of truth for the 26 curated provider slugs/labels and the 30 language
codes shown in the UI; `docs/js/catalog.js` stays import-free, but `docs/js/tools.js`,
`docs/js/exporters.js`, and `docs/js/ui.js` all import from here instead of duplicating
these maps (they used to each keep their own copy).

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
//            everything. The trusted catalog Worker applies this to every model
//            execution and resolve operation; callers that build filters by hand
//            (e.g. the local queue seed) pass it explicitly.
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

## Watch-history import contract

Accepted uploads are CSV, JSON, and ZIP. A ZIP may contribute only CSV/JSON
candidates. Full uploaded files remain in the browser. The one schema-inference
request may contain only candidate filenames, structural metadata, and deterministic
bounded sample rows/records.

Frozen limits:

```js
{
  uploadBytes: 10 * 1024 * 1024,
  extractedTextBytes: 25 * 1024 * 1024,
  archiveEntries: 100,
  candidateFileBytes: 5 * 1024 * 1024,
  records: 50000,
  fields: 64,
  fieldCharacters: 2000,
  inferenceInputCharacters: 12000,
  inferenceOutputCharacters: 4000,
  normalizedHistoryBytes: 1024 * 1024
}
```

The bounded inference input is JSON with schema 1:

```js
{
  schema: 1,
  files: [
    {
      name: "ViewingActivity.csv",
      format: "csv", // "csv" | "json"
      structure: { rows: 120, columns: 3, headers: ["Title", "Date", "Type"] },
      sample: [["Example title", "2026-08-04", "movie"]]
    }
  ]
}
```

For JSON candidates, `structure` contains `recordsPath` candidates and observed key
paths, and `sample` contains bounded JSON records. Strings in both fields respect the
field cap and the serialized request respects the inference-input cap. Counts and
metadata may describe the full local candidate, but no unsampled row/record value is
included.

`HistoryImportPlan` is declarative JSON with schema 1:

```js
{
  schema: 1,
  files: [
    {
      name: "ViewingActivity.csv",
      format: "csv",
      headerRow: 0,
      dataStartRow: 1,
      titleColumn: 0,
      dateColumn: 1,
      typeColumn: 2,
      seriesColumn: null,
      episodeColumn: null,
      dateFormat: "ymd", // "ymd" | "dmy" | "mdy" | "iso" | "none"
      typeMap: {
        movie: ["movie", "film"],
        series: ["series", "show", "episode"]
      }
    },
    {
      name: "history.json",
      format: "json",
      recordsPath: ["data", "items"],
      titlePath: ["title"],
      datePath: ["watchedAt"],
      typePath: ["type"],
      seriesPath: null,
      episodePath: null,
      dateFormat: "iso",
      typeMap: {
        movie: ["movie"],
        series: ["series"]
      }
    }
  ]
}
```

CSV row/column indices are non-negative integers within inspected bounds. JSON paths
are arrays of plain string property names; `null` is allowed only for optional
date/type/series/episode selectors. `format`, `dateFormat`, and output type are closed
enums. `typeMap` values are bounded arrays of literal strings matched
case-insensitively. Plans with unknown files, properties, formats, enums, invalid
indices/paths, regexes, expressions, or executable content fail closed. Model output
must contain one JSON object within the 4,000-character cap.

Applying a valid plan locally returns normalized history:

```js
{
  schema: 2,
  importedAt: "2026-08-04T00:00:00.000Z",
  sources: [
    { name: "ViewingActivity.csv", format: "csv", records: 80 }
  ],
  series: [{ name: "Seinfeld", episodes: 79, lastWatched: "2026-02-12" }],
  movies: [{ title: "Dhurandhar", lastWatched: "2025-12-25" }],
  other:  [{ title: "Unknown item", lastWatched: null }],
  seen:   ["seinfeld", "dhurandhar"]
}
```

Dates must be real calendar dates normalized to `YYYY-MM-DD`; invalid dates are
discarded rather than rolled over. At most 50,000 local rows/records are processed,
all strings and field counts are capped, and the serialized normalized result must
not exceed 1 MiB. `parseNetflixCsv` remains a backward-compatible wrapper over the
provider-agnostic local parser.

## Pick / hydrated-card shape

```js
{ id, t, y, k, rt, r, p, u, img, s, l, g, reason }
```

`p` and `u` are already restricted to the visitor's subscribed providers (see
`intersectProviders` above). `reason` comes from the validated ranked queue and falls
back to the frozen generic reason when it is invalid or missing. Hydrated cards retain
subscription-scoped `p` and `u`; the shared title-details model is the only
all-known-platform presentation.
`s` is always present and contains the synopsis or `""`; cards render a three-line
clamped description and use a local fallback sentence when it is empty.

## docs/js/agent.js runAgent() call shape

```js
runAgent({
  config,               // { baseUrl, apiKey, model, webSearch }
  prompts,               // docs/assets/prompts.json
  tools,                 // createTools(...) result
  context: { youmd, history, mood, catalogManifest },
  query,                 // this turn's new user message (string)
  conversation,          // prior turns only, [{ role: "user"|"assistant", content }],
                         // i.e. memory's conversation.messages BEFORE this turn is
                         // appended — included as real chat messages ahead of the
                         // planner prompt so multi-turn context reaches the model
  onEvent, signal, fetchImpl, budget // unchanged
})
// -> { ok: boolean, reply: string, queue: RankedQueue | null, memoryCandidates, usage, billing, timing }
```

`runAgent` uses `streamChatCompletion` for agent requests. It first runs a bounded
tool loop with the catalog-manifest system message before prior turns, then appends
`prompts.rerank` and streams the final no-tools presentation response. Planning emits
strict internal JSON containing optional ranked queue items and optional learned-memory
candidates. Final presentation emits direct safe Markdown, not JSON. `ok` is `true`
only for a successfully parsed final response. Authentication, configuration,
catalog-runtime, network, abort, budget, and parse failures return `ok: false`;
callers must not persist those failures as assistant replies.

## Agent event shapes

```js
{ type: "status", turnId, phase, text, step }
{ type: "tool_call", turnId, id, name, args, step }
{ type: "tool_result", turnId, id, name, count, ok, durationMs, step }
{ type: "delta", turnId, text }
{ type: "done", turnId, reply, queue, memoryCandidates, usage, billing, timing }
{ type: "error", turnId, code, message, retryable, partialReply, timing }
```

Visible phases progress in order through `PLANNING`, `SEARCHING CATALOG`,
`ANALYZING MATCHES`, and `WRITING`, then streamed answer text. `"done"` carries the
complete safe-Markdown `reply`, a `null`/ranked/empty queue update, validated memory
candidates, timing, usage, and billing. The agent validates queue IDs through
`tools.resolve` and validates memory candidates against the latest query. `"delta"`
contains presentation text only; user text remains literal.

Timing is `{ totalMs: number, firstTokenMs: number | null }`. Usage aggregates prompt,
completion, total token counts, and request count. Billing is:

```js
{
  basis: "provider_reported" | "unavailable",
  amountUsd: number | null,
  complete: boolean,
  requestCount: number,
  pricedRequestCount: number
}
```

`amountUsd` is the aggregate of `usage.cost` only if every successful request reports a
valid nonnegative provider cost. The UI says `$0.0042 reported` only for complete
provider-reported billing; otherwise it says `Cost unavailable`. It never estimates
cost from text or token counts.

## Rerank prompt response schema (docs/assets/prompts.json, version 4)

`prompts.json` contains exactly `version`, `system`, `planner`, `rerank`,
`history_plan`, and `no_results`; it has no `output` key. The internal planning
response may contain optional ranked queue items and optional learned-memory candidates.
The final no-tools response after `prompts.rerank` is direct safe Markdown, not JSON.

The final reply may use only paragraphs, unordered/ordered lists,
`**strong**`, `*emphasis*`, and inline backticks. It must not contain raw HTML,
headings, tables, images, arbitrary links, or fenced code blocks. The UI parses this
subset into DOM nodes and text nodes only; it never uses `innerHTML`. User messages
remain literal text. Queue IDs must come from observed `run_catalog_js` output.
`docs/js/agent.js` re-validates them through `tools.resolve`, so IDs that fail
observation, subscription, or availability gating are silently dropped from the
returned queue.

## Tool names

Exactly one: `run_catalog_js`. The model has no `search_titles`, `filter_titles`,
`get_titles`, or `sample_titles` functions. The trusted runtime applies the visitor's
subscription gate to every execution and resolve operation, so model code cannot widen
its catalog scope.

## Frozen DOM IDs

This list changed substantially for the sidebar/chat/recommendation-display shell
overhaul (onboarding screen + sidebar + chat + queue, replacing the single-form
layout), and again for the three-panel layout (collapsible sidebar, chat column with a
pinned composer, vertical picks rail), the move of local-data controls into Settings,
and the progressive playlists dialog. The current visible wordmark is a temporary
placeholder; it is not a final product name. The India provider scope described above
is unrelated to branding.

Always present:
app, error-banner, attribution

Onboarding (shown once, gated by `profile.onboardingComplete`):
onboarding-screen, onboarding-title, onboarding-form, onboarding-progress,
onboarding-provider-list, onboarding-llm-api-key, onboarding-history-file,
onboarding-history-summary, onboarding-history-status, onboarding-history-remove,
onboarding-back, onboarding-next

The form contains exactly three panels, each carrying `data-onboarding-step` with one
of `subscriptions`, `openrouter-key`, or `watch-history`. The key panel asks only for
a nonempty OpenRouter key; base URL and model come from `DEFAULT_LLM`. You.md is not
part of onboarding and remains editable in Profile & context. History is optional,
but after an import failure the user must explicitly continue without history. The
view stores the key with `DEFAULT_LLM.baseUrl` and `DEFAULT_LLM.model` before history
import or finalization; it makes no model request unless a history file is supplied.

Shell (three vertical panels: sidebar, chat column, picks rail):
shell, sidebar-toggle, sidebar, sidebar-collapse, backdrop, new-chat-btn,
conversation-list, conversation-list-items, subscriptions-summary, playlists-btn, context-btn, settings-btn,
catalog-status, workspace

`#catalog-status` is the quiet footer line under the picks rail, not a sidebar block.
`#conversation-list` contains the active conversation and up to 20 archived
conversations as keyboard-accessible controls in newest-first order.

Chat column:
chat-region, chat-transcript, chat-note, query-form, query-input, send-btn, stop-btn

`#query-form` is pinned to the bottom of the chat column inside `.composer-dock`;
message content is capped at `--chat-measure` (about 70ch) and centered.
Each active assistant turn renders an attached placeholder/activity row directly under
its triggering user message. The row exposes phase changes through a polite status
announcement, exposes Stop while active, displays elapsed time only after one second,
and says `TAKING LONGER THAN USUAL` after 20 seconds without meaningful progress. It
collapses successful activity to a compact catalog/match/time summary. It must not
announce every elapsed-second tick.

The attached activity exposes streamed text as literal text while a reply is in
progress; it renders the completed reply through the safe Markdown converter only
after success. Stop and failure messages remain inline with the attached activity.
The final metrics footer contains total latency, total tokens, and either
`$0.0042 reported` for complete provider-reported billing or `Cost unavailable`.

Picks rail:
queue-region, queue-status, queue-viewport, queue-track, queue-empty,
queue-source, queue-top-pick, queue-alternatives, queue-more

The rail scrolls vertically. `#queue-source` renders the bounded source query for the
latest queue update. `#queue-top-pick` contains rank one, `#queue-alternatives`
contains ranks two and three, and `#queue-more` is a collapsed control/container for
ranks four through 20. Recommendation cards retain poster, title, metadata, synopsis,
provider links, and a `+` save button; the title is a real details trigger. Save and
provider actions are independent interactive descendants and never open details.

Title details:
title-details-dialog, title-details-close, title-details-title, title-details-content

`#title-details-dialog` is one top-level native `<dialog>`. It renders the shared
details model with text nodes, captures and restores the trigger's focus, closes on
Escape, and refreshes in place after sidecar or subscription changes without moving
focus. A missing ID renders a tombstone. Playlist title buttons and recommendation
titles open this same dialog.

Dialogs:
settings-dialog, settings-provider-list, llm-base-url, llm-api-key, llm-model, llm-web-search,
export-backup-btn, clear-data-btn,
settings-feedback, settings-save, settings-close, context-dialog, youmd-input,
history-file, history-summary, history-remove, context-feedback, context-save,
memory-enabled, learned-facts, learned-clear,
context-close, disclosure-dialog, catalog-detail, trace, export-md, export-json,
export-csv, export-youmd, disclosure-feedback, disclosure-close,
playlists-dialog, playlists-dialog-title, playlist-back, playlists-close,
playlist-picker, playlist-picker-title, playlist-picker-list,
playlist-library, playlist-library-list, playlist-library-empty, playlist-new,
playlist-detail, playlist-detail-count, playlist-items, playlist-more,
playlist-actions, playlist-rename, playlist-delete, playlist-export,
playlist-export-formats, playlist-export-md, playlist-export-json, playlist-export-csv,
playlist-rename-form, playlist-rename-name, playlist-rename-save, playlist-rename-cancel,
playlist-create-view, playlist-create-name, playlist-create, playlist-feedback

The two local-data controls (`export-backup-btn`, `clear-data-btn`) live in
`#settings-dialog` under a `Local data` fieldset and are wired by
`docs/js/views/dialogs.js`, not by the sidebar view.

The playlists dialog has exactly four mutually exclusive views, and shows one at a
time: `#playlist-picker` (compact save-to-playlist checklist opened from a card's `+`
button), `#playlist-library` (every playlist as a row with its saved count, Watch later
first, plus one `#playlist-new` action), `#playlist-detail` (one playlist's saved items,
with rename/delete/export hidden behind `#playlist-more` and export formats hidden
behind `#playlist-export`), and `#playlist-create-view` (name field and Create only).
`#playlist-back` returns to the library from detail or create. Watch later never exposes
rename or delete.

Removed from the markup: `results`, `onboarding-llm-base-url`,
`onboarding-llm-model`, `onboarding-youmd-input`, `onboarding-continue`,
`mood-select`, `language-select`, `genre-select`, `provider-select`,
`disclosure-btn`, `queue-prev`, `queue-next`, `playlist-manager`, and
`playlist-select`. The disclosure/developer dialog remains in the DOM but has no
visible opener. It opens only with `Ctrl+Alt+Shift+D`
(`Control+Option+Shift+D` on macOS); this shortcut is discoverability only, not an
authentication or security boundary.

The developer dialog retains trace, current recommendation exports, and catalog
provenance. Playlist exports remain user-facing through the playlist manager.

Every recommendation card includes a visible `+` save button with
`aria-haspopup="dialog"` that opens the playlist picker.

## Localhost-only test mode

`?testMode=1` bypasses onboarding only when `location.hostname` is exactly
`localhost` or `127.0.0.1`. It persists an onboarding-complete test profile on that
local origin, with providers read from comma-separated `testProviders`, normalized
against `PROVIDER_SLUGS`, and defaulting to `netflix`. It never reads, creates, or
persists an API key. Production hosts, localhost-like subdomains, malformed URLs,
and requests without the exact flag ignore test mode.
