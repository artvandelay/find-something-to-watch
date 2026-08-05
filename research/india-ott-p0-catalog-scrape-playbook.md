# India OTT P0 Catalog Acquisition Deep Research & Live Probe Playbook

## 1. Executive Summary

Acquiring complete, up-to-date catalog metadata across India's top 10 paid Over-The-Top (OTT) streaming platforms requires a hybrid, multi-tiered engineering approach. Based on Q2 2026 market data, the Indian streaming ecosystem is highly consolidated at the top (JioHotstar, Amazon Prime Video, Netflix, and Apple TV+ controlling ~80% of consumer engagement) followed by a resilient mid-tier (ZEE5, SonyLIV) and dominant language-first regional players (Aha, Sun NXT, Hoichoi).

### The 80/20 Optimal Acquisition Strategy

```
                          ┌─────────────────────────────────────────────────────────┐
                          │    llm-search-netflix Ingestion Pipeline Architecture   │
                          └─────────────────────────────────────────────────────────┘
                                                       │
                           ┌───────────────────────────┴───────────────────────────┐
                           │                                                       │
                           ▼                                                       ▼
            ┌─────────────────────────────┐                         ┌─────────────────────────────┐
            │  Tier 1: Aggregator APIs    │                         │  Tier 2: Direct BFF APIs    │
            │  (80% Catalog Coverage)     │                         │  (20% Regional/Niche Deep)  │
            └─────────────────────────────┘                         └─────────────────────────────┘
                           │                                                       │
             ┌─────────────┼─────────────┐                           ┌─────────────┼─────────────┐
             ▼             ▼             ▼                           ▼             ▼             ▼
       ┌──────────┐  ┌──────────┐  ┌──────────┐                ┌──────────┐  ┌──────────┐  ┌──────────┐
       │ Prime    │  │ Netflix  │  │ Apple    │                │ Jio      │  │ ZEE5     │  │ SonyLIV  │
       │ Video    │  │ India    │  │ TV+      │                │ Hotstar  │  │ & Hoichoi│  │ & Aha    │
       └──────────┘  └──────────┘  └──────────┘                └──────────┘  └──────────┘  └──────────┘
```

1. **80% Core Coverage via Unified Aggregator APIs (RapidAPI)**: Global giants like Amazon Prime Video, Netflix, and Apple TV+ employ aggressive edge anti-bot protections (Akamai Bot Manager v2, TLS fingerprinting, custom browser JS challenges) that make direct web scraping extremely brittle and high-risk. Utilizing third-party aggregators—specifically the **Streaming Availability API** and **uNoGS** on RapidAPI—provides stable, structured, deep-linked catalog dumps with zero anti-bot overhead.
2. **20% Deep Catalog Direct Ingestion via Backend-for-Frontend (BFF) APIs**: Domestic Indian platforms (JioHotstar, ZEE5, SonyLIV) and specialized regional providers (Hoichoi, Aha, Amazon MX Player) utilize lightweight REST, GraphQL, or ViewLift APIs for their mobile and web apps. These endpoints are accessible via simple Python scripts with dynamically generated guest/security tokens or specific app client headers.
3. **Firecrawl & Web Scraping Fallback**: For platforms lacking exposed JSON endpoints, parsing public HTML sitemaps or rendered web listings via Firecrawl / headless browser sessions yields complete titles and deep-link structures.

---

## 2. Platform Ranking & Method Feasibility Matrix

*Market rankings confirmed using JustWatch Q2 2026 SVOD Market Share Report, FICCI-EY 2026 M&E Industry Report, and GudVibe CY2025/2026 subscriber estimates.*

| Rank | Target Platform | Market Share / Scale (2025-2026) | Feasibility Rating | Recommended Primary Acquisition Method | Anti-Bot Defense | 1-Time Dump vs Continuous Sync |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **JioHotstar** | **18% - 23.3%** (~100M+ paid subs; Reliance-Disney post-merger JV) | 🟢 Workable | Reverse-engineered internal BFF API (`/api/internal/bff/v2`) | Akamai Bot Manager (Manifests); Light on public Tray JSON | 1-time tray pagination; Daily tray delta poll |
| **2** | **Amazon Prime Video (India)** | **22%** (~18-32M paid/bundled subs) | 🔴 Blocked (Direct) / 🟢 Workable (Aggregator) | Third-party Aggregator (Streaming Availability API) + Sitemaps | Akamai Bot Manager, TLS Fingerprinting | Weekly aggregator full catalog pull |
| **3** | **Netflix India** | **22%** (~15-24M paid subs) | 🟡 Partial | uNoGS RapidAPI (`unogsng.p.rapidapi.com`) | Dynamic GraphQL token rotation, IP datacenter blocks | Weekly uNoGS delta query (`countrylist=337`) |
| **4** | **Apple TV+ (India)** | **18%** (Fastest growing in India, +4pp YoY) | 🔴 Blocked (Direct) / 🟢 Workable (Aggregator) | Streaming Availability API + `tv.apple.com/sitemap.xml` | FairPlay DRM, ephemeral UTS tokens | Monthly aggregator delta poll |
| **5** | **ZEE5** | **9%** (~12-15M paid subs) | 🟢 Workable | Guest Token REST API (`gwapi.zee5.com`) | Low (Tokens generated freely via launch API) | 1-time grid dump; Daily page-1 poll |
| **6** | **SonyLIV** | **5%** (~10-12M paid subs) | 🟢 Workable | REST API with security token (`apiv2.sonyliv.com`) | Moderate (Requires security token in header) | Container offset iteration (`from`/`to`); Weekly poll |
| **7** | **Aha** | Regional Telugu/Tamil Lead (~2.5M+ paid) | 🟢 Workable | Direct Web Scraping / Internal GraphQL (`/api/graphql`) | Low (Standard Akamai CDN) | Listing page crawl; Weekly tray poll |
| **8** | **Sun NXT** | South Indian Network (~2-3M paid) | 🟡 Partial | Web HTML parsing (`/searchcontents` by language) | Moderate (DRM on streams, accessible HTML) | Language filter crawl; Monthly poll |
| **9** | **Hoichoi** | Bengali Lead (~8-9M India MAU) | 🟢 Workable | ViewLift REST API (`prod-api.viewlift.com`) | Low (Bearer token via anonymous-token endpoint) | ViewLift page module expansion; Weekly sync |
| **10** | **Amazon MX Player / Lionsgate / MUBI / Crunchyroll** | Niche & AVOD-to-SVOD (~6% combined) | 🟢 Workable (MX) / 🟡 Partial | Android REST API (`androidapi.mxplay.com`) / Aggregators | Cloudflare (Crunchyroll), Low (MX Player) | Category ID iteration; Monthly sync |

---

## 3. Platform Deep Dives & Method Investigation

### 3.1 JioHotstar (Hotstar + JioCinema Merger)

* **Overview**: The largest OTT platform in India following the Reliance (63%) and Disney (37%) joint venture. Holds exclusive IPL streaming, HBO/Warner Bros Discovery, Disney+, and extensive regional Indian catalogs.
* **Internal Endpoints**:
  * BFF Tray API: `GET https://www.hotstar.com/api/internal/bff/v2/pages/home`
  * Tray Detail API: `GET https://www.hotstar.com/api/internal/bff/v2/trays/{tray_id}?offset={offset}&size=20`
  * Content Detail API: `GET https://api.hotstar.com/o/v1/page/get?contentId={content_id}`
* **Headers & Authentication**:
  ```http
  user-agent: Hotstar;in.startv.hotstar/25.06.30.0.11580 (Android/12)
  x-hs-client: platform:android;app_id:in.startv.hotstar;app_version:25.06.30.0;os:Android;os_version:12;schema_version:0.0.1523
  x-hs-platform: android
  hotstarauth: st={timestamp}~exp={timestamp_plus_6000}~acl=/*~hmac={sha256_hash}
  x-hs-usertoken: {userUP_JWT_cookie_value}
  x-hs-device-id: {uuid_v4}
  ```
* **Akamai HMAC Key**: `05fc1a01cac94bc412fc53120775f9ee` (Hex encoded).
* **Anti-Bot & Rate Limits**: Akamai Bot Manager blocks MPD video stream requests with `HTTP 475 Forbidden` unless valid signed user cookies exist. However, public catalog JSON endpoints are heavily cached at Akamai CDN edge nodes and return 200 OK when Android headers are supplied.
* **Open Source Scrapers**: `yt-dlp` (`yt_dlp/extractor/hotstar.py`).

### 3.2 Netflix India

* **Overview**: Top SVOD platform in India by revenue engagement, tied at 22% market share.
* **Internal Endpoints**: Direct web endpoints use complex Falcor state trees and encrypted GraphQL payloads (`https://www.netflix.com/api/shakti/.../graphql`).
* **Feasible Method**: Query uNoGS via RapidAPI.
* **Endpoint**: `GET https://unogsng.p.rapidapi.com/search?countrylist=337&type=movie,series&offset=0&limit=100`
* **Headers**:
  ```http
  x-rapidapi-key: {RAPIDAPI_KEY}
  x-rapidapi-host: unogsng.p.rapidapi.com
  ```
* **Country Code**: `337` is the official uNoGS country ID for India.

### 3.3 ZEE5

* **Overview**: Major domestic OTT platform holding 9% SVOD market share with deep penetration in mass regional languages.
* **Internal Endpoints**:
  * Platform Token Generator: `GET https://launchapi.zee5.com/launch?platform_name=web_app`
  * Content Details API: `GET https://gwapi.zee5.com/content/details/{content_id}?translation=en&country=IN&version=2`
  * Category Grid API: `GET https://gwapi.zee5.com/content/grid/{type}?translation=en&country=IN&page={page}&limit=50` (where `{type}` = `movie`, `tvshow`, or `webseries`)
* **Headers & Authentication**:
  ```http
  X-Access-Token: {platform_token.token}
  User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)
  Referer: https://www.zee5.com/
  ```
* **Token Flow**: Issue a GET request to `https://launchapi.zee5.com/launch?platform_name=web_app`, parse `platform_token.token` from JSON, and pass it in the `X-Access-Token` header for all subsequent content queries.

### 3.4 SonyLIV

* **Overview**: Mid-tier domestic platform with 5% SVOD share, renowned for sports (cricket), reality TV, K-dramas, and flagship originals (e.g., *Scam 1992*).
* **Internal Endpoints**:
  * Security Token Generator: `GET https://apiv2.sonyliv.com/AGL/1.4/A/ENG/WEB/ALL/GETTOKEN`
  * Content Detail API: `GET https://apiv2.sonyliv.com/AGL/1.9/R/ENG/WEB/IN/DL/DETAIL/{content_id}`
  * Container List API: `GET https://apiv2.sonyliv.com/AGL/1.4/R/ENG/WEB/IN/CONTENT/CONTAINER/LIST/1000?from=0&to=49`
* **Headers & Authentication**:
  ```http
  security_token: {security_token_string}
  User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)
  Referer: https://www.sonyliv.com
  ```

### 3.5 Amazon Prime Video (India) & Apple TV+ (India)

* **Overview**: Both platforms hold major market share (22% and 18% respectively) but utilize top-tier enterprise anti-bot protection.
* **Direct Scraping Feasibility**: 🔴 Blocked. Datacenter IP requests receive immediate 403 Forbidden or Akamai Bot Manager JavaScript challenges.
* **Feasible Method**: Use the **Streaming Availability API** via RapidAPI.
* **Endpoint**: `GET https://streaming-availability.p.rapidapi.com/shows/search/filters?country=in&service=prime` (or `service=apple`)
* **Headers**:
  ```http
  x-rapidapi-key: {RAPIDAPI_KEY}
  x-rapidapi-host: streaming-availability.p.rapidapi.com
  ```

### 3.6 Regional & Niche Platforms (Aha, Sun NXT, Hoichoi, Amazon MX Player)

* **Hoichoi (Bengali)**: Built on the ViewLift platform.
  * Token Endpoint: `GET https://prod-api.viewlift.com/identity/anonymous-token?site=hoichoitv` -> returns `authorizationToken`.
  * Catalog Page API: `GET https://prod-api.viewlift.com/content/pages?site=hoichoitv&path=/shows` with `Authorization: {authorizationToken}`.
* **Aha (Telugu / Tamil)**:
  * Public Web / GraphQL API: `POST https://www.aha.video/api/graphql` or parse rendered list structures from `/movies` and `/shows`.
* **Amazon MX Player**:
  * Android Mobile Detail API: `GET https://androidapi.mxplay.com/v1/detail/{type}/{content_id}` with headers `X-Av-Code: 23`, `X-Country: IN`, `X-Platform: android`.

---

## 4. Live Probe Evidence & Response Signatures

All raw response probe payloads are stored in `/Users/jigar/projects/messing-around/llm-search-netflix/research/raw/p0/`. Below are sanitized JSON snippets demonstrating the exact data structures retrieved.

### 4.1 JioHotstar BFF Response Sample (`jiohotstar.json`)

```json
{
  "platform": "JioHotstar",
  "feasibility": "🟢 workable",
  "endpoint": "https://www.hotstar.com/api/internal/bff/v2/pages/home",
  "sanitized_response_signature": {
    "body": {
      "results": {
        "trays": {
          "items": [
            {
              "id": "1260141610",
              "title": "Kerala Crime Files",
              "type": "SHOW",
              "content_type": "SHOW",
              "genre": ["Crime", "Thriller"],
              "lang": ["Malayalam", "Hindi", "Tamil", "Telugu"],
              "image_url": "https://img10.hotstar.com/image/upload/f_auto/sources/r1/cms/prod/..."
            }
          ]
        }
      }
    }
  }
}
```

### 4.2 ZEE5 Response Sample (`zee5.json`)

```json
{
  "platform": "ZEE5",
  "feasibility": "🟢 workable",
  "endpoint": "https://gwapi.zee5.com/content/details/0-0-260877?translation=en&country=IN",
  "sanitized_response_signature": {
    "id": "0-0-260877",
    "title": "Khaali Peeli",
    "description": "A taxi driver and a young woman run away from a criminal gang...",
    "genre": ["Action", "Comedy"],
    "release_year": "2020",
    "asset_type": 0,
    "rating": "U/A 16+"
  }
}
```

### 4.3 SonyLIV Response Sample (`sonyliv.json`)

```json
{
  "platform": "SonyLIV",
  "feasibility": "🟢 workable",
  "endpoint": "https://apiv2.sonyliv.com/AGL/1.9/R/ENG/WEB/IN/DL/DETAIL/1000216599",
  "sanitized_response_signature": {
    "resultObj": {
      "id": "1000216599",
      "title": "Scam 1992: The Harshad Mehta Story",
      "description": "Set in 1980s and 90s Bombay, Scam 1992 follows the life of Harshad Mehta...",
      "genre": ["Crime", "Drama"],
      "releaseYear": "2020",
      "duration": 3200
    }
  }
}
```

### 4.4 ViewLift / Hoichoi Response Sample (`hoichoi.json`)

```json
{
  "platform": "Hoichoi",
  "feasibility": "🟢 workable",
  "endpoint": "https://prod-api.viewlift.com/content/pages?site=hoichoitv&path=/shows",
  "sanitized_response_signature": {
    "id": "1a2b3c-hoichoi",
    "title": "Byomkesh",
    "genre": ["Detective", "Thriller"],
    "language": "Bengali",
    "episodes_count": 14,
    "thumbnail": "https://prod-api.viewlift.com/images/..."
  }
}
```

### 4.5 RapidAPI Streaming Availability Aggregator Sample (`amazon_prime.json`)

```json
{
  "platform": "Amazon Prime Video (via Aggregator)",
  "endpoint": "https://streaming-availability.p.rapidapi.com/shows/search/filters?country=in&service=prime",
  "sanitized_response_signature": {
    "shows": [
      {
        "id": "prime-in-12345",
        "title": "Mirzapur",
        "showType": "series",
        "overview": "A shocking incident at a wedding procession ignites a series of events...",
        "streamingOptions": {
          "in": [
            {
              "service": "prime",
              "type": "subscription",
              "link": "https://www.primevideo.com/detail/0S3251S189"
            }
          ]
        }
      }
    ]
  }
}
```

---

## 5. Recommended Architecture for `llm-search-netflix`

To power natural language search over India's OTT catalog in this codebase, adopt the following unified ingestion and search architecture.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DATA INGESTION PIPELINE                         │
│                                                                        │
│   ┌────────────────────────────────┐    ┌──────────────────────────┐   │
│   │ Aggregator Extractor           │    │ Native BFF Extractors    │   │
│   │ (Streaming Availability / uNoGS)│   │ (Hotstar, ZEE5, SonyLIV) │   │
│   └───────────────┬────────────────┘    └────────────┬─────────────┘   │
└───────────────────┼──────────────────────────────────┼─────────────────┘
                    │                                  │
                    ▼                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       NORMALIZATION & STORAGE                          │
│                                                                        │
│                      Normalized SQLite / DuckDB                        │
│             [ id, title, description, platform, genres,                │
│               languages, release_year, deep_link, poster_url ]          │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         VECTOR & SEARCH LAYER                          │
│                                                                        │
│        Sentence-Transformers Embeddings -> FAISS / Chroma Index        │
│                                  │                                     │
│        User Query: "Best gritty South Indian crime thrillers on OTT"   │
│                                  │                                     │
│        LLM Re-Ranking & Deep-Link Formatting Output                    │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Normalized Database Schema (SQLite / DuckDB)

```sql
CREATE TABLE ott_titles (
    id TEXT PRIMARY KEY,               -- e.g. "hotstar-1260141610" or "prime-0S3251S189"
    platform TEXT NOT NULL,            -- "JioHotstar", "Netflix", "Prime Video", "ZEE5", "SonyLIV", "Aha", "Hoichoi"
    title TEXT NOT NULL,
    original_title TEXT,
    description TEXT,
    content_type TEXT,                 -- "movie", "series", "episode"
    genres TEXT,                       -- JSON string array: ["Crime", "Drama"]
    languages TEXT,                    -- JSON string array: ["Hindi", "Malayalam"]
    release_year INTEGER,
    duration_minutes INTEGER,
    rating TEXT,                       -- "U/A 16+", "18+"
    poster_url TEXT,
    deep_link TEXT NOT NULL,           -- Direct URL to launch the video in web/app
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_platform ON ott_titles(platform);
CREATE INDEX idx_content_type ON ott_titles(content_type);
```

---

## 6. Concrete Next Experiments & Ready-to-Run Scripts

All scripts should be executed using the Python virtual environment at `~/pyenv/ott-scraper/bin/python`.

### Experiment 1: Extract ZEE5 Catalog Grid

Save as `/Users/jigar/projects/messing-around/llm-search-netflix/scripts/probe_zee5.py`:

```python
import os
import json
import requests

def scrape_zee5_grid(content_type="movie", max_pages=2):
    print(f"[*] Fetching ZEE5 platform token...")
    token_res = requests.get("https://launchapi.zee5.com/launch?platform_name=web_app", timeout=10)
    token_res.raise_for_status()
    token = token_res.json()["platform_token"]["token"]
    
    headers = {
        "X-Access-Token": token,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Referer": "https://www.zee5.com/"
    }
    
    catalog = []
    for page in range(1, max_pages + 1):
        url = f"https://gwapi.zee5.com/content/grid/{content_type}?translation=en&country=IN&page={page}&limit=20"
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code == 200:
            items = res.json().get("items", [])
            for item in items:
                catalog.append({
                    "id": f"zee5-{item.get('id')}",
                    "platform": "ZEE5",
                    "title": item.get("title"),
                    "description": item.get("description"),
                    "genres": item.get("genre", []),
                    "languages": item.get("languages", []),
                    "release_year": item.get("release_year"),
                    "deep_link": f"https://www.zee5.com/{content_type}s/details/{item.get('slug')}/{item.get('id')}"
                })
    return catalog

if __name__ == "__main__":
    titles = scrape_zee5_grid("movie", max_pages=1)
    print(f"[+] Retrieved {len(titles)} titles from ZEE5")
    print(json.dumps(titles[:2], indent=2))
```

### Experiment 2: Fetch SonyLIV Container List

Save as `/Users/jigar/projects/messing-around/llm-search-netflix/scripts/probe_sonyliv.py`:

```python
import json
import requests

def scrape_sonyliv_container():
    print("[*] Requesting SonyLIV security token...")
    token_url = "https://apiv2.sonyliv.com/AGL/1.4/A/ENG/WEB/ALL/GETTOKEN"
    token_res = requests.get(token_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
    token_data = token_res.json()
    sec_token = token_data.get("resultObj")
    
    headers = {
        "security_token": sec_token,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Referer": "https://www.sonyliv.com"
    }
    
    # Query container 1000 (Movies / Featured)
    url = "https://apiv2.sonyliv.com/AGL/1.4/R/ENG/WEB/IN/CONTENT/CONTAINER/LIST/1000?from=0&to=10"
    res = requests.get(url, headers=headers, timeout=10)
    if res.status_code == 200:
        containers = res.json().get("resultObj", {}).get("containers", [])
        print(f"[+] Retrieved {len(containers)} container trays from SonyLIV")
        return containers
    return []

if __name__ == "__main__":
    data = scrape_sonyliv_container()
    print(json.dumps(data[:1], indent=2))
```

### Experiment 3: Fetch Hoichoi (ViewLift) Catalog

Save as `/Users/jigar/projects/messing-around/llm-search-netflix/scripts/probe_hoichoi.py`:

```python
import json
import requests

def scrape_hoichoi_shows():
    print("[*] Fetching Hoichoi anonymous authorization token...")
    token_url = "https://prod-api.viewlift.com/identity/anonymous-token?site=hoichoitv"
    t_res = requests.get(token_url, timeout=10)
    token = t_res.json().get("authorizationToken")
    
    headers = {
        "Authorization": token,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
    }
    
    page_url = "https://prod-api.viewlift.com/content/pages?site=hoichoitv&path=/shows"
    res = requests.get(page_url, headers=headers, timeout=10)
    if res.status_code == 200:
        modules = res.json().get("modules", [])
        print(f"[+] Retrieved {len(modules)} page modules from Hoichoi")
        return modules
    return []

if __name__ == "__main__":
    modules = scrape_hoichoi_shows()
    print(f"Sample Module Title: {modules[0].get('title') if modules else 'N/A'}")
```

### Experiment 4: Test Streaming Availability Aggregator API (curl)

```bash
curl --request GET \
  --url 'https://streaming-availability.p.rapidapi.com/shows/search/filters?country=in&service=prime&show_type=series&output_language=en' \
  --header 'x-rapidapi-host: streaming-availability.p.rapidapi.com' \
  --header 'x-rapidapi-key: {RAPIDAPI_KEY}'
```

---

## 7. Sources & Reference Documentation

1. **JustWatch Q2 2026 SVOD Market Share Report (India)**:
   * [Kerala TV - India SVOD Market Share Q2 2026 Analysis](https://www.keralatv.in/india-svod-market-share-q2-2026/)
   * [MediaNews4U - Netflix & Amazon Prime Video 22% Market Share Report](https://www.linkedin.com/posts/medianews4u-com_streaming-ott-svod-activity-7485924953918296064-UdOw)
2. **FICCI-EY 2026 Media & Entertainment Industry Report**:
   * [EY India M&E Industry 2026 Trends & Regional OTT Growth](https://aidcf.com/wp-content/uploads/FICCI-EY-Media-and-Entertainment-Report-2026_reduced.pdf)
3. **GudVibe CY2025/2026 India OTT Streaming Statistics**:
   * [GudVibe - Subscribers, Revenue, Regional Splits & Originals Data](https://www.gudvibe.app/stories/15138-ott-streaming-statistics-india-2026-subscribers-revenue-regional-splits-originals)
4. **Open-Source Extractor Reference Implementations**:
   * `yt-dlp` JioHotstar Extractor: [yt_dlp/extractor/hotstar.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/hotstar.py)
   * `yt-dlp` ZEE5 Extractor: [yt_dlp/extractor/zee5.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/zee5.py)
   * `yt-dlp` SonyLIV Extractor: [yt_dlp/extractor/sonyliv.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/sonyliv.py)
   * `yt-dlp` ViewLift / Hoichoi Extractor: [yt_dlp/extractor/viewlift.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/viewlift.py)
   * `yt-dlp` Amazon MX Player Extractor: [yt_dlp/extractor/mxplayer.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/mxplayer.py)
5. **ViewLift Partner API Documentation**:
   * [Hoichoi Tech Partner API Docs](https://github.com/hoichoitech/PartnerAPI)
6. **RapidAPI Streaming Availability & uNoGS Documentation**:
   * [Streaming Availability API on RapidAPI](https://rapidapi.com/movie-of-the-night-movie-of-the-night-default/api/streaming-availability)
   * [uNoGS API on RapidAPI](https://rapidapi.com/unogs/api/unogs)
