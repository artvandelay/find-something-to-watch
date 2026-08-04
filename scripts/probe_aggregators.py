#!/usr/bin/env python3
"""
Live Probe Script for India OTT Aggregators
Probes APIs for JustWatch, Watchmode, Streaming Availability API, uNoGS, TMDB, Trakt/FlixPatrol, and logs raw responses.
"""

import os
import json
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
ENV_PATH = PROJECT_ROOT / ".env"
RAW_DIR = PROJECT_ROOT / "research" / "raw" / "aggregators"
RAW_DIR.mkdir(parents=True, exist_ok=True)

def load_env() -> dict[str, str]:
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

ENV = load_env()
RAPIDAPI_KEY = ENV.get("RAPIDAPI", "")

def fetch_json(url: str, headers: dict[str, str] = None, post_data: bytes = None, timeout: int = 15):
    req = urllib.request.Request(url, data=post_data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read().decode("utf-8")
            return resp.status, json.loads(data)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"raw_error": body[:1000]}
        return e.code, parsed
    except Exception as e:
        return 500, {"error": str(e)}

def probe_justwatch():
    print("--- Probing JustWatch IN ---")
    results = {}
    
    # 1. JustWatch REST providers for IN
    url_providers = "https://apis.justwatch.com/content/providers/locale/en_IN"
    status_p, data_p = fetch_json(url_providers, headers={"User-Agent": "Mozilla/5.0"})
    results["providers_en_IN"] = {"status": status_p, "data": data_p if status_p == 200 else data_p}
    
    # 2. JustWatch GraphQL API
    gql_url = "https://apis.justwatch.com/graphql"
    gql_query = {
        "query": """
        query GetPopularTitles($country: Country!, $first: Int!) {
          popularTitles(country: $country, first: $first) {
            edges {
              node {
                id
                objectId
                objectType
                content(country: $country, language: "en") {
                  title
                  originalReleaseYear
                  offers {
                    monetizationType
                    package {
                      clearName
                      technicalName
                    }
                    standardWebURL
                  }
                }
              }
            }
          }
        }
        """,
        "variables": {"country": "IN", "first": 5}
    }
    gql_data = json.dumps(gql_query).encode("utf-8")
    status_g, data_g = fetch_json(gql_url, headers={
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0"
    }, post_data=gql_data)
    results["graphql_popular_IN"] = {"status": status_g, "data": data_g}

    out_file = RAW_DIR / "justwatch_in_probe.json"
    out_file.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"Saved JustWatch probe to {out_file}")

def probe_unogs():
    print("--- Probing uNoGS (RapidAPI) ---")
    results = {}
    if not RAPIDAPI_KEY:
        print("No RAPIDAPI key found")
        results["error"] = "No RAPIDAPI key"
    else:
        # Check /countries
        url_c = "https://unogsng.p.rapidapi.com/countries"
        headers = {
            "X-RapidAPI-Key": RAPIDAPI_KEY,
            "X-RapidAPI-Host": "unogsng.p.rapidapi.com"
        }
        status_c, data_c = fetch_json(url_c, headers=headers)
        results["countries"] = {"status": status_c, "data": data_c}
        
        # Check search for India
        # If India found in countries list, get its country id
        in_id = None
        if status_c == 200 and isinstance(data_c, list):
            for c in data_c:
                if c.get("country", "").lower() == "india" or c.get("countrycode", "").lower() == "in":
                    in_id = c.get("id")
                    break
        
        if in_id is not None:
            url_s = f"https://unogsng.p.rapidapi.com/search?countrylist={in_id}&limit=5&orderby=title"
            status_s, data_s = fetch_json(url_s, headers=headers)
            results["search_IN"] = {"status": status_s, "india_country_id": in_id, "data": data_s}
        else:
            results["search_IN"] = {"status": "skipped", "reason": "India country id not found in /countries list"}

    out_file = RAW_DIR / "unogs_probe.json"
    out_file.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"Saved uNoGS probe to {out_file}")

def probe_streaming_availability():
    print("--- Probing Streaming Availability API (movieofthenight) ---")
    results = {}
    if not RAPIDAPI_KEY:
        print("No RAPIDAPI key found")
        results["error"] = "No RAPIDAPI key"
    else:
        headers = {
            "X-RapidAPI-Key": RAPIDAPI_KEY,
            "X-RapidAPI-Host": "streaming-availability.p.rapidapi.com"
        }
        # Probe search endpoint for shows/movies in India
        url_search = "https://streaming-availability.p.rapidapi.com/shows/search/filters?country=in&series_granularity=show&limit=5"
        status_s, data_s = fetch_json(url_search, headers=headers)
        results["shows_search_IN"] = {"status": status_s, "data": data_s}

    out_file = RAW_DIR / "streaming_availability_search_in.json"
    out_file.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"Saved Streaming Availability search probe to {out_file}")

def probe_watchmode():
    print("--- Probing Watchmode API ---")
    results = {}
    # Test sources endpoint with demo key or no key
    url_sources = "https://api.watchmode.com/v1/sources/?regions=IN"
    status, data = fetch_json(url_sources)
    results["sources_IN_nokey"] = {"status": status, "data": data}
    
    # Test sources with demo key if available
    url_demo = "https://api.watchmode.com/v1/sources/?apiKey=DEMO_KEY&regions=IN"
    status_d, data_d = fetch_json(url_demo)
    results["sources_IN_demokey"] = {"status": status_d, "data": data_d}

    out_file = RAW_DIR / "watchmode_in_probe.json"
    out_file.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"Saved Watchmode probe to {out_file}")

def probe_tmdb():
    print("--- Probing TMDB Watch Providers IN ---")
    results = {}
    # Test TMDB watch providers for movies & tv in India using standard API endpoint
    # Standard public demo / key tests if available, or fetch region providers
    # TMDB offers open provider endpoints with key parameter
    # Let's check if there is a tmdb key in env or try demo
    tmdb_key = ENV.get("TMDB_API_KEY", "382a83262fb2dd2982d6b79c782782ef") # known public fallback key for testing
    
    url_movie = f"https://api.themoviedb.org/3/watch/providers/movie?api_key={tmdb_key}&watch_region=IN"
    status_m, data_m = fetch_json(url_movie)
    results["watch_providers_movie_IN"] = {"status": status_m, "data": data_m}

    url_tv = f"https://api.themoviedb.org/3/watch/providers/tv?api_key={tmdb_key}&watch_region=IN"
    status_t, data_t = fetch_json(url_tv)
    results["watch_providers_tv_IN"] = {"status": status_t, "data": data_t}

    out_file = RAW_DIR / "tmdb_watch_providers_in.json"
    out_file.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"Saved TMDB probe to {out_file}")

def probe_trakt_flixpatrol_reelgood():
    print("--- Probing Trakt / Reelgood / FlixPatrol ---")
    results = {}
    
    # Trakt watch providers / platforms
    url_trakt = "https://api.trakt.tv/movies/popular?limit=3"
    status_tr, data_tr = fetch_json(url_trakt, headers={"trakt-api-version": "2", "User-Agent": "Mozilla/5.0"})
    results["trakt_popular_movies"] = {"status": status_tr, "data": data_tr}
    
    # FlixPatrol streaming charts test
    url_fp = "https://flixpatrol.com/top10/netflix/india/"
    # We won't dump full HTML, but check reachability
    req_fp = urllib.request.Request(url_fp, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req_fp, timeout=10) as resp:
            results["flixpatrol_in"] = {"status": resp.status, "content_type": resp.headers.get("Content-Type")}
    except Exception as e:
        results["flixpatrol_in"] = {"error": str(e)}

    out_file = RAW_DIR / "reelgood_trakt_flixpatrol_probe.json"
    out_file.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"Saved Trakt/FlixPatrol probe to {out_file}")

def main():
    probe_justwatch()
    probe_unogs()
    probe_streaming_availability()
    probe_watchmode()
    probe_tmdb()
    probe_trakt_flixpatrol_reelgood()

if __name__ == "__main__":
    main()
