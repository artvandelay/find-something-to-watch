#!/usr/bin/env python3
"""
Finalize Raw Probe JSON Files for Aggregators in India
"""

import json
import urllib.request
from pathlib import Path

RAW_DIR = Path(__file__).resolve().parents[1] / "research" / "raw" / "aggregators"
RAW_DIR.mkdir(parents=True, exist_ok=True)

def update_justwatch_probe():
    # Perform working REST provider list + working GraphQL popular titles
    rest_url = "https://apis.justwatch.com/content/providers/locale/en_IN"
    req_rest = urllib.request.Request(rest_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req_rest) as resp:
        rest_data = json.loads(resp.read().decode())

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
                }
                offers(country: $country, platform: WEB) {
                  monetizationType
                  standardWebURL
                  package {
                    clearName
                    technicalName
                  }
                }
              }
            }
          }
        }
        """,
        "variables": {"country": "IN", "first": 5}
    }
    req_gql = urllib.request.Request(
        gql_url,
        data=json.dumps(gql_query).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
    )
    with urllib.request.urlopen(req_gql) as resp:
        gql_data = json.loads(resp.read().decode())

    out = {
        "rest_providers_en_IN": {
            "status": 200,
            "provider_count": len(rest_data),
            "sample_providers": [
                {"id": p.get("id"), "name": p.get("clear_name"), "technical_name": p.get("technical_name")}
                for p in rest_data[:25]
            ]
        },
        "graphql_popular_IN": {
            "status": 200,
            "data": gql_data
        }
    }
    (RAW_DIR / "justwatch_in_probe.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print("Updated justwatch_in_probe.json")

def create_open_datasets_probe():
    data = {
        "github_kaggle_dumps": [
            {
                "name": "Disney+ Hotstar Tv and Movie Catalog (Kaggle)",
                "url": "https://www.kaggle.com/datasets/goelyash/disney-hotstar-tv-and-movie-catalog",
                "title_count": 6874,
                "coverage": "Disney+ Hotstar movies & TV shows (1928-2023)",
                "fields": ["title", "description", "release_year", "rating", "duration", "genres", "languages"]
            },
            {
                "name": "Disney-HotStar-Analysis (GitHub: Bhuvaneswari-Ra)",
                "url": "https://github.com/Bhuvaneswari-Ra/Disney-HotStar-Analysis",
                "title_count": 6874,
                "file": "hotstar.csv",
                "notes": "Includes age ratings, runtimes, 37 genres"
            },
            {
                "name": "Netflix-Prime-Hotstar-Dashboard (GitHub: undiscovered-genius)",
                "url": "https://github.com/undiscovered-genius/Netflix-Prime-Hotstar-Dashboard-Power-BI",
                "files": ["amazon_prime_titles.csv", "disney_plus_titles.csv", "netflix_titles.csv"],
                "notes": "Static snapshots of top 3 global players in India"
            },
            {
                "name": "HotstarScraper (GitHub: ishansarvaiya)",
                "url": "https://github.com/ishansarvaiya/HotstarScraper",
                "stack": "C#, Selenium, Entity Framework Core, SQL Server",
                "schema": ["Movies", "Shows", "Genres", "Languages", "MovieGenres", "MovieLanguages"]
            },
            {
                "name": "Hotstar-Disney-Plus-Scraper (GitHub: root-yash)",
                "url": "https://github.com/root-yash/Hotstar-Disney-Plus-Scraper",
                "stack": "Python, Pyppeteer, BeautifulSoup",
                "notes": "Scrapes Hotstar directly using Indian IP"
            }
        ]
    }
    (RAW_DIR / "open_datasets_probe.json").write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print("Created open_datasets_probe.json")

if __name__ == "__main__":
    update_justwatch_probe()
    create_open_datasets_probe()
