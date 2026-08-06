#!/usr/bin/env python3
"""Build docs/assets/catalog.json (schema 2) as the union of the enriched
TMDB sweep (catalog/catalog.db, region IN) and the existing schema-1
uNoGS + StreamingAvailability catalog (docs/assets/catalog.json).

Shapes and rules are frozen in CONTRACT.md; this script implements them
mechanically:

- ids: tmdb:m<id> / tmdb:t<id>; uNoGS-only Netflix leftovers keep netflix:<id>.
  Unmatched uNoGS records from other providers cannot be emitted (id grammar)
  and are skipped + counted; >2% of the uNoGS side aborts the build.
- Dedup key: imdb_id when both sides have it, else (normalized title, year).
  TMDB wins conflicts; matched uNoGS records contribute the Netflix deep link
  (imdb_id joins only) and provider slugs the TMDB side lacks.
- Providers: TMDB ids map through the curated 26-slug table; anything else
  is dropped. Watch URLs per CONTRACT.md templates / TMDB fallback.
- Genres: id->name maps fetched from the TMDB API at build time using the
  same token mechanism as catalog/catalog.py.

Run: ~/pyenv/tmdb-catalog/bin/python scripts/build_catalog_tmdb.py
"""

import gzip
import json
import re
import sqlite3
import subprocess
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "catalog"))
from catalog import acquire_lock, get_token, release_lock  # noqa: E402

DB_PATH = ROOT / "catalog" / "catalog.db"
OLD_CATALOG = ROOT / "docs" / "assets" / "catalog.json"
OUT_CATALOG = ROOT / "docs" / "assets" / "catalog.json"
OUT_TEXT = ROOT / "docs" / "assets" / "catalog.text.json"
OUT_META = ROOT / "docs" / "assets" / "catalog.meta.json"

TMDB_BASE = "https://api.themoviedb.org/3"
IMG_BASE = "https://image.tmdb.org/t/p/w185"

# Curated provider registry (CONTRACT.md): slug -> (label, merged TMDB ids,
# watch URL template or None for TMDB_FALLBACK). {q} = URL-encoded title.
PROVIDERS = {
    "netflix": ("Netflix", {8, 175}, "https://www.netflix.com/search?q={q}"),
    "prime": ("Prime Video", {119, 10, 2100}, "https://www.primevideo.com/search?phrase={q}"),
    "hotstar": ("JioHotstar", {2336, 122}, "https://www.hotstar.com/in/search?q={q}"),
    "zee5": ("ZEE5", {232}, "https://www.zee5.com/search?q={q}"),
    "sonyliv": ("SonyLIV", {237}, "https://www.sonyliv.com/search?searchTerm={q}"),
    "mubi": ("MUBI", {11, 201}, "https://mubi.com/en/in/search/films?query={q}"),
    "crunchyroll": ("Crunchyroll", {283, 1968}, "https://www.crunchyroll.com/search?q={q}"),
    "sunnxt": ("Sun NXT", {309}, None),
    "mxplayer": ("MX Player", {515, 1898}, None),
    "discovery": ("Discovery+", {510, 584}, None),
    "shemaroo": ("ShemarooMe", {474}, None),
    "lionsgate": ("Lionsgate Play", {561, 2074, 2053}, None),
    "manoramamax": ("ManoramaMAX", {482, 2177}, None),
    "hungama": ("Hungama Play", {437}, None),
    "hoichoi": ("Hoichoi", {315, 2176}, None),
    "aha": ("aha", {532}, None),
    "curiosity": ("CuriosityStream", {190, 603}, None),
    "appletv": ("Apple TV+", {350}, None),
    "epicon": ("EPIC ON", {476}, None),
    "tataplay": ("Tata Play", {502}, None),
    "plex": ("Plex", {538}, None),
    "tubi": ("Tubi", {73}, None),
    "docubay": ("DocuBay", {604}, None),
    "bbcplayer": ("BBC Player", {285}, None),
    "chaupal": ("Chaupal", {2178}, None),
    "erosnow": ("Eros Now", {2059}, None),
}
TMDB_TO_SLUG = {pid: slug for slug, (_, pids, _) in PROVIDERS.items() for pid in pids}

# Schema-1 uNoGS slugs that differ from the curated slug spelling.
OLD_SLUG_MAP = {"apple": "appletv"}

SKIP_FRACTION_LIMIT = 0.02
GZIP_LIMIT = 2_000_000

NETFLIX_DEEP_RE = re.compile(r"^https://www\.netflix\.com/title/\d+")
NETFLIX_SEARCH_PREFIX = "https://www.netflix.com/search?q="


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def norm_title(t):
    t = unicodedata.normalize("NFKD", t or "").lower()
    return " ".join("".join(c for c in t if c.isalnum() or c.isspace()).split())


def norm_title_js(t):
    """Mirror docs/js/catalog.js normalizeTitle (the dedup key the data
    stress checker uses): NFKD, strip combining marks, lowercase, every
    non-[a-z0-9] run becomes one space. CJK/Cyrillic-only titles normalize
    to "" and must be skipped by callers."""
    t = unicodedata.normalize("NFKD", t or "")
    t = "".join(c for c in t if not 0x0300 <= ord(c) <= 0x036F)
    return " ".join(re.sub(r"[^a-z0-9]+", " ", t.lower()).split())


def clamp_year(value):
    try:
        y = int(value)
    except (TypeError, ValueError):
        return None
    return y if 1900 <= y <= 2100 else None


def clamp_runtime(value):
    try:
        rt = int(value)
    except (TypeError, ValueError):
        return None
    return rt if 1 <= rt <= 600 else None


def clamp_rating(value):
    try:
        r = float(value)
    except (TypeError, ValueError):
        return None
    return r if 0 < r <= 10 else None


def tmdb_get(path, token, retries=10):
    """GET TMDB_BASE + path via curl -6 (api.themoviedb.org resets IPv4 and
    this Python TLS stack on this network; curl -6 is verified working).
    The token only ever lives inside the subprocess argv; failures are
    reported as bare exit codes so it can never leak into output."""
    url = TMDB_BASE + path
    for attempt in range(retries):
        proc = subprocess.run(
            ["curl", "-6", "-sS", "--fail", "--max-time", "30",
             url, "-H", f"Authorization: Bearer {token}"],
            capture_output=True, text=True)
        if proc.returncode == 0:
            try:
                return json.loads(proc.stdout)
            except json.JSONDecodeError:
                return None
        time.sleep(1.0 + attempt)
    log(f"warn: GET {path} failed after {retries} attempts")
    return None


def fetch_genre_maps():
    """id->name from /genre/movie/list and /genre/tv/list, fetched at build
    time with the same token mechanism as catalog/catalog.py."""
    token = get_token()
    genre_map = {}
    for media_type in ("movie", "tv"):
        data = tmdb_get(f"/genre/{media_type}/list", token)
        if data is None:
            sys.exit(f"genre fetch failed for {media_type}")
        for g in data.get("genres") or []:
            genre_map[g["id"]] = g["name"]
    log(f"fetched {len(genre_map)} genre names from TMDB API")
    return genre_map


def load_tmdb(genre_map):
    """TMDB side: one record per title with >= 1 curated provider."""
    conn = sqlite3.connect(DB_PATH)
    titles = conn.execute(
        """SELECT tmdb_id, media_type, name, original_language, release_date,
                  genre_ids, overview, poster_path, vote_average, vote_count,
                  imdb_id, runtime
           FROM title"""
    ).fetchall()
    availability = conn.execute(
        "SELECT DISTINCT tmdb_id, media_type, provider_id FROM availability"
    ).fetchall()
    priorities = dict(conn.execute(
        "SELECT provider_id, display_priority FROM provider").fetchall())
    conn.close()

    slug_by_title = {}
    for tmdb_id, media_type, provider_id in availability:
        slug = TMDB_TO_SLUG.get(provider_id)
        if slug is not None:
            slug_by_title.setdefault((tmdb_id, media_type), set()).add(slug)

    records = {}
    no_provider = 0
    for (tmdb_id, media_type, name, lang, release_date, genre_ids, overview,
         poster_path, vote_average, vote_count, imdb_id, runtime) in titles:
        slugs = slug_by_title.get((tmdb_id, media_type), set())
        if not slugs:
            # Provider-less titles still participate in imdb/title matching:
            # a matched uNoGS record can contribute the provider slugs the
            # TMDB side lacks (CONTRACT.md merge rule). Records whose merged
            # p is still empty are dropped at emit time.
            no_provider += 1
        year = None
        if release_date and len(release_date) >= 4:
            year = clamp_year(release_date[:4])
        try:
            gids = json.loads(genre_ids or "[]")
        except json.JSONDecodeError:
            gids = []
        votes = max(int(vote_count or 0), 0)
        rec = {
            "id": f"tmdb:{'m' if media_type == 'movie' else 't'}{tmdb_id}",
            "tmdb_id": tmdb_id,
            "media_type": media_type,
            "t": name or "",
            "y": year,
            "k": "movie" if media_type == "movie" else "series",
            "rt": clamp_runtime(runtime),
            "im": imdb_id if isinstance(imdb_id, str)
                  and imdb_id.startswith("tt") else None,
            "r": clamp_rating(vote_average) if vote_count else None,
            "p": slugs,
            # Sparse posters (CONTRACT.md): ship img only when v >= 10.
            "img": IMG_BASE + poster_path if poster_path and votes >= 10 else None,
            # TMDB emits two non-ISO-639-1 codes: "cn" (Cantonese; ISO-639-1
            # macrolanguage is "zh") and "xx" (No Language; null per CONTRACT).
            "l": {"cn": "zh", "xx": None}.get(lang, lang) if lang else None,
            "g": [genre_map[g] for g in gids if g in genre_map],
            "v": votes,
            "synopsis": (overview or "").strip(),
            "netflix_deep": None,
        }
        records[rec["id"]] = rec
    log(f"tmdb: {len(titles)} titles ({no_provider} with no curated "
        f"provider), {len(records)} matchable")
    return records, priorities


def watch_url(slug, rec):
    if slug == "netflix" and rec.get("netflix_deep"):
        return rec["netflix_deep"]
    template = PROVIDERS[slug][2]
    if template is not None:
        return template.replace("{q}", quote(rec["t"], safe=""))
    return (f"https://www.themoviedb.org/{rec['media_type']}/"
            f"{rec['tmdb_id']}/watch?locale=IN")


def provider_rank(slugs_present, priorities):
    """Slugs ordered by India display_priority ascending (min over the slug's
    merged TMDB ids), ties alphabetical by label."""
    def key(slug):
        label, pids, _ = PROVIDERS[slug]
        prio = min((priorities.get(pid, 1 << 30) for pid in pids), default=1 << 30)
        return (prio, label)
    return sorted(slugs_present, key=key)


def dedupe_records(records, texts, rank):
    """Final dedupe pass (CONTRACT.md dedup mandate): collapse groups of
    emitted records sharing (normalizeTitle(t), y, k) with distinct ids —
    genuine TMDB source duplicates plus noisy uNoGS leftover pairs.

    Keeper: highest v; ties break tmdb: id over netflix: id, then
    lexicographically smallest id. Before dropping a record, preserve a
    Netflix deep link when the keeper only has the search template (or no
    netflix url), and merge any curated provider slug+url the keeper
    lacks. Records whose title normalizes to "" are skipped (empty keys
    carry no title information)."""
    groups = {}
    for i, r in enumerate(records):
        nt = norm_title_js(r["t"])
        if nt:
            groups.setdefault((nt, r["y"], r["k"]), []).append(i)

    def keeper_key(i):
        r = records[i]
        return (-r["v"], 0 if r["id"].startswith("tmdb:") else 1, r["id"])

    dropped_idx = set()
    n_groups = n_deep = n_slugs = n_syn = 0
    for key, idxs in groups.items():
        if len(idxs) < 2:
            continue
        n_groups += 1
        keeper = records[min(idxs, key=keeper_key)]
        for i in idxs:
            rec = records[i]
            if rec is keeper:
                continue
            dropped_idx.add(i)
            du = rec.get("u") or {}
            ku = keeper["u"]
            deep = du.get("netflix")
            if (isinstance(deep, str) and NETFLIX_DEEP_RE.match(deep)
                    and ("netflix" not in ku
                         or ku["netflix"].startswith(NETFLIX_SEARCH_PREFIX))):
                ku["netflix"] = deep
                n_deep += 1
            for slug, url in du.items():
                if (slug in PROVIDERS and slug not in keeper["p"]
                        and isinstance(url, str) and url.startswith("http")):
                    keeper["p"].append(slug)
                    ku[slug] = url
                    n_slugs += 1
            keeper["p"].sort(key=lambda s: rank[s])
            if rec["id"] in texts:
                if keeper["id"] not in texts:
                    texts[keeper["id"]] = texts[rec["id"]]
                    n_syn += 1
                del texts[rec["id"]]

    kept = [r for i, r in enumerate(records) if i not in dropped_idx]
    log(f"dedupe-final: {n_groups} near-duplicate groups, "
        f"{len(dropped_idx)} records dropped, {n_deep} netflix deep links "
        f"preserved, {n_slugs} provider slugs merged, {n_syn} synopses moved")
    return kept, texts


def main():
    genre_map = fetch_genre_maps()
    tmdb_records, priorities = load_tmdb(genre_map)

    by_imdb = {r["im"]: r for r in tmdb_records.values() if r["im"]}
    by_title_year = {}
    for r in tmdb_records.values():
        if r["y"] is not None:
            by_title_year.setdefault((norm_title(r["t"]), r["y"]), r)

    old = json.loads(OLD_CATALOG.read_text(encoding="utf-8"))
    old_records = old["records"] if isinstance(old, dict) else old
    log(f"unogs side: {len(old_records)} records")

    matched_imdb = matched_ty = 0
    skipped_other = []
    leftovers = {}
    for rec in old_records:
        im = rec.get("im") if isinstance(rec.get("im"), str) else None
        target = None
        via_imdb = False
        if im and im in by_imdb:
            target = by_imdb[im]
            via_imdb = True
        else:
            key = (norm_title(rec.get("t")), clamp_year(rec.get("y")))
            if key[0] and key[1] is not None:
                target = by_title_year.get(key)
        if target is not None:
            if via_imdb:
                matched_imdb += 1
            else:
                matched_ty += 1
            if via_imdb and rec["id"].startswith("netflix:"):
                nid = rec["id"].split(":", 1)[1]
                if nid.isdigit():
                    target["netflix_deep"] = f"https://www.netflix.com/title/{nid}"
            for slug in rec.get("p") or []:
                slug = OLD_SLUG_MAP.get(slug, slug)
                if slug in PROVIDERS:
                    target["p"].add(slug)
            if not target["synopsis"] and rec.get("s"):
                target["synopsis"] = rec["s"].strip()
            continue
        if rec["id"].startswith("netflix:") and rec["id"].split(":", 1)[1].isdigit():
            if rec["id"] in leftovers:
                continue
            slugs = []
            for slug in rec.get("p") or []:
                slug = OLD_SLUG_MAP.get(slug, slug)
                if slug in PROVIDERS and slug not in slugs:
                    slugs.append(slug)
            if "netflix" not in slugs:
                slugs.insert(0, "netflix")
            nid = rec["id"].split(":", 1)[1]
            deep = f"https://www.netflix.com/title/{nid}"
            urls = {}
            old_u = rec.get("u") or {}
            for slug in slugs:
                if slug == "netflix":
                    urls[slug] = old_u.get("netflix") or deep
                else:
                    template = PROVIDERS[slug][2]
                    if template is not None:
                        urls[slug] = template.replace(
                            "{q}", quote(rec.get("t") or "", safe=""))
            leftovers[rec["id"]] = {
                "id": rec["id"],
                "t": rec.get("t") or "",
                "y": clamp_year(rec.get("y")),
                "k": rec.get("k") if rec.get("k") in ("movie", "series") else "movie",
                "rt": clamp_runtime(rec.get("rt")),
                "im": im if im and im.startswith("tt") else None,
                "r": clamp_rating(rec.get("r")),
                "p": slugs,
                "u": {k: v for k, v in urls.items()
                      if isinstance(v, str) and v.startswith("http")},
                # Leftovers ship v = 0, so sparse posters force img null.
                "img": None,
                "synopsis": (rec.get("s") or "").strip(),
            }
        else:
            skipped_other.append(rec["id"])

    log(f"dedup: {matched_imdb} matched by imdb_id, {matched_ty} by "
        f"(title, year), {len(leftovers)} netflix leftovers, "
        f"{len(skipped_other)} non-netflix unmatched skipped")
    if len(skipped_other) > SKIP_FRACTION_LIMIT * len(old_records):
        sys.exit(
            f"STOP: {len(skipped_other)} unmatched non-netflix uNoGS records "
            f"exceeds 2% of the uNoGS side ({len(old_records)}). "
            f"Sample: {skipped_other[:10]}")

    emitted_tmdb = [r for r in tmdb_records.values() if r["p"]]
    dropped_empty = len(tmdb_records) - len(emitted_tmdb)
    log(f"emit: {len(emitted_tmdb)} tmdb records with non-empty merged "
        f"providers ({dropped_empty} provider-less dropped)")

    order = provider_rank(
        {s for r in emitted_tmdb for s in r["p"]} |
        {s for r in leftovers.values() for s in r["p"]},
        priorities)
    rank = {slug: i for i, slug in enumerate(order)}

    records = []
    texts = {}
    for r in emitted_tmdb:
        p = sorted(r["p"], key=lambda s: rank[s])
        records.append({
            "id": r["id"], "t": r["t"], "y": r["y"], "k": r["k"],
            "rt": r["rt"], "s": "", "im": r["im"], "r": r["r"], "p": p,
            "u": {slug: watch_url(slug, r) for slug in p},
            "img": r["img"], "l": r["l"], "g": r["g"], "v": r["v"],
        })
        if r["synopsis"]:
            texts[r["id"]] = r["synopsis"]
    for r in leftovers.values():
        p = sorted(r["p"], key=lambda s: rank[s])
        records.append({
            "id": r["id"], "t": r["t"], "y": r["y"], "k": r["k"],
            "rt": r["rt"], "s": "", "im": r["im"], "r": r["r"], "p": p,
            "u": {slug: r["u"][slug] for slug in p if slug in r["u"]},
            "img": r["img"], "l": None, "g": [], "v": 0,
        })
        if r["synopsis"]:
            texts[r["id"]] = r["synopsis"]

    records, texts = dedupe_records(records, texts, rank)

    # Order is not contract-fixed; clustering identical provider sets keeps
    # repeated p/u byte patterns inside gzip's 32KB window.
    records.sort(key=lambda r: (tuple(r["p"]), r["id"]))

    meta = {
        "region": "IN",
        "source": "tmdb",
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(records),
        "providers": sorted(order),
        "provider_order": order,
        "languages": sorted({r["l"] for r in records if r["l"]}),
        "genres": sorted({g for r in records for g in r["g"]}),
        "text_file": "catalog.text.json",
        "filters": {"min_year": None, "min_rating": None, "limit": None},
    }

    meta_str = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
    records_str = json.dumps(records, ensure_ascii=False, separators=(",", ":"))
    payload = '{"schema":2,"meta":' + meta_str + ',"records":' + records_str + '}'
    text_payload = json.dumps(
        {"schema": 2, "count": len(texts), "s": texts},
        ensure_ascii=False, separators=(",", ":"))

    gz = len(gzip.compress(payload.encode("utf-8")))
    log(f"payload: {len(payload.encode('utf-8'))} bytes raw, {gz} gzipped, "
        f"{len(texts)} synopses")
    if gz >= GZIP_LIMIT:
        sys.exit(f"STOP: gzipped catalog.json is {gz} bytes, over the "
                 f"{GZIP_LIMIT} limit")

    OUT_CATALOG.write_text(payload, encoding="utf-8")
    OUT_TEXT.write_text(text_payload, encoding="utf-8")
    OUT_META.write_text(meta_str, encoding="utf-8")

    n_lang = sum(1 for r in records if r["l"])
    n_genre = sum(1 for r in records if r["g"])
    n_img = sum(1 for r in records if r["img"])
    print(f"posters: {n_img} with img, {len(records) - n_img} fallback "
          f"(v<10 or no poster_path)")
    print(f"records: {len(records)} after final dedupe "
          f"(pre-dedupe: tmdb {len(emitted_tmdb)}, "
          f"netflix leftovers {len(leftovers)})")
    print(f"sources: tmdb {len(emitted_tmdb)} emitted "
          f"({dropped_empty} provider-less dropped) | unogs {len(old_records)} "
          f"(matched imdb {matched_imdb}, title/year {matched_ty}, "
          f"skipped non-netflix {len(skipped_other)})")
    print(f"dedup: {len(old_records) - matched_imdb - matched_ty - len(leftovers) - len(skipped_other)} duplicate unogs ids collapsed")
    print(f"coverage: l non-null {n_lang}/{len(records)} "
          f"({100 * n_lang / len(records):.2f}%), g non-empty "
          f"{n_genre}/{len(records)} ({100 * n_genre / len(records):.2f}%)")
    print(f"gzip: {gz} bytes (limit {GZIP_LIMIT})")
    print(f"providers ({len(order)}): {order}")


def find_unmatched_non_netflix(tmdb_records, old_records):
    """uNoGS records that match no kept TMDB record and whose id is not
    netflix:<n> — exactly the set the builder would have to skip."""
    by_imdb = {r["im"]: r for r in tmdb_records.values() if r["im"]}
    by_title_year = {}
    for r in tmdb_records.values():
        if r["y"] is not None:
            by_title_year.setdefault((norm_title(r["t"]), r["y"]), r)
    unmatched = []
    for rec in old_records:
        im = rec.get("im") if isinstance(rec.get("im"), str) else None
        if im and im in by_imdb:
            continue
        key = (norm_title(rec.get("t")), clamp_year(rec.get("y")))
        if key[0] and key[1] is not None and key in by_title_year:
            continue
        if not (rec["id"].startswith("netflix:")
                and rec["id"].split(":", 1)[1].isdigit()):
            unmatched.append(rec)
    return unmatched


def backfill():
    """Resolve unmatched non-Netflix uNoGS records through TMDB
    /find/{imdb_id} and insert title + availability rows into catalog.db
    using catalog.py's conventions, so the next build matches them honestly
    instead of skipping them."""
    token = get_token()
    tmdb_records, _ = load_tmdb({})
    old = json.loads(OLD_CATALOG.read_text(encoding="utf-8"))
    old_records = old["records"] if isinstance(old, dict) else old
    unmatched = find_unmatched_non_netflix(tmdb_records, old_records)
    log(f"backfill: {len(unmatched)} unmatched non-netflix uNoGS records")

    conn = sqlite3.connect(DB_PATH)
    existing_imdbs = {r[0] for r in conn.execute(
        "SELECT imdb_id FROM title WHERE imdb_id IS NOT NULL")}
    conn.close()
    already = sum(1 for rec in unmatched if rec.get("im") in existing_imdbs)
    pending = [rec for rec in unmatched if rec.get("im") not in existing_imdbs]
    log(f"backfill: {already} already in title table (no curated IN "
        f"providers), fetching {len(pending)}")

    def resolve(rec):
        im = rec.get("im")
        if not (isinstance(im, str) and im.startswith("tt")):
            return im, None, "no imdb id"
        found = tmdb_get(f"/find/{im}?external_source=imdb_id", token)
        if found is None:
            return im, None, "find failed"
        for media_type, key in (("movie", "movie_results"), ("tv", "tv_results")):
            results = found.get(key) or []
            if results:
                tmdb_id = results[0]["id"]
                detail = tmdb_get(
                    f"/{media_type}/{tmdb_id}?append_to_response=external_ids",
                    token)
                providers = tmdb_get(f"/{media_type}/{tmdb_id}/watch/providers",
                                     token)
                if detail is None or providers is None:
                    return im, None, "detail/providers fetch failed"
                return im, (media_type, tmdb_id, detail, providers), None
        return im, None, "not found on TMDB"

    resolved, unresolvable = [], []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for im, payload, reason in pool.map(resolve, pending):
            if payload is None:
                unresolvable.append((im, reason))
            else:
                resolved.append(payload)
    log(f"backfill: resolved {len(resolved)}, unresolvable "
        f"{len(unresolvable)}")

    run_date = date.today().isoformat()
    lock_path = acquire_lock(str(DB_PATH))
    inserted_titles = inserted_avail = 0
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=30000")
        for media_type, tmdb_id, d, providers in resolved:
            name = d.get("title") or d.get("name")
            original_name = d.get("original_title") or d.get("original_name")
            release_date = d.get("release_date") or d.get("first_air_date") or None
            genre_ids = [g["id"] for g in d.get("genres") or []]
            imdb_id = (d.get("external_ids") or {}).get("imdb_id")
            if media_type == "movie":
                runtime = d.get("runtime")
            else:
                ert = d.get("episode_run_time") or []
                runtime = ert[0] if ert else None
            conn.execute(
                """INSERT INTO title (tmdb_id, media_type, name, original_name,
                                      original_language, release_date, genre_ids,
                                      overview, poster_path, popularity,
                                      vote_average, vote_count, imdb_id, runtime)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(tmdb_id, media_type) DO UPDATE SET
                       name=excluded.name,
                       original_name=excluded.original_name,
                       original_language=excluded.original_language,
                       release_date=excluded.release_date,
                       genre_ids=excluded.genre_ids,
                       overview=excluded.overview,
                       poster_path=excluded.poster_path,
                       popularity=excluded.popularity,
                       vote_average=excluded.vote_average,
                       vote_count=excluded.vote_count,
                       imdb_id=COALESCE(excluded.imdb_id, title.imdb_id),
                       runtime=COALESCE(excluded.runtime, title.runtime)""",
                (tmdb_id, media_type, name, original_name,
                 d.get("original_language"), release_date, json.dumps(genre_ids),
                 d.get("overview"), d.get("poster_path"), d.get("popularity"),
                 d.get("vote_average"), d.get("vote_count"), imdb_id, runtime),
            )
            inserted_titles += 1
            in_offers = ((providers.get("results") or {}).get("IN") or {})
            for offer in in_offers.get("flatrate") or []:
                conn.execute(
                    """INSERT INTO availability (tmdb_id, media_type, provider_id,
                                                 monetization, first_seen, last_seen)
                       VALUES (?, ?, ?, 'flatrate', ?, ?)
                       ON CONFLICT(tmdb_id, media_type, provider_id, monetization)
                       DO UPDATE SET last_seen=excluded.last_seen""",
                    (tmdb_id, media_type, offer["provider_id"], run_date, run_date),
                )
                inserted_avail += 1
        conn.commit()
        conn.close()
    finally:
        release_lock(lock_path)

    print(f"backfilled: {inserted_titles} titles, {inserted_avail} "
          f"availability rows (run_date {run_date})")
    print(f"unresolvable: {len(unresolvable)}")
    for im, reason in unresolvable:
        print(f"  {im}: {reason}")


if __name__ == "__main__":
    if "--backfill" in sys.argv:
        backfill()
    else:
        main()
