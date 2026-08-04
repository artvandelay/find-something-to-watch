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

## Storage keys

```js
const KEYS = {
  llm:     "ottbyok.llm",       // { baseUrl, apiKey, model }
  youmd:   "ottbyok.youmd",     // string
  history: "ottbyok.history"    // { importedAt, series, movies, seen }
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
{ k, yearFrom, yearTo, runtimeMin, runtimeMax, minRating, provider, lang, genre, excludeKeys }
// lang: ISO-639-1 string, matched against rec.l exactly
// genre: genre name string, matched with rec.g.includes(genre)
// excludeKeys: string[] of normalizeTitle() outputs to drop
```

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

app, catalog-status, catalog-detail, query-form, query-input, send-btn, stop-btn,
mood-select, language-select, genre-select, provider-select, results, trace,
settings-btn, settings-dialog, llm-base-url, llm-api-key, llm-model, settings-save,
settings-close, context-btn, context-dialog, youmd-input, history-file,
history-summary, context-save, context-close, export-md, export-json, export-csv,
export-youmd, error-banner, attribution

New in schema 2: catalog-detail, language-select, genre-select, provider-select.
