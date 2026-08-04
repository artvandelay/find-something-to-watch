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
    if modules:
        print(f"Sample Module Title: {modules[0].get('title')}")
