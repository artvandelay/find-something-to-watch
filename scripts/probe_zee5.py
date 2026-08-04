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
    if titles:
        print(json.dumps(titles[:2], indent=2))
