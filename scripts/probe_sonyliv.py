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
    if data:
        print(json.dumps(data[:1], indent=2))
