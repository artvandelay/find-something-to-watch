# India OTT Catalog Aggregators & Commercial APIs — Coverage Research

**Research track:** Aggregators/commercial-API-only (no direct-platform scraping)
**Date:** 2026-08-04
**Scope:** Can a commercial aggregator/API (or stack of them) deliver a (near) complete India OTT catalog for a search product, instead of scraping Netflix/Hotstar/Prime/Zee5/SonyLIV directly?
**Raw evidence:** `research/raw/aggregators/` (sanitized request/response samples, no API keys included)

> Note: this repo already had a working RapidAPI key (`RAPIDAPI` in `.env`) provisioned for uNoGSNG. During this research I discovered — and live-verified — that the **same key also grants access to the Streaming Availability API (movieofthenight)** on RapidAPI. That single finding materially changes the "buy vs. build" math for this repo (see Verdict).

---

## 1. TL;DR Verdict

**Can aggregators replace P0 scrapers for the 80% use-case (Netflix, JioHotstar, Prime Video, Zee5, SonyLIV)? Yes — for those 5 platforms specifically, today, with what's already in this repo.**

- The **Streaming Availability API** already works with the repo's existing RapidAPI key and, live-tested, covers exactly the "big 5" India platforms (Netflix, Prime Video, JioHotstar, Zee5, SonyLIV) plus Apple TV, Mubi, Curiosity Stream, and Crunchyroll. This is a legitimate, ToS-clean, commercially-licensable API with real pricing tiers — not a scraper.
- **uNoGSNG** (already integrated in this repo) remains the best tool specifically for Netflix-India (country-availability, expiring titles, genre browse) — but it is Netflix-only.
- **For the long tail** (MX Player, Sun NXT, aha, Hoichoi, ShemarooMe, Discovery+, Lionsgate Play, EPIC ON, Hungama Play, Chaupal, Tata Play, ManoramaMax, VI movies and tv, etc.) — **no self-serve, ToS-clean aggregator fully covers this today**. JustWatch is the only aggregator that tracks this breadth (114 India providers, live-verified), but its free/public API is unofficial and its ToS explicitly prohibits commercial use; its official commercial channel is enterprise-only with no public pricing. Watchmode claims broader India source coverage on paper (Zee5/SonyLIV/MX Player/Sun Nxt/JioHotstar/Hungama Play all named in its docs) at a real self-serve commercial price ($349+/mo), but this repo has no Watchmode key so it is **unverified live** — this is the single highest-value next step if budget allows.
- So: **80% use case → yes, solved today, cheaply, legally.** **Last ~15-20% (regional/vernacular long tail) → aggregators alone don't get you there without either accepting JustWatch's ToS risk, paying for Watchmode's mid-tier commercial plan, or doing a small, targeted scrape of ~5-8 regional platforms** (likely the job of the P0/P1 scraper tracks running in parallel to this one).

**Recommended stack for this repo, ranked by bang-for-buck:**

| Priority | Tool | Covers | Cost | Why |
|---|---|---|---|---|
| 1 | uNoGSNG (already built) | Netflix (IN + global) | Already paid for | Deepest Netflix-specific data (country-by-country, expiring titles), already integrated |
| 2 | **Streaming Availability API** (movieofthenight) | Prime Video, JioHotstar, Zee5, SonyLIV, Apple TV, Mubi, Curiosity, Crunchyroll | $0 (500 req/mo) → $39-249/mo direct, or already-working RapidAPI key | Live-verified today, plugs the exact P0 gap, deep-links, clean commercial ToS |
| 3 | TMDB `/watch/providers` | Cross-check / metadata enrichment (posters, cast, ratings) for all of the above | Free (non-commercial), negotiated license for commercial | 2-minute signup, generous rate limit, same underlying JustWatch data for the big platforms |
| 4 | Watchmode (evaluate) | Potential long-tail: MX Player, Sun Nxt, Hungama Play, Discovery+ | Free tier to test (2,500 req/mo, 3 countries) → $349+/mo commercial | Only self-serve commercial API that *claims* long-tail India coverage — needs live verification before committing budget |
| 5 | Targeted scraping (P0/P1 tracks) | Whatever regional platforms Watchmode doesn't actually cover once verified | Engineering time | Fallback for the last mile; likely already underway in sibling research tracks |
| Avoid for production | JustWatch unofficial GraphQL | Broadest breadth (114 IN providers) but ToS explicitly bars commercial use | Free but non-compliant | Great for *research/validation* (used heavily in this report), risky to ship |

---

## 2. Coverage Matrix

Legend: ✅ = confirmed live or in official docs · ⚠️ = claimed in docs, not live-verified · ❌ = confirmed absent · — = not applicable

| Aggregator | India support | Netflix | Prime Video | JioHotstar | Zee5 | SonyLIV | Long-tail regional (MX Player/Sun Nxt/aha/Hoichoi/etc.) | Completeness estimate (India) | Pricing (self-serve) | ToS / legal risk |
|---|---|---|---|---|---|---|---|---|---|---|
| **JustWatch** (unofficial GraphQL) | ✅ live-verified | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ **114 providers** live-verified | **Highest** — ~66,630 titles indexed for India per justwatch.com/in; broadest provider breadth of anything tested | Free (unofficial) | 🔴 **High** — explicitly "prohibited for commercial purposes" per API terms; introspection disabled, queries must be reverse-engineered from web traffic, can break anytime |
| **JustWatch** (official "Content Partner" API/data dump) | ✅ (same underlying data) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (same breadth) | Same as above, contractually guaranteed + daily updates | **No public pricing** — enterprise-only, "currently only works with bigger partners", contact data-partner@justwatch.com | 🟡 Medium — legally clean but requires branded backlink to JustWatch on every "where to watch" display, and a signed contract |
| **TMDB `/watch/providers`** | ✅ live-attempted (blocked only by missing key, not by lack of IN support) | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ partial — same JustWatch-sourced data but TMDB does not expose price/monetization detail, and per-title provider lists are typically curated/shorter than JustWatch's raw list | Medium-High (inherits JustWatch data) but no deep links, no price info | **Free** (non-commercial, attribution required) / commercial license via sales@themoviedb.org | 🟢 Low for non-commercial; must attribute JustWatch too; commercial use needs a separate negotiated license |
| **Watchmode** | ✅ per docs (India explicitly listed) | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ **claimed** (MX Player, Sun Nxt, Hungama Play, JioHotstar named in source list) — **not live-verified** (no key in this repo) | Medium-High on paper, unverified in practice | Free: 2,500 req/mo, 3 countries, non-commercial. Paid (direct): $349/mo (40k req, commercial, 50+ countries) / $599/mo (100k req). RapidAPI listing: Basic $0 (1,000 req, but only US/CA/AU/UK/BR — **India NOT in the free RapidAPI tier's country list**), Pro $249/mo, Ultra $499/mo | 🟢 Low — clean commercial terms, attribution waived on paid plans |
| **Streaming Availability API** (movieofthenight) | ✅ **live-verified** | ✅ | ✅ | ✅ (as `hotstar`/JioHotstar) | ✅ | ✅ | ❌ **confirmed gap** — only 9 IN services total: Netflix, Prime, Apple TV, JioHotstar, Zee5, SonyLiv, Mubi, Curiosity Stream, Crunchyroll. No MX Player, Sun Nxt, aha, Hoichoi, Discovery+, Lionsgate Play, etc. | Medium — exactly the "big 5" + a few niche global services, confirmed empty for regional-only titles (see live probe) | Free: 500 req/mo. Direct: Pro $39/mo (25k), Ultra $59/mo (100k), Mega $199/mo (1M). Via RapidAPI (same functionality, ~20-25% markup): Pro $49, Ultra $79, Mega $249 | 🟢 Low — standard commercial API ToS, deep links included, no backlink requirement found |
| **uNoGSNG** (already integrated) | ✅ (already have 6,954-title IN dump from Feb 2026) | ✅ **Netflix only** | ❌ | ❌ | ❌ | ❌ | ❌ | High for Netflix specifically, N/A for everything else | BASIC $0 / PRO $10 / ULTRA $25 / MEGA $50 per month (RapidAPI) | 🟢 Low — designed as a public API product, explicitly positioned by its own operators as "so you don't need to scrape our site" |
| **Reelgood (Partner API)** | ✅ per vendor site ("historical availability for India since Nov 2025") | ✅ | ✅ | ✅ (implied) | ⚠️ likely | ⚠️ likely | ⚠️ **likely** (positioned as comprehensive, same category as JustWatch) but **no self-serve access to verify** | Likely High (comparable positioning to JustWatch) but unverifiable without a sales contract | **No public pricing** — must contact sales@reelgood.com / fill a "Let's Chat" form; business license required | 🟡 Medium — legally clean once contracted, but zero self-serve trial, slow sales cycle |
| **Guidebox** | — (brand effectively dead) | — | — | — | — | — | — | N/A | N/A | Guidebox was acquired by Reelgood in 2018 and folded in; `guidebox.com` today resolves to an unrelated Q&A/forum site (likely an expired/squatted domain) — **treat as defunct, use Reelgood instead** |
| **FlixPatrol** | ✅ (Top-10 charts only, not full catalog) | ✅ | ✅ | ✅ | — | — | — | N/A for catalog completeness — this is a **popularity/ranking product, not a "what's in the catalog" API** | Start $9.99/mo (API only, 1,000 calls), Premium $49/mo or $490/yr (dashboard+API), Enterprise custom | 🟢 Low, but wrong tool for the job (rankings ≠ catalog) |
| **Trakt** | ✅ per docs — "Watch Now" covers 46 countries incl. India | ✅ | ✅ | ⚠️ likely | ⚠️ likely | ⚠️ likely | ⚠️ unverified | Unverified for India depth — historically Trakt's "Watch Now" has been JustWatch-lineage data resold through Trakt's own catalog | Free (developer OAuth app, client ID/secret) | 🟡 Medium — public (non-authenticated) apps face rate limits/feature restrictions "to prevent abuse from automated scrapers" |
| **TV Time** | ❌ | — | — | — | — | — | — | N/A | N/A | **Shut down permanently on July 15, 2026** (Whip Media pivoted to enterprise AI product "Helix"). Dead end — do not build on this. |
| **OMDb** | ❌ (no streaming availability at all — metadata only: plot, cast, IMDb rating, poster) | — | — | — | — | — | — | N/A | 1,000 free calls/day; ~$1/mo Patreon removes the limit | 🟢 Low, but **irrelevant to "where can I watch" queries** — useful only as a metadata enrichment side-car |
| **Kaggle / open datasets** | ❌ stale | ⚠️ 2021-2025 snapshots only | ❌ | ❌ | ❌ | ❌ | ❌ | Low freshness — the popular datasets (shivamb/netflix-shows, satpreetmakhija) are frozen at mid-2021; a few 2025/2026 community re-scrapes exist but are one-off, unmaintained, and themselves derived from JustWatch/Flixable | Free | N/A — not viable as a live product data source; useful only for cold-start seed data or ML training |
| **India-specific official APIs** (JioHotstar/JioCinema/SonyLIV/Zee5/MX Player) | ❌ **none exist** | — | — | — | — | — | — | N/A | N/A | No official public developer API from any major Indian streamer. Community reverse-engineering exists (yt-dlp's `hotstar.py` extractor, Kodi addons using signed `hotstarauth` HMAC headers) but these are unofficial, fragile, and violate platform ToS if scraped at scale |
| **"Vified"** | Could not identify a specific matching product/API under this name in the India OTT data space during this research — likely conflated with another tool, or too obscure/unindexed to verify. Grouped conceptually with the "fan-tracker" category below. |
| **Whats-on-Netflix-style trackers / Stremio addons** | ⚠️ Example found: [`FissionMailed7/India-ott-catalog-addon`](https://github.com/FissionMailed7/India-ott-catalog-addon) — open-source Stremio addon that **scrapes** Netflix, Prime Video, Hotstar, Zee5, SonyLIV, Sun NXT, and aha for India. Proves the "6-platform regional scrape" pattern is a known, working approach — but it is scraping, not an API, and is exactly the kind of P0-style approach this research track was scoped to avoid. |

---

## 3. Deep-dive notes by aggregator

### 3.1 JustWatch (unofficial GraphQL + official Partner API)

- **Unofficial public endpoint:** `https://apis.justwatch.com/graphql`. No API key required. Introspection is disabled, and the webapp's operation strings change between builds, so queries must be reconstructed from captured network traffic. Community libraries exist and are actively maintained:
  - Python: [`simple-justwatch-python-api`](https://github.com/Electronic-Mango/simple-justwatch-python-api) (used for live probing in this research)
  - JS/TS: [`simple-justwatch-js`](https://github.com/anthonyfranc/simple-justwatch-js)
- **Live probe result (this research):** Queried `providers('IN')` and got **114 distinct India providers** — by far the broadest breadth of any aggregator tested, including long-tail platforms no other API surfaces: MX Player, Sun Nxt, aha, Hoichoi, ShemarooMe, Discovery+, EPIC ON, Hungama Play, Lionsgate Play, ManoramaMax, Chaupal, VI movies and tv, Tata Play, DocuBay, FanCode, and dozens of Amazon Channel add-ons. Full list: `research/raw/aggregators/justwatch_providers_in.json`.
- **Live probe result — title-to-provider accuracy:** Searched a spread of India-specific titles spanning different platforms and object types; JustWatch correctly resolved every one to its actual current India provider:

  | Title | Expected platform | JustWatch result |
  |---|---|---|
  | Kaalidhar Laapata (2025 movie) | Zee5 | ✅ Zee5 |
  | Tharangam (2017, Malayalam movie) | Sun Nxt (regional-only) | ✅ Sun Nxt, VI movies and tv |
  | Panchayat (2020 show) | Prime Video exclusive | ✅ Amazon Prime Video (+ Ads tier) |
  | Sacred Games (2018 show) | Netflix Original | ✅ Netflix |
  | Kumkum Bhagya (2014 show) | Zee5/TV serial | ✅ Zee5, VI movies and tv |
  | Bigg Boss (2006 show) | JioHotstar | ✅ JioHotstar |

  Full samples: `research/raw/aggregators/justwatch_title_search_samples_in.json`.
- **Scale reference:** the public justwatch.com/in catalog page reports **66,630 titles** indexed for India (all providers combined) at time of research.
- **Legal status — this is the crux of the risk:** the [`dawoudt/JustWatchAPI`](https://github.com/dawoudt/JustWatchAPI) project (widely cited prior art) states plainly: *"it is prohibited to use the API for commercial purposes, meaning all purposes intended for, or directed towards, commercial advantage or monetization... The API may be used for non-commercial purposes such as private projects."* This mirrors JustWatch's own stated policy.
- **Official commercial route:** [JustWatch Content Partner docs](https://apis.justwatch.com/docs/content_partner/) describe a legitimate API + daily NDJSON data dump (via S3, `jw-data-partner-out` bucket) + widget, covering "up to 250,000 movies and 60,000 TV shows, over 3,900 local provider catalogues, 500+ unique providers, 100+ countries, daily updates." **No public pricing exists** — access requires a signed contract via `data-partner@justwatch.com`, and JustWatch states it currently "can only work with bigger partners." Every display of the data (even via the official partner integration) requires a **branded backlink to JustWatch**.
- **Verdict for this repo:** excellent for *research, validation, and cold-start seeding* (which is exactly how it was used in this report) — but not something to build production search-serving infra on top of without either accepting real legal risk or securing an enterprise contract.

### 3.2 Watchmode

- Official REST API at `api.watchmode.com`. India is explicitly listed as a supported region (54 total countries).
- Docs list `Zee5`, `Sony LIV`, `Sun Nxt`, `Amazon MX Player`, `Hungama Play`, and `JioHotstar` as named sources — on paper this is the **broadest self-serve-with-real-pricing India coverage** among the APIs tested.
- **Not live-verified in this research** — no Watchmode key exists in this repo's `.env`, and this task's scope was to probe with existing keys only rather than sign up for new services. A parallel research track's blind probe (no key) correctly got `401 Please enter a valid API key`.
- Free tier: 2,500 requests/month, choice of 3 countries, non-commercial use only, attribution required.
- Paid (direct, `api.watchmode.com`): $349/mo for 40,000 requests (commercial use, 50+ country sources, deep links, episode-level links) or $599/mo for 100,000 requests.
- Paid (RapidAPI listing — cheaper entry, narrower country support): Basic **$0**/1,000 requests but **country list is only USA/Canada/Australia/England/Brazil — India is NOT included on the free RapidAPI tier**; Pro $249/mo for 35,000 requests unlocks all 50 countries; Ultra $499/mo for 100,000 requests.
- **Recommended next step:** sign up for the free direct-site tier (not RapidAPI) specifically to confirm India + Sun Nxt/MX Player/Hungama Play coverage live before committing to a paid plan — this is the single most valuable unresolved question from this research.

### 3.3 Streaming Availability API (movieofthenight)

- **This is the standout finding of this research.** The repo's existing `RAPIDAPI` key — provisioned originally for uNoGSNG — was live-tested against `streaming-availability.p.rapidapi.com` and **worked immediately with no additional signup**, returning HTTP 200.
- `GET /countries/in` → 9 India services: `netflix`, `prime`, `apple`, `hotstar` (JioHotstar), `zee5`, `sonyliv`, `mubi`, `curiosity`, `crunchyroll`. Prime Video alone carries 29 India add-on channels (regional/niche SVOD bundles sold through Prime Video Channels). Full response: `research/raw/aggregators/streaming_availability_countries_in.json`.
- `GET /shows/search/filters?country=in&catalogs=zee5` → correctly paginated Zee5's India catalog (cursor-based, 20 results/page, `hasMore: true`). Sample: `research/raw/aggregators/streaming_availability_zee5_search_sample.json`.
- **Confirmed coverage gap:** `GET /shows/search/title?title=Tharangam&country=in` returned the title's metadata (via its TMDB/IMDb linkage) but an **empty `streamingOptions.in`** object — because Sun Nxt (the platform that actually carries this title) isn't one of the 9 supported India services. This is direct, reproducible evidence that this API's India coverage stops at the mainstream/global platforms and does not reach regional-only content. Evidence: `research/raw/aggregators/streaming_availability_tharangam_gap_evidence.json`.
- `GET /shows/search/title?title=Kumkum Bhagya&country=in` correctly returned full metadata + would show Zee5 availability (this title *is* on Zee5, one of the 9 supported services). Evidence: `research/raw/aggregators/streaming_availability_kumkum_bhagya_sample.json`.
- Pricing is real and self-serve. Cheaper direct via `movieofthenight.com` (Pro $39/mo for 25k requests, Ultra $59/mo for 100k, Mega $199/mo for 1M) than via RapidAPI's ~20-25% marked-up equivalent tiers (Pro $49, Ultra $79, Mega $249) — **same underlying API**, so prefer signing up directly unless you specifically want to keep billing consolidated under the existing RapidAPI account.
- No ToS red flags found: standard commercial API terms, deep links included in the data model, no mandatory backlink/branding requirement (unlike JustWatch).

### 3.4 TMDB `/watch/providers`

- Powered by TMDB's partnership with JustWatch — same underlying source-of-truth data, but exposed through a friendlier, better-documented, more generously-rate-limited API (`40 requests / 10 seconds`, `200,000/day` on the free tier).
- Free API key: 2-minute signup at themoviedb.org → Settings → API. Non-commercial use is free with mandatory attribution to **both** TMDB and JustWatch (the docs explicitly warn: *"If we find any usage not complying with these terms we will revoke access to the API"*). Commercial use requires a separate negotiated license via `sales@themoviedb.org`.
- Not live-probed in this research (no TMDB key currently in this repo's `.env`; a parallel research track's blind attempt without a key correctly got a 401 `Invalid API key`).
- Trade-off vs. calling JustWatch directly: TMDB gives you a **cleaner ToS path to the same underlying data** for a modest richness trade-off (no price/currency, coarser monetization-type buckets, and per-title provider lists are typically shorter/curated compared to JustWatch's raw provider list). For a product that needs a legally defensible route to JustWatch-grade breadth, negotiating a TMDB commercial license may be **more accessible than JustWatch's own enterprise-only Data Partner program**, since TMDB is a more developer-friendly, self-serve-oriented company overall.

### 3.5 uNoGS / uNoGSNG (already integrated in this repo)

- Confirmed via research and via this repo's own working setup: **uNoGSNG is Netflix-only.** It does not, and never did, cover Hotstar, Prime Video, Zee5, SonyLIV, or any other platform.
- This repo already has a full India Netflix catalog dump: `data/unogs_catalog/IN_india.jsonl.gz` — **6,954 titles**, fetched 2026-02-21 (~5.4 months stale as of this research date, 2026-08-04). Recommend a re-run of `scripts/unogs_dump_catalog.py` to refresh before relying on it for anything user-facing.
- Naming gotcha discovered during this research: RapidAPI hosts **two similarly-named, unrelated products** — "uNoGS" (older, and a blind probe against it in this research got `403 You are not subscribed to this API`) and "unogsNG" (the one this repo actually uses and is subscribed to, confirmed working). Worth documenting clearly in this repo so future maintainers don't confuse the two.
- Pricing (unogsNG, RapidAPI): BASIC $0/mo, PRO $10/mo, ULTRA $25/mo, MEGA $50/mo.

### 3.6 Reelgood / Guidebox

- Reelgood explicitly advertises India coverage: *"North America, Western Europe, LatAm, India, and expanding... India: since Nov 2025"* (historical availability), positioned as directly comparable in scope/ambition to JustWatch (real-time availability, S3 delivery twice daily, Athena-queryable tables).
- **No self-serve signup or trial exists** — access is entirely sales-gated (`sales@reelgood.com` / a "Let's Chat" contact form), so completeness and pricing could not be verified in this research.
- Guidebox (Reelgood's 2018 acquisition, formerly powering Roku/TVGuide/Metacritic universal search) appears to be **defunct as an independent product** — `guidebox.com` currently resolves to an unrelated Q&A/forum-style site, most likely an expired and re-registered domain. Do not attempt to use Guidebox directly; if this lineage of data is wanted, go through Reelgood.

### 3.7 FlixPatrol

- **Important distinction:** FlixPatrol is a **Top-10/popularity-ranking product**, not a catalog-completeness API. It answers "what's trending on Hotstar in India today" (confirmed live on `flixpatrol.com/top10/hotstar/india/`), not "does Hotstar have title X." Do not confuse this with a catalog aggregator — it solves a different problem (trending/discovery signal, not availability search).
- Pricing: Start $9.99/mo (API-only, 1,000 calls/mo), Premium $49/mo or $490/yr (dashboard + API + full archive since 2020), Enterprise (custom, unlimited).
- Could be a nice **secondary signal** for a search product's ranking/relevance layer (boost trending titles) but not a substitute for a catalog source.

### 3.8 Trakt, TV Time, OMDb, Kaggle datasets — quick verdicts

- **Trakt**: Free developer API, "Watch Now" feature covers India among 46 countries, historically built on JustWatch-lineage licensing. Free OAuth apps face anti-scraping rate limits and some restricted endpoints. Not live-verified in this research (no client ID configured). Reasonable free supplementary signal, not a primary source.
- **TV Time**: **Permanently shut down July 15, 2026** — Whip Media (parent company) pivoted the business to an enterprise AI product ("Helix") and deleted all user data. This is a dead end; remove from consideration entirely.
- **OMDb**: Pure metadata (IMDb ratings, cast, plot, poster) — **zero streaming availability data**. Fine as a cheap enrichment side-car (1,000 free calls/day) alongside a real availability source, irrelevant on its own for "where can I watch" queries.
- **Guidebox**: see §3.6 — effectively dead as a standalone brand.
- **Kaggle / open datasets**: All well-known public datasets (`shivamb/netflix-shows`, `satpreetmakhija/netflix-movies-and-tv-shows-2021`) are frozen snapshots from **2021**. A handful of 2025/2026 community re-scrapes exist (e.g., a June 2026 "7,300+ Netflix India titles" notebook scraped from JustWatch) but are one-off, unmaintained, third-hand derivative data. **Not viable for a live product** — only useful as cold-start seed data or for offline ML experimentation.

### 3.9 India-specific official APIs / broadcast listings

- Confirmed via research: **no official public developer API exists** for JioHotstar/JioCinema, SonyLIV, Zee5, or MX Player. All are closed platforms with private internal APIs used only by their own first-party apps.
- Community reverse-engineering exists and is well-documented (e.g., the [`yt-dlp` Hotstar extractor](https://github.com/ytdl-org/youtube-dl/blob/master/youtube_dl/extractor/hotstar.py) using a signed `hotstarauth` HMAC scheme, and Kodi addons like [`botallen/plugin.video.botallen.hotstar`](https://github.com/botallen/plugin.video.botallen.hotstar)) — but these are unofficial, explicitly designed for personal media-center playback (not catalog aggregation at scale), fragile against platform changes, and a ToS violation if used to build a commercial catalog product.
- No government/broadcast-listing equivalent (e.g., an EPG registry) was found that covers OTT VOD catalogs in India — TRAI's regulatory framework covers linear TV/DTH, not OTT VOD availability.
- A relevant **existing open-source prior-art scraper** worth noting: [`FissionMailed7/India-ott-catalog-addon`](https://github.com/FissionMailed7/India-ott-catalog-addon) — a Stremio addon that scrapes Netflix, Prime Video, Hotstar, Zee5, SonyLIV, Sun NXT, and aha for India, deployed as a Vercel serverless function with a 6-hour cache. This validates that the "6-8 platform direct scrape" pattern is a known, working approach for exactly the long-tail gap that no legal aggregator currently fills — likely relevant to the sibling P0/P1 scraper research tracks in this repo.
- **"Vified"**: could not identify a specific matching product under this name during this research. Possibly a misremembered/obscure reference; grouped conceptually with the fan-tracker/scraper category above.

---

## 4. Signup + curl quick-start examples

### 4.1 Streaming Availability API — already works with this repo's key

No signup needed — the existing `RAPIDAPI` key in this repo's `.env` already has access:

```bash
RAPIDAPI_KEY=$(grep RAPIDAPI .env | cut -d'=' -f2 | tr -d '"')

# List India's supported services
curl -s -G "https://streaming-availability.p.rapidapi.com/countries/in" \
  -H "X-RapidAPI-Key: $RAPIDAPI_KEY" \
  -H "X-RapidAPI-Host: streaming-availability.p.rapidapi.com"

# Search Zee5's India catalog (cursor-paginated)
curl -s -G "https://streaming-availability.p.rapidapi.com/shows/search/filters" \
  --data-urlencode "country=in" \
  --data-urlencode "catalogs=zee5" \
  --data-urlencode "order_by=popularity_1year" \
  -H "X-RapidAPI-Key: $RAPIDAPI_KEY" \
  -H "X-RapidAPI-Host: streaming-availability.p.rapidapi.com"

# Search by title, get India streaming options
curl -s -G "https://streaming-availability.p.rapidapi.com/shows/search/title" \
  --data-urlencode "title=Panchayat" \
  --data-urlencode "country=in" \
  -H "X-RapidAPI-Key: $RAPIDAPI_KEY" \
  -H "X-RapidAPI-Host: streaming-availability.p.rapidapi.com"
```

For cheaper direct billing (bypassing RapidAPI's markup), sign up instead at <https://www.movieofthenight.com/about/api/pricing> and call `https://api.movieofthenight.com/v4/...` with an `X-API-KEY` header.

### 4.2 JustWatch — unofficial, research/prototyping only

```bash
# Install the unofficial Python client (per this repo's convention: uv + ~/pyenv)
mkdir -p ~/pyenv && cd ~/pyenv
uv venv jwprobe --python 3.11 && source jwprobe/bin/activate
uv pip install simple-justwatch-python-api
```

```python
from simplejustwatchapi.justwatch import search, providers

# All India providers JustWatch tracks (114 as of this research)
provs = providers('IN')

# Search + provider mapping for a title
results = search('Panchayat', country='IN', language='en', count=3, best_only=True)
for r in results:
    print(r.title, r.release_year, [o.package.name for o in r.offers])
```

⚠️ Do not ship this in a commercial product — see §3.1 on ToS. For production, contact `data-partner@justwatch.com` for the official Data Partner program (enterprise-only, no public pricing).

### 4.3 TMDB — free, 2-minute signup

1. Create a free account at <https://www.themoviedb.org/signup>
2. Settings → API → Request an API Key (Developer plan, free forever for non-commercial use)
3. Use the v4 Bearer token (recommended over the v3 query-param key):

```bash
curl --request GET \
  --url 'https://api.themoviedb.org/3/tv/1668/watch/providers' \
  --header 'Authorization: Bearer YOUR_V4_READ_ACCESS_TOKEN'
# Filter the response's "results" object for the "IN" key to get India providers
```

### 4.4 Watchmode — free tier, needs verification (recommended next step)

1. Sign up at <https://api.watchmode.com/requestApiKey> (no credit card required)
2. Free tier: 2,500 requests/month, pick up to 3 countries — **pick India as one of them**

```bash
WATCHMODE_KEY="your_free_key"

# Confirm India regions & sources
curl -s "https://api.watchmode.com/v1/regions/?apiKey=$WATCHMODE_KEY"
curl -s "https://api.watchmode.com/v1/sources/?apiKey=$WATCHMODE_KEY&regions=IN"

# Check a regional-only title (the exact gap Streaming Availability API misses)
curl -s "https://api.watchmode.com/v1/search/?apiKey=$WATCHMODE_KEY&search_field=name&search_value=Tharangam"
curl -s "https://api.watchmode.com/v1/title/{id}/sources/?apiKey=$WATCHMODE_KEY&regions=IN"
```

### 4.5 uNoGSNG — already configured

```bash
python3 "/path/to/unogs_cli.py" search \
  --country India --type movie --query "fantasy" --limit 10
```

---

## 5. Raw probe evidence index

All sanitized (no API keys) request/response samples generated during this research live in `research/raw/aggregators/`:

- `streaming_availability_countries_in.json` — live probe, India's 9 supported services + Prime Video's 29 add-on channels
- `streaming_availability_zee5_search_sample.json` — live probe, Zee5 catalog search/pagination
- `streaming_availability_kumkum_bhagya_sample.json` — live probe, title search hit (Zee5 title correctly resolved)
- `streaming_availability_tharangam_gap_evidence.json` — live probe, **coverage gap proof** (Sun Nxt-exclusive title has metadata but empty India streaming options)
- `justwatch_providers_in.json` — live probe, full 114-provider India list from JustWatch's unofficial GraphQL API
- `justwatch_title_search_samples_in.json` — live probe, 6 India titles across different platforms, all correctly resolved
- Additional files from a parallel/sibling research pass on this same task (`unogs_probe.json`, `watchmode_in_probe.json`, `tmdb_watch_providers_in.json`, `reelgood_trakt_flixpatrol_probe.json`, `justwatch_in_probe.json`, `streaming_availability_search_in.json`) — these show blind (no-key) probe attempts against Watchmode, TMDB, and uNoGS (all correctly rejected with 401/403, consistent with this report's finding that those services require dedicated signups), plus a Cloudflare-blocked Trakt/FlixPatrol scrape attempt.
