# India OTT catalog — aggregated strategy and decision log

Aggregates three parallel research tracks completed 2026-08-04:

- [`india-ott-p0-catalog-scrape-playbook.md`](india-ott-p0-catalog-scrape-playbook.md) — direct-platform scraping feasibility
- [`india-ott-aggregators-coverage.md`](india-ott-aggregators-coverage.md) — commercial aggregator / API coverage
- [`india-ott-p1-free-firecrawl-playbook.md`](india-ott-p1-free-firecrawl-playbook.md) — free/AVOD sources and Firecrawl evaluation

Both research agents finished with status `success`. This document is the merged conclusion plus what
was actually acted on.

---

## 1. The finding that changes everything

**The `RAPIDAPI` key already in `.env` also grants access to the Streaming Availability API
(`streaming-availability.p.rapidapi.com`, the movieofthenight product).** It was provisioned for uNoGSNG,
but the same key returned HTTP 200 against the Streaming Availability endpoints with no extra signup.

That single fact moves the project from a Netflix-only catalog to a genuine multi-provider India catalog
at zero additional cost. India coverage on that API is nine services:

`netflix`, `prime`, `hotstar` (JioHotstar), `zee5`, `sonyliv`, `apple`, `mubi`, `curiosity`, `crunchyroll`

Those are exactly the platforms that matter for the ~80% case. Per the FICCI-EY 2026 figures in the P0
playbook, JioHotstar (~225M subs), Prime Video (~32M paid), Netflix India (~24M paid), ZEE5 (~12-15M) and
SonyLIV (~10-12M) are the top five by a wide margin.

**Acted on:** `scripts/fetch_streaming_availability.py` pages all nine India catalogs by
`popularity_1year` into `data/streaming_availability/`, under a hard request budget. The shipped
`docs/assets/catalog.json` now merges this with the existing uNoGS Netflix dump: 9,354 titles across all
nine services (6,954 Netflix + 300 each for the other eight, using only 136 of a 500-request quota).

Two things were fixed during the merge, both confirmed by inspecting real API responses rather than
assumed:

- **HTML entities in the uNoGS data.** 1,819 synopses and 283 titles contained raw `&#39;` etc. Left
  unfixed, the BM25 tokenizer split `&#39;` into the token `"39"`, polluting 29% of the catalog's search
  index with a junk term. Fixed in `build_catalog.py` with `html.unescape` plus a zero-width/NBSP
  cleanup, applied to both sources.
- **Signed, expiring poster URLs from the Streaming Availability API.** Its CDN image links carry an
  `Expires` query parameter — decoded, they stop working around March 2027 — and average 468 characters
  versus 258 for the uNoGS Netflix images, which are stable unsigned CDN paths. Rather than ship a
  payload that is both larger and a future breakage, poster art for the eight non-Netflix providers was
  dropped (`img: null`); everything else (title, synopsis, year, runtime, rating, watch link) is kept.
  Netflix retains its posters. This can be revisited if a self-hosted/proxied image cache is ever worth
  building.

---

## 2. What each source is actually good for

| Source | Verdict | Cost | Use it for |
|---|---|---|---|
| Streaming Availability API | Primary source. Live-verified with the existing key. | Already paid | The nine mainstream India services, with deep links |
| uNoGSNG | Keep. Netflix-only but deepest Netflix data. | Already paid | Netflix country availability, expiring titles |
| TMDB `/watch/providers` | Best legal path to broader data | Free, non-commercial | Metadata enrichment, posters, cast; JustWatch-sourced availability |
| JustWatch unofficial GraphQL | Research only — do not ship | Free | Validating coverage gaps (114 India providers tracked) |
| Watchmode | Unverified, highest-value unknown | $349/mo commercial | The regional long tail, if it lives up to its docs |
| Reelgood | Sales-gated, unverifiable | Contact sales | Skip for now |
| FlixPatrol | Wrong tool — rankings, not catalog | $9.99+/mo | A trending-boost signal later, not availability |
| Kaggle / open datasets | Frozen at 2021 | Free | Nothing. Not viable. |
| TV Time | Dead — shut down 2026-07-15 | — | Remove from consideration entirely |

### The confirmed gap

The Streaming Availability API does **not** reach regional-only platforms. This was proven, not assumed:
`Tharangam` (2017 Malayalam film, carried by Sun NXT) returns full metadata but an **empty
`streamingOptions.in`**, because Sun NXT is not one of the nine supported services.

Missing from any legally-clean self-serve API today: MX Player, Sun NXT, aha, Hoichoi, ShemarooMe,
Discovery+, Lionsgate Play, EPIC ON, Hungama Play, ManoramaMax, Chaupal, Tata Play, DocuBay, FanCode.

JustWatch tracks all of them (114 India providers, live-verified) but its terms explicitly prohibit
commercial use, and its official partner programme is enterprise-only with no public pricing.

---

## 3. Two cautions worth carrying forward

**Firecrawl is the wrong tool for bulk catalog work.** Track 3 benchmarked it and hit `402 Insufficient
credits`. Beyond cost, headless rendering of these SPA catalog grids takes 3,000-12,000 ms per page
against under 250 ms for a direct REST call. Reserve it for un-API'd static pages.

**AVOD is the real volume in India and it is entirely uncovered.** Free and ad-supported streaming is
over 70% of India OTT consumption by monthly active users. YouTube studio channels alone (Goldmines,
Shemaroo, Pen, YRF, T-Series) host 10,000+ full-length Indian films free with ads, reachable through the
YouTube Data API v3 at zero cost within a 10,000 unit/day quota. Archive.org holds 2,300+ public-domain
Indian films. Neither costs anything and neither is in the catalog today.

---

## 4. What needs your key or your money

Everything below is blocked on you. Nothing here blocks the app shipping.

1. **TMDB API key — free, ~2 minutes, highest value per effort.**
   themoviedb.org → Settings → API → request a developer key. Add `TMDB=...` to `.env`.
   Unlocks poster/cast/genre enrichment and a second availability opinion. If TMDB becomes the shipping
   catalog source, it also resolves the redistribution question in item 4.

2. **Watchmode free tier — free, unverified, worth 15 minutes.**
   Sign up on `api.watchmode.com` directly, *not* through RapidAPI (India is excluded from the RapidAPI
   free tier's country list). The free tier gives 2,500 requests/month across 3 countries. The single
   question to answer: does it really return Sun NXT, MX Player and Hungama Play for India? If yes, the
   $349/mo commercial tier closes the long-tail gap without any scraping. If no, don't spend the money.

3. **Streaming Availability direct billing — optional, saves ~20-25%.**
   Currently routed through RapidAPI. Signing up directly at movieofthenight.com is cheaper for the same
   API (Pro $39 vs $49, Ultra $59 vs $79, Mega $199 vs $249). Only worth doing if request volume grows.

4. **The redistribution decision — blocks making the repo public, not the build.**
   The catalog currently shipping in `docs/assets/catalog.json` is derived from uNoGS via RapidAPI, and
   RapidAPI provider terms generally forbid redistributing bulk API output. Options, best first:
   rebuild the shipped artifact from TMDB (explicitly permits redistribution with attribution to both
   TMDB and JustWatch); or confirm in writing that uNoGS permits it; or ship the app with an empty
   catalog and a build script users run with their own key. The application code is identical in all
   three cases — only the file in `docs/assets/` changes.

---

## 5. Recommended sequence from here

1. Ship the app on the multi-provider Streaming Availability catalog. Done or in progress.
2. Add TMDB enrichment once the key exists — posters and genres materially improve both the UI and
   search quality, since genre and cast text feed the BM25 index.
3. Add YouTube Data API v3 ingestion for the studio channels. Free, large, and completely unserved by
   competitors.
4. Verify Watchmode before paying for it.
5. Only then consider targeted scraping for whatever regional platforms remain uncovered. Prior art
   exists (`FissionMailed7/India-ott-catalog-addon` scrapes seven India platforms) but it carries ToS
   risk and ongoing maintenance that the first four steps mostly avoid.

---

## 6. Naming gotcha, recorded so it is not rediscovered

RapidAPI hosts two similarly named, unrelated products. **uNoGS** (older) returns
`403 You are not subscribed to this API` with this repo's key. **unogsNG** is the one this repo is
actually subscribed to and uses. Do not confuse them.
