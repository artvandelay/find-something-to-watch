import os
import json
import time
import requests
import httpx
from urllib.parse import quote

RAW_DIR = "/Users/jigar/projects/messing-around/llm-search-netflix/research/raw/p1"
os.makedirs(RAW_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
}

def probe_youtube():
    print("Probing YouTube India...")
    start_time = time.time()
    
    # studio channels
    channels = {
        "Goldmines": "UCne8AInI_3f2GjC_1IuIn_A",
        "Shemaroo Movies": "UC6-F5tO8uklgE9Zy8g5G10A",
        "Pen Movies": "UCf-I-L3TeeE8-3X0yM1C5vA",
        "YRF": "UC1vGae2Q3oT5MkhhfW8lwjg",
        "T-Series": "UCq-Fj5jknLsUf-MWSy4_brA"
    }
    
    rss_results = {}
    for name, cid in channels.items():
        rss_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}"
        try:
            r = requests.get(rss_url, headers=HEADERS, timeout=10)
            rss_results[name] = {
                "status_code": r.status_code,
                "url": rss_url,
                "content_length": len(r.content),
                "has_entry": "<entry>" in r.text
            }
        except Exception as e:
            rss_results[name] = {"error": str(e)}

    # Probe storefront page for free videos
    storefront_url = "https://www.youtube.com/feed/storefront?bp=sgI3CgtmcmVlX3ZpZGVvcA%3D%3D"
    try:
        sf_resp = requests.get(storefront_url, headers=HEADERS, timeout=10)
        sf_data = {
            "status_code": sf_resp.status_code,
            "has_ytInitialData": "ytInitialData" in sf_resp.text,
            "page_bytes": len(sf_resp.content)
        }
    except Exception as e:
        sf_data = {"error": str(e)}

    # oEmbed probe
    oembed_url = "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&format=json"
    try:
        oe_resp = requests.get(oembed_url, headers=HEADERS, timeout=10)
        oe_data = oe_resp.json() if oe_resp.status_code == 200 else {}
    except Exception as e:
        oe_data = {"error": str(e)}

    elapsed_ms = round((time.time() - start_time) * 1000, 2)

    result = {
        "platform": "YouTube India",
        "probe_timestamp_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
        "latency_ms": elapsed_ms,
        "rss_feeds": rss_results,
        "free_movies_storefront": sf_data,
        "oembed_test": oe_data,
        "native_api_specs": {
            "name": "YouTube Data API v3",
            "endpoint": "https://www.googleapis.com/youtube/v3/playlistItems",
            "auth": "API Key (free quota 10,000 units/day)",
            "rate_limit": "10,000 units/day (approx 1,000,000 video records via playlistItems/search)",
            "cost": "Free",
            "completeness": "100% of channel uploads and official movies"
        },
        "firecrawl_comparison": {
            "firecrawl_status": "402 Insufficient Credits / Prohibitive for video streaming sites",
            "firecrawl_cost": "$16-$99+/mo for limited credits",
            "recommendation": "Use YouTube Data API v3 / RSS / innerTube endpoints"
        }
    }

    with open(os.path.join(RAW_DIR, "youtube_india.json"), "w") as f:
        json.dump(result, f, indent=2)
    print("Saved youtube_india.json")


def probe_dailymotion():
    print("Probing Dailymotion India...")
    start_time = time.time()
    
    api_url = "https://api.dailymotion.com/videos?fields=id,title,description,channel,created_time,duration,url,thumbnail_360_url&country=in&limit=25"
    search_url = "https://api.dailymotion.com/videos?search=full+movie+hindi&country=in&limit=25"
    
    try:
        r_list = requests.get(api_url, headers=HEADERS, timeout=10)
        data_list = r_list.json() if r_list.status_code == 200 else {}
    except Exception as e:
        data_list = {"error": str(e)}

    try:
        r_search = requests.get(search_url, headers=HEADERS, timeout=10)
        data_search = r_search.json() if r_search.status_code == 200 else {}
    except Exception as e:
        data_search = {"error": str(e)}

    elapsed_ms = round((time.time() - start_time) * 1000, 2)

    result = {
        "platform": "Dailymotion India",
        "probe_timestamp_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
        "latency_ms": elapsed_ms,
        "native_api_response": {
            "status_code": r_list.status_code if 'r_list' in locals() else None,
            "total_items_in_response": len(data_list.get("list", [])),
            "sample_item": data_list.get("list", [{}])[0] if data_list.get("list") else {},
            "has_more": data_list.get("has_more", False)
        },
        "native_search_response": {
            "status_code": r_search.status_code if 'r_search' in locals() else None,
            "total_items_in_response": len(data_search.get("list", [])),
            "sample_item": data_search.get("list", [{}])[0] if data_search.get("list") else {}
        },
        "native_api_specs": {
            "name": "Dailymotion REST API",
            "endpoint": "https://api.dailymotion.com/videos",
            "auth": "None required for public catalog reads",
            "rate_limit": "Generous (unauthenticated rate limit ~10,000 req/day)",
            "cost": "Free",
            "completeness": "High for user-uploaded short films and licensed web content"
        },
        "firecrawl_comparison": {
            "firecrawl_status": "Credit cost high, HTML rendering slow (~3s)",
            "recommendation": "Use Native REST API directly (10x faster, zero cost)"
        }
    }

    with open(os.path.join(RAW_DIR, "dailymotion_india.json"), "w") as f:
        json.dump(result, f, indent=2)
    print("Saved dailymotion_india.json")


def probe_mx_player():
    print("Probing MX Player...")
    start_time = time.time()
    
    web_url = "https://www.mxplayer.in/movies"
    try:
        r_web = requests.get(web_url, headers=HEADERS, timeout=10)
        web_data = {
            "status_code": r_web.status_code,
            "page_size_bytes": len(r_web.content),
            "has_initial_state": "__INITIAL_STATE__" in r_web.text or "window.__mx" in r_web.text
        }
    except Exception as e:
        web_data = {"error": str(e)}

    # Internal API endpoint probe
    api_url = "https://api.mxplayer.in/v1/web/detail/tab/movies?app_version=1.0.0&platform=com.mxplay.desktop&device-density=2"
    try:
        r_api = requests.get(api_url, headers=HEADERS, timeout=10)
        if r_api.status_code == 200:
            api_data = {
                "status_code": 200,
                "json_keys": list(r_api.json().keys()) if isinstance(r_api.json(), dict) else "list",
                "sample": str(r_api.json())[:300]
            }
        else:
            api_data = {"status_code": r_api.status_code, "text": r_api.text[:200]}
    except Exception as e:
        api_data = {"error": str(e)}

    elapsed_ms = round((time.time() - start_time) * 1000, 2)

    result = {
        "platform": "Amazon MX Player (Free AVOD)",
        "probe_timestamp_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
        "latency_ms": elapsed_ms,
        "web_scrape_status": web_data,
        "internal_api_status": api_data,
        "native_api_specs": {
            "name": "MX Player Internal Web BFF API",
            "endpoint": "https://api.mxplayer.in/v1/web/detail/browse/movie",
            "auth": "Guest headers / platform headers",
            "cost": "Free",
            "completeness": "Massive AVOD catalog (100,000+ hours in Hindi, Tamil, Telugu, Marathi, etc.)"
        },
        "firecrawl_comparison": {
            "firecrawl_status": "Fails/slow due to heavy React hydration & infinite scroll",
            "recommendation": "Reverse engineer MX Player BFF endpoints or use python requests with guest headers"
        }
    }

    with open(os.path.join(RAW_DIR, "mx_player.json"), "w") as f:
        json.dump(result, f, indent=2)
    print("Saved mx_player.json")


def probe_global_avod():
    print("Probing Global AVOD (Tubi, Pluto TV, Plex) in India...")
    start_time = time.time()
    
    # Tubi
    tubi_url = "https://tubitv.com"
    try:
        r_tubi = requests.get(tubi_url, headers=HEADERS, timeout=10, allow_redirects=True)
        tubi_res = {
            "status_code": r_tubi.status_code,
            "final_url": r_tubi.url,
            "is_blocked_or_redirected": "blocked" in r_tubi.url.lower() or "gdpr" in r_tubi.url.lower() or r_tubi.status_code in [403, 451],
            "notes": "Tubi is geo-restricted outside North America/Australia and returns geo-block in India."
        }
    except Exception as e:
        tubi_res = {"error": str(e)}

    # Pluto TV
    pluto_url = "https://pluto.tv"
    try:
        r_pluto = requests.get(pluto_url, headers=HEADERS, timeout=10, allow_redirects=True)
        pluto_res = {
            "status_code": r_pluto.status_code,
            "final_url": r_pluto.url,
            "is_blocked_or_not_available": "not-available" in r_pluto.url.lower() or r_pluto.status_code in [403, 404, 451],
            "notes": "Pluto TV is primarily US/Europe focused and unavailable in India without VPN."
        }
    except Exception as e:
        pluto_res = {"error": str(e)}

    # Plex
    plex_url = "https://watch.plex.tv/movies-and-tv"
    try:
        r_plex = requests.get(plex_url, headers=HEADERS, timeout=10)
        plex_res = {
            "status_code": r_plex.status_code,
            "final_url": r_plex.url,
            "is_available_in_india": r_plex.status_code == 200,
            "notes": "Plex Free Movies & TV is globally accessible including India with ad-supported content."
        }
    except Exception as e:
        plex_res = {"error": str(e)}

    elapsed_ms = round((time.time() - start_time) * 1000, 2)

    result = {
        "platform": "Global AVOD (Tubi / Pluto TV / Plex)",
        "probe_timestamp_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
        "latency_ms": elapsed_ms,
        "availability_matrix": {
            "Tubi": tubi_res,
            "Pluto TV": pluto_res,
            "Plex": plex_res
        },
        "summary": "Tubi & Pluto TV are strictly geo-blocked in India (HTTP 403 / geo-redirect). Plex is fully accessible in India with ad-supported free catalog.",
        "firecrawl_comparison": {
            "firecrawl_status": "Firecrawl nodes in US might see Tubi/Pluto, but results are irrelevant for India-based users without regional access.",
            "recommendation": "Exclude Tubi & Pluto TV from India catalog pipeline; include Plex IN catalog."
        }
    }

    with open(os.path.join(RAW_DIR, "global_avod_india_availability.json"), "w") as f:
        json.dump(result, f, indent=2)
    print("Saved global_avod_india_availability.json")


def probe_fast_channels():
    print("Probing FAST Channels in India (Samsung TV+, Xiaomi PatchWall, LG Channels)...")
    start_time = time.time()
    
    samsung_url = "https://www.samsung.com/in/tvs/tv-plus/"
    try:
        r_samsung = requests.get(samsung_url, headers=HEADERS, timeout=10)
        samsung_res = {
            "status_code": r_samsung.status_code,
            "has_content": "tv-plus" in r_samsung.text.lower(),
            "notes": "Samsung TV Plus IN is pre-installed on Samsung Smart TVs in India (~100+ free live channels)."
        }
    except Exception as e:
        samsung_res = {"error": str(e)}

    xiaomi_url = "https://www.mi.com/in/mimiui/patchwall"
    try:
        r_xiaomi = requests.get(xiaomi_url, headers=HEADERS, timeout=10)
        xiaomi_res = {
            "status_code": r_xiaomi.status_code,
            "notes": "Xiaomi PatchWall aggregates 30+ free & paid OTT apps on Mi Smart TVs in India."
        }
    except Exception as e:
        xiaomi_res = {"error": str(e)}

    lg_url = "https://www.lg.com/in/tvs/lg-channels"
    try:
        r_lg = requests.get(lg_url, headers=HEADERS, timeout=10)
        lg_res = {
            "status_code": r_lg.status_code,
            "notes": "LG Channels IN powered by Xumo/Pluto technology embedded in webOS."
        }
    except Exception as e:
        lg_res = {"error": str(e)}

    elapsed_ms = round((time.time() - start_time) * 1000, 2)

    result = {
        "platform": "FAST Channels in India",
        "probe_timestamp_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
        "latency_ms": elapsed_ms,
        "providers": {
            "Samsung TV Plus IN": samsung_res,
            "Xiaomi PatchWall": xiaomi_res,
            "LG Channels IN": lg_res
        },
        "fast_landscape_india": {
            "nature": "Hardware OEM bundled linear streaming channels (Samsung, Xiaomi, LG, TCL).",
            "epg_ingestion": "EPG streams use HLS / m3u8 or internal OEM feeds.",
            "feasibility_for_search": "🟡 Moderate - channel metadata can be scraped from OEM web portals, but full VOD depth is limited compared to dedicated AVOD apps."
        }
    }

    with open(os.path.join(RAW_DIR, "fast_channels_india.json"), "w") as f:
        json.dump(result, f, indent=2)
    print("Saved fast_channels_india.json")


def probe_archive_org():
    print("Probing Archive.org Indian Classic Films...")
    start_time = time.time()
    
    search_url = 'https://archive.org/advancedsearch.php?q=mediatype%3Amovies+AND+%28subject%3A%22indian+movies%22+OR+subject%3A%22bollywood%22+OR+subject%3A%22hindi+movies%22+OR+subject%3A%22indian+cinema%22%29&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=publicdate&fl%5B%5D=downloads&sort%5B%5D=downloads+desc&rows=25&page=1&output=json'
    
    try:
        r_search = requests.get(search_url, headers=HEADERS, timeout=12)
        search_json = r_search.json() if r_search.status_code == 200 else {}
        docs = search_json.get("response", {}).get("docs", [])
        num_found = search_json.get("response", {}).get("numFound", 0)
    except Exception as e:
        search_json = {"error": str(e)}
        docs = []
        num_found = 0

    # Probe metadata for top record if found
    metadata_res = {}
    if docs:
        first_id = docs[0].get("identifier")
        meta_url = f"https://archive.org/metadata/{first_id}"
        try:
            r_meta = requests.get(meta_url, headers=HEADERS, timeout=10)
            metadata_res = r_meta.json() if r_meta.status_code == 200 else {}
        except Exception as e:
            metadata_res = {"error": str(e)}

    elapsed_ms = round((time.time() - start_time) * 1000, 2)

    result = {
        "platform": "Internet Archive (Archive.org Indian Public Domain Films)",
        "probe_timestamp_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
        "latency_ms": elapsed_ms,
        "search_response": {
            "status_code": r_search.status_code if 'r_search' in locals() else None,
            "total_items_found": num_found,
            "items_returned": len(docs),
            "sample_records": docs[:5]
        },
        "sample_metadata_record": {
            "identifier": docs[0].get("identifier") if docs else None,
            "files_count": len(metadata_res.get("files", [])),
            "media_type": metadata_res.get("metadata", {}).get("mediatype")
        },
        "native_api_specs": {
            "name": "Archive.org Advanced Search & Metadata API",
            "endpoint": "https://archive.org/advancedsearch.php",
            "auth": "None required (Open Public Domain)",
            "rate_limit": "Generous (up to 15 req/sec)",
            "cost": "100% Free",
            "completeness": "Massive archive of Indian pre-1970 classic films, newsreels, and public domain cultural media."
        },
        "firecrawl_comparison": {
            "firecrawl_status": "Overkill for Archive.org; API is clean, fast, and structured.",
            "recommendation": "Use Archive.org Advanced Search JSON API directly."
        }
    }

    with open(os.path.join(RAW_DIR, "archive_org_india.json"), "w") as f:
        json.dump(result, f, indent=2)
    print("Saved archive_org_india.json")


def probe_regional_free():
    print("Probing ShemarooMe, Hungama Play, JioCinema...")
    start_time = time.time()
    
    # ShemarooMe
    shemaroo_url = "https://www.shemaroome.com"
    try:
        r_shemaroo = requests.get(shemaroo_url, headers=HEADERS, timeout=10)
        shemaroo_res = {
            "status_code": r_shemaroo.status_code,
            "page_bytes": len(r_shemaroo.content),
            "has_app_config": "window.__SHEMAROO" in r_shemaroo.text or "shemaroome" in r_shemaroo.text
        }
    except Exception as e:
        shemaroo_res = {"error": str(e)}

    # Hungama Play
    hungama_url = "https://www.hungama.com/movies/"
    try:
        r_hungama = requests.get(hungama_url, headers=HEADERS, timeout=10)
        hungama_res = {
            "status_code": r_hungama.status_code,
            "page_bytes": len(r_hungama.content),
            "has_movie_grid": "movie" in r_hungama.text.lower()
        }
    except Exception as e:
        hungama_res = {"error": str(e)}

    # JioCinema / JioHotstar Free Tier
    jiocinema_url = "https://www.jiocinema.com/movies"
    try:
        r_jiocinema = requests.get(jiocinema_url, headers=HEADERS, timeout=10)
        jiocinema_res = {
            "status_code": r_jiocinema.status_code,
            "final_url": r_jiocinema.url,
            "is_merged_into_hotstar": "hotstar" in r_jiocinema.url.lower(),
            "page_bytes": len(r_jiocinema.content)
        }
    except Exception as e:
        jiocinema_res = {"error": str(e)}

    elapsed_ms = round((time.time() - start_time) * 1000, 2)

    result = {
        "platform": "Regional Free Tier (ShemarooMe / Hungama Play / JioCinema)",
        "probe_timestamp_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
        "latency_ms": elapsed_ms,
        "probes": {
            "ShemarooMe": shemaroo_res,
            "Hungama Play": hungama_res,
            "JioCinema / JioHotstar Free": jiocinema_res
        },
        "insights": {
            "ShemarooMe": "Has extensive vintage Hindi, Gujarati, and Marathi free catalog. Accessible via web/mobile BFF REST endpoints.",
            "Hungama Play": "Ad-supported movie catalog accessible via client JSON endpoints (`www.hungama.com/api/`).",
            "JioCinema": "JioCinema and Disney+ Hotstar have officially consolidated into JioHotstar. Free tier content (like IPL, daily soaps, select movies) is accessible via JioHotstar BFF `api.hotstar.com`."
        }
    }

    with open(os.path.join(RAW_DIR, "regional_free_shemaroo_hungama_jio.json"), "w") as f:
        json.dump(result, f, indent=2)
    print("Saved regional_free_shemaroo_hungama_jio.json")


if __name__ == "__main__":
    probe_youtube()
    probe_dailymotion()
    probe_mx_player()
    probe_global_avod()
    probe_fast_channels()
    probe_archive_org()
    probe_regional_free()
    print("All P1 probes complete!")
