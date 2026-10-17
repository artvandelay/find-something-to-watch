#!/usr/bin/env python3
"""Build docs/assets/free-sources.json from the Open Culture free lists."""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_catalog import _clean_text  # noqa: E402

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
RECORD_KEYS = ["id", "t", "y", "k", "rt", "s", "im", "r", "p", "u", "img", "l", "g", "v"]
KIND_CODE = {"podcast": "p", "movie": "m", "audiobook": "a"}
YEAR_RE = re.compile(r"\((1[89]\d\d|20\d\d)\)")
SKIP_TITLE_RE = re.compile(
    r"^(?:how to|where to|watch hundreds)\b"
    r"|^\d{2,}\s+(?:\w+\s+){0,3}(?:films|movies|documentaries|cartoons|shorts)\b",
    re.IGNORECASE,
)
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
SOURCES = (
    {
        "id": "openculture-podcasts",
        "label": "Open Culture: Great Free Podcasts",
        "url": "https://www.openculture.com/great-podcasts",
        "kind": "podcast",
    },
    {
        "id": "openculture-movies",
        "label": "Open Culture: Free Movies Online",
        "url": "https://www.openculture.com/freemoviesonline",
        "kind": "movie",
    },
    {
        "id": "openculture-audiobooks",
        "label": "Open Culture: Free Audiobooks",
        "url": "https://www.openculture.com/freeaudiobooks",
        "kind": "audiobook",
    },
)


def clean_text(value) -> str:
    text = "" if value is None else str(value)
    return _clean_text(text.replace("\u00ad", ""))


def slugify(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", folded.lower()).strip("-")
    return slug or "title"


def host_of(url: str) -> str:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host.startswith("m."):
        host = host[2:]
    return host


def classify_url(url: str, label: str | None = None) -> str | None:
    host = host_of(url)
    if host in {"youtube.com", "youtu.be", "music.youtube.com"}:
        return "free_youtube"
    if host == "vimeo.com":
        return "free_vimeo"
    if host == "archive.org" or host.endswith(".archive.org"):
        return "free_archive"
    if host == "librivox.org" or host.endswith(".librivox.org"):
        return "free_librivox"
    if host == "open.spotify.com":
        return "free_spotify"
    if host in {"podcasts.apple.com", "itunes.apple.com"}:
        return "free_apple"
    if host == "openculture.com" or host.endswith(".openculture.com"):
        return "free_openculture"
    if host == "podcasts.google.com":
        return None
    if clean_text(label).lower() == "rss":
        return "free_rss"
    return "free_web"


def normalize_url(url: str, storefront: str = "in") -> str:
    value = clean_text(url)
    if value.startswith("http://"):
        value = "https://" + value[len("http://"):]
    return re.sub(
        r"^https://podcasts\.apple\.com/us/",
        "https://podcasts.apple.com/" + storefront + "/",
        value,
        count=1,
    )


def youtube_id(url: str) -> str | None:
    parsed = urllib.parse.urlparse(url)
    host = host_of(url)
    if host == "youtu.be":
        part = parsed.path.strip("/").split("/")[0]
        return part or None
    if host == "youtube.com" or host.endswith(".youtube.com"):
        values = urllib.parse.parse_qs(parsed.query).get("v") or []
        return values[0] if values else None
    return None


class _TreeParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {"tag": "root", "attrs": {}, "children": []}
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = {"tag": tag.lower(), "attrs": dict(attrs), "children": []}
        self.stack[-1]["children"].append(node)
        if tag.lower() not in VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        tag = tag.lower()
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        if data:
            self.stack[-1]["children"].append(data)


def parse_tree(html: str):
    parser = _TreeParser()
    parser.feed(html)
    parser.close()
    return parser.root


def element_children(node):
    return [child for child in node.get("children", []) if isinstance(child, dict)]


def text_of(node) -> str:
    if isinstance(node, str):
        return node
    return "".join(text_of(child) for child in node.get("children", []))


def walk(node):
    yield node
    for child in element_children(node):
        yield from walk(child)


def has_tag(node, tag: str) -> bool:
    return any(item["tag"] == tag for item in walk(node) if item is not node)


def plain_strong_text(node) -> str:
    found = [item for item in walk(node) if item is not node and item["tag"] in {"strong", "b"}]
    for item in found:
        if not has_tag(item, "a"):
            return clean_text(text_of(item))
    return clean_text(text_of(found[0])) if found else ""


def first_element(node):
    for child in node.get("children", []):
        if isinstance(child, dict):
            return child
    return None


def links_and_text(node, skip_tags):
    texts = []
    links = []

    def visit(item, skipping):
        if isinstance(item, str):
            if not skipping:
                texts.append(item)
            return
        if item["tag"] == "a":
            href = item["attrs"].get("href") or ""
            if href:
                links.append({"url": href, "label": clean_text(text_of(item))})
            return
        child_skip = skipping or item["tag"] in skip_tags
        for child in item.get("children", []):
            visit(child, child_skip)

    visit(node, False)
    description = re.sub(r"^[\s\-–—:]+|[\s\-–—:]+$", "", clean_text(" ".join(texts))).strip()
    return description, links


def parse_podcasts(html: str) -> list[dict]:
    entries = []
    category = None
    for node in walk(parse_tree(html)):
        if node["tag"] == "h2":
            label = clean_text(text_of(node))
            if label == "Essentials":
                break
            category = label or None
            continue
        if node["tag"] != "p" or not category:
            continue
        title = plain_strong_text(node)
        if not title:
            continue
        description, links = links_and_text(node, {"strong", "b"})
        entries.append({"title": title, "category": category, "author": "", "description": description, "links": links})
    return entries


def parse_movies(html: str) -> list[dict]:
    entries = []
    category = None
    for node in walk(parse_tree(html)):
        if node["tag"] == "h2":
            label = clean_text(text_of(node))
            if label == "Essentials":
                break
            category = label[5:].strip() if label.startswith("Free ") else None
            continue
        if node["tag"] != "li" or not category:
            continue
        first = first_element(node)
        if not first or first["tag"] not in {"strong", "b"}:
            continue
        title = plain_strong_text(node)
        if not title or SKIP_TITLE_RE.search(title):
            continue
        description, links = links_and_text(node, {"strong", "b"})
        kept = [
            link for link in links
            if link["label"].lower().startswith("free") and "ebook" not in link["label"].lower()
        ]
        entries.append({"title": title, "category": category, "author": "", "description": description, "links": kept})
    return entries


def parse_audiobooks(html: str) -> list[dict]:
    entries = []
    for node in walk(parse_tree(html)):
        if node["tag"] != "li":
            continue
        first = first_element(node)
        if not first or first["tag"] != "strong":
            continue
        author = clean_text(text_of(first))
        description, links = links_and_text(node, {"strong", "b"})
        kept = [
            link for link in links
            if "ebook" not in link["label"].lower() and classify_url(link["url"], link["label"])
        ]
        if not author or not description:
            continue
        entries.append({"title": description, "category": "", "author": author, "description": "", "links": kept})
    return entries


def build_records(kind: str, entries: list[dict], storefront: str = "in") -> list[dict]:
    used = {}
    records = []
    for entry in entries:
        title = clean_text(entry.get("title"))
        if not title:
            continue
        ordered = []
        seen = set()
        for link in entry.get("links") or []:
            slug = classify_url(link.get("url") or "", link.get("label"))
            if not slug or slug in seen:
                continue
            url = normalize_url(link.get("url") or "", storefront)
            if not url.startswith("https://"):
                continue
            seen.add(slug)
            ordered.append((slug, url))
        if not ordered:
            continue
        base = "free:" + KIND_CODE[kind] + ":" + slugify(title)[:80]
        used[base] = used.get(base, 0) + 1
        record_id = base if used[base] == 1 else base + "-" + str(used[base])
        year = None
        year_match = YEAR_RE.search(title) or YEAR_RE.search(clean_text(entry.get("description")))
        if kind == "movie" and year_match:
            year = int(year_match.group(1))
        synopsis = clean_text(entry.get("description"))
        if kind == "audiobook":
            synopsis = "Audiobook by " + clean_text(entry.get("author")) + "."
            extra = clean_text(entry.get("description"))
            if extra:
                synopsis += " " + extra
        image = None
        for slug, url in ordered:
            if slug == "free_youtube":
                video = youtube_id(url)
                if video:
                    image = "https://i.ytimg.com/vi/" + video + "/hqdefault.jpg"
                break
        category = clean_text(entry.get("category"))
        genres = [] if kind == "audiobook" or not category else [category]
        record = {
            "id": record_id[:120],
            "t": title,
            "y": year,
            "k": kind,
            "rt": None,
            "s": synopsis,
            "im": None,
            "r": None,
            "p": [slug for slug, _url in ordered],
            "u": {slug: url for slug, url in ordered},
            "img": image,
            "l": "en",
            "g": genres,
            "v": 0,
        }
        records.append({key: record[key] for key in RECORD_KEYS})
    records.sort(key=lambda record: record["t"].casefold())
    return records


def fetch_html(url: str, timeout: float = 30.0) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", "replace")


def http_code(url: str, method: str, timeout: float) -> int | None:
    request = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if method == "GET":
                response.read(128)
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except Exception:
        return None


APPLE_LINK_RE = re.compile(r"^https://(podcasts|books|itunes)\.apple\.com/([a-z]{2})/", re.IGNORECASE)
COUNTRIES_RE = re.compile(r'"availableCountries"\s*:\s*(\[[^\[\]]*\])')
UNPLAYABLE_STATUS = {"UNPLAYABLE", "ERROR", "CONTENT_CHECK_REQUIRED"}


def localize_link(url: str, region: str) -> str:
    code = (region or "in").strip().lower()
    if not re.fullmatch(r"[a-z]{2}", code):
        return url

    def repl(match: re.Match[str]) -> str:
        return "https://" + match.group(1).lower() + ".apple.com/" + code + "/"

    return APPLE_LINK_RE.sub(repl, url, count=1)


def parse_youtube_availability(html: str) -> tuple[str | None, list[str]]:
    text = html or ""
    status = None
    marker = text.find('"playabilityStatus"')
    window = text[marker:marker + 800] if marker >= 0 else ""
    status_match = re.search(r'"status"\s*:\s*"([A-Z_]+)"', window)
    if status_match:
        status = status_match.group(1)
    countries: list[str] = []
    countries_match = COUNTRIES_RE.search(text)
    if countries_match:
        try:
            parsed = json.loads(countries_match.group(1))
        except json.JSONDecodeError:
            parsed = []
        if isinstance(parsed, list):
            countries = [code for code in parsed if isinstance(code, str) and re.fullmatch(r"[A-Z]{2}", code)]
    return status, countries


def youtube_decision(html: str) -> tuple[list[str], bool]:
    """Return (regions, drop). An empty region list means unknown, not blocked."""
    status, countries = parse_youtube_availability(html)
    if countries:
        return countries, False
    if status in UNPLAYABLE_STATUS:
        return [], True
    return [], False


def check_url(url: str, timeout: float = 10.0) -> str:
    code = http_code(url, "HEAD", timeout)
    if code is None or not 200 <= code <= 399:
        code = http_code(url, "GET", timeout)
    if code is None:
        return "unknown"
    if 200 <= code <= 399:
        return "ok"
    if code in {404, 410}:
        return "dead"
    if code in {401, 403, 451}:
        return "blocked"
    return "unknown"


def probe_link(slug: str, url: str) -> dict:
    if slug == "free_youtube":
        try:
            html = fetch_html(url, timeout=20)
        except Exception:
            return {"status": "unknown", "regions": []}
        regions, drop = youtube_decision(html)
        if drop:
            return {"status": "dead", "regions": []}
        return {"status": "ok", "regions": regions}
    status = check_url(url)
    checked = "IN" if status not in {"dead", "blocked"} else None
    return {"status": status, "regions": [], "checkedIn": checked}


def link_result(value) -> dict:
    if isinstance(value, str):
        return {
            "status": value,
            "regions": [],
            "checkedIn": None if value in {"dead", "blocked"} else "IN",
        }
    if isinstance(value, dict):
        return {
            "status": value.get("status") or "unknown",
            "regions": value.get("regions") if isinstance(value.get("regions"), list) else [],
            "checkedIn": value.get("checkedIn"),
        }
    return {"status": "unknown", "regions": [], "checkedIn": "IN"}


def probe_records(records, checker=None, workers: int = 8):
    checker = checker or probe_link
    jobs = []
    seen = set()
    for record in records:
        for slug in record["p"]:
            url = record["u"].get(slug)
            if isinstance(url, dict):
                url = url.get("url")
            if not url or (slug, url) in seen:
                continue
            seen.add((slug, url))
            jobs.append((slug, url))
    status = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(checker, slug, url): (slug, url) for slug, url in jobs}
        for future in as_completed(futures):
            key = futures[future]
            try:
                status[key] = link_result(future.result())
            except Exception:
                status[key] = {"status": "unknown", "regions": [], "checkedIn": "IN"}
    kept = []
    dropped_links = 0
    for record in records:
        providers = []
        urls = {}
        for slug in record["p"]:
            url = record["u"].get(slug)
            if isinstance(url, dict):
                url = url.get("url")
            result = status.get((slug, url)) or {"status": "unknown", "regions": [], "checkedIn": "IN"}
            if result["status"] in {"blocked", "dead"}:
                dropped_links += 1
                continue
            link = {"url": url, "regions": result.get("regions") or []}
            if result.get("checkedIn"):
                link["checkedIn"] = result["checkedIn"]
            providers.append(slug)
            urls[slug] = link
        if not providers:
            continue
        image = record["img"]
        if "free_youtube" not in providers and image and "i.ytimg.com" in image:
            image = None
        kept.append({**record, "p": providers, "u": urls, "img": image})
    stats = {
        "checked": len(jobs),
        "ok": sum(1 for value in status.values() if value.get("status") == "ok"),
        "dropped": dropped_links,
    }
    return kept, stats


PARSERS = {"podcast": parse_podcasts, "movie": parse_movies, "audiobook": parse_audiobooks}


def build_document(region: str, probe: bool, workers: int) -> dict:
    groups = []
    sources = []
    for source in SOURCES:
        html = fetch_html(source["url"])
        entries = PARSERS[source["kind"]](html)
        records = build_records(source["kind"], entries, region.lower())
        groups.append(records)
        sources.append({**source, "count": len(records)})
    records = [record for group in groups for record in group]
    probe_stats = {"checked": 0, "ok": 0, "dropped": 0}
    if probe:
        records, probe_stats = probe_records(records, workers=workers)
        counts = {}
        for record in records:
            counts[record["k"]] = counts.get(record["k"], 0) + 1
        for source in sources:
            source["count"] = counts.get(source["kind"], 0)
    return {
        "schema": 1,
        "meta": {
            "region": region,
            "built_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "sources": sources,
            "probe": probe_stats,
        },
        "records": records,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build the free-sources catalog from Open Culture")
    parser.add_argument("--region", default="IN")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--out", default="docs/assets/free-sources.json")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args(argv)
    document = build_document(args.region, args.probe, args.workers)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n")
    counts = {}
    for record in document["records"]:
        counts[record["k"]] = counts.get(record["k"], 0) + 1
    print("free sources:", ", ".join(kind + "=" + str(counts.get(kind, 0)) for kind in ("podcast", "movie", "audiobook")))
    print("probe:", document["meta"]["probe"])
    short = [kind for kind in ("podcast", "movie", "audiobook") if counts.get(kind, 0) < 100]
    if short:
        print("too few records:", ", ".join(short), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
