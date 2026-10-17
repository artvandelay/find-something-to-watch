// Single source of truth for curated provider labels, common language labels,
// link classification, and display projection. DOM-free and import-free.

export const PROVIDER_LABELS = Object.freeze({
  netflix: "Netflix",
  prime: "Prime Video",
  hotstar: "JioHotstar",
  zee5: "ZEE5",
  sonyliv: "SonyLIV",
  mubi: "MUBI",
  crunchyroll: "Crunchyroll",
  sunnxt: "Sun NXT",
  mxplayer: "MX Player",
  discovery: "Discovery+",
  shemaroo: "ShemarooMe",
  lionsgate: "Lionsgate Play",
  manoramamax: "ManoramaMAX",
  hungama: "Hungama Play",
  hoichoi: "Hoichoi",
  aha: "aha",
  curiosity: "CuriosityStream",
  appletv: "Apple TV+",
  epicon: "EPIC ON",
  tataplay: "Tata Play",
  plex: "Plex",
  tubi: "Tubi",
  docubay: "DocuBay",
  bbcplayer: "BBC Player",
  chaupal: "Chaupal",
  erosnow: "Eros Now"
});

export const PROVIDER_SLUGS = Object.freeze(Object.keys(PROVIDER_LABELS));

export const REGIONS = Object.freeze(["IN", "US", "GB", "CA", "AU", "SG", "AE"]);
export const DEFAULT_REGION = "IN";
export const REGION_LABELS = Object.freeze({
  IN: "India",
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  SG: "Singapore",
  AE: "United Arab Emirates"
});

// Fallback India display order used until catalog.json metadata is loaded.
export const DEFAULT_PROVIDER_ORDER = Object.freeze([
  "netflix", "prime", "appletv", "zee5", "hotstar", "sunnxt", "plex", "mubi",
  "curiosity", "aha", "sonyliv", "crunchyroll", "hungama", "hoichoi", "epicon",
  "shemaroo", "tataplay", "discovery", "manoramamax", "mxplayer", "lionsgate",
  "chaupal", "bbcplayer", "docubay", "erosnow", "tubi"
]);

// The catalog snapshot is watch_region=IN. meta.provider_order lists slugs that
// have titles in that snapshot. There is no per-country availability table.
// These named lists are a display offer: a slug is shown only when it is named
// for the viewer's region and it also appears in the catalog order. Services
// absent from the catalog (Hulu, Max, Disney+) are not added. India-only
// platforms are named only under IN. Netflix, Prime Video, Apple TV+, MUBI,
// Crunchyroll, Discovery+, CuriosityStream, Plex, and Tubi are the same product
// in other regions and already have titles in the snapshot, so they may be
// named there. That does not mean the India snapshot proves a title is on that
// service outside India. IN's "more" set is the rest of the catalog order.
const REGION_SUBSCRIPTION_OFFERS = Object.freeze({
  IN: {
    primary: ["netflix", "prime", "hotstar", "zee5", "sonyliv", "appletv"],
    more: null
  },
  US: {
    primary: ["netflix", "prime", "appletv", "mubi", "crunchyroll", "discovery"],
    more: ["curiosity", "plex", "tubi"]
  },
  GB: {
    primary: ["netflix", "prime", "appletv", "mubi", "crunchyroll", "discovery"],
    more: ["curiosity"]
  },
  CA: {
    primary: ["netflix", "prime", "appletv", "mubi", "crunchyroll", "discovery"],
    more: ["curiosity", "tubi"]
  },
  AU: {
    primary: ["netflix", "prime", "appletv", "mubi", "crunchyroll", "discovery"],
    more: ["curiosity"]
  },
  SG: {
    primary: ["netflix", "prime", "appletv", "mubi", "crunchyroll"],
    more: []
  },
  AE: {
    primary: ["netflix", "prime", "appletv", "mubi", "crunchyroll"],
    more: []
  }
});

function isKnownProvider(slug) {
  return typeof slug === "string" && Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, slug);
}

/**
 * Short subscription checklist for a region.
 * Already-selected slugs stay in `visible` even when the region would hide them.
 * `more` is the rest of that country only, and stays behind a closed disclosure.
 */
export function subscriptionOffer({ region, catalogOrder, selected = [] } = {}) {
  const raw = String(region || DEFAULT_REGION).trim().toUpperCase();
  const code = REGIONS.includes(raw) ? raw : DEFAULT_REGION;
  const source = Array.isArray(catalogOrder) && catalogOrder.length > 0
    ? catalogOrder
    : DEFAULT_PROVIDER_ORDER;
  const catalog = [];
  const inCatalog = new Set();
  for (const slug of source) {
    if (!isKnownProvider(slug) || inCatalog.has(slug)) continue;
    catalog.push(slug);
    inCatalog.add(slug);
  }
  const named = REGION_SUBSCRIPTION_OFFERS[code];
  const primary = named.primary.filter((slug) => inCatalog.has(slug));
  const primarySet = new Set(primary);
  const moreSource = named.more == null ? catalog : named.more;
  const more = [];
  const seenMore = new Set();
  for (const slug of moreSource) {
    if (!inCatalog.has(slug) || primarySet.has(slug) || seenMore.has(slug)) continue;
    more.push(slug);
    seenMore.add(slug);
  }
  const visible = primary.slice();
  const visibleSet = new Set(visible);
  for (const slug of Array.isArray(selected) ? selected : []) {
    if (!isKnownProvider(slug) || visibleSet.has(slug)) continue;
    visible.push(slug);
    visibleSet.add(slug);
  }
  return {
    region: code,
    visible,
    more: more.filter((slug) => !visibleSet.has(slug)),
    moreLabel: code === "IN" ? "More in India" : "More in this country"
  };
}

export const LANGUAGE_NAMES = Object.freeze({
  en: "English", hi: "Hindi", ta: "Tamil", te: "Telugu", ml: "Malayalam",
  kn: "Kannada", bn: "Bengali", mr: "Marathi", pa: "Punjabi", gu: "Gujarati",
  ur: "Urdu", as: "Assamese", or: "Odia", sa: "Sanskrit", ne: "Nepali",
  si: "Sinhala", bh: "Bhojpuri", ja: "Japanese", ko: "Korean", zh: "Chinese",
  fr: "French", de: "German", es: "Spanish", it: "Italian", pt: "Portuguese",
  ru: "Russian", ar: "Arabic", th: "Thai", id: "Indonesian", tr: "Turkish"
});

export function providerLabel(slug) {
  const s = String(slug || "");
  if (!s) return "Watch";
  return PROVIDER_LABELS[s] || FREE_PROVIDER_LABELS[s] || s;
}

export function languageLabel(code) {
  const c = String(code || "");
  return LANGUAGE_NAMES[c] || c;
}

const TMDB_FALLBACK_RE = /themoviedb\.org\/(?:movie|tv)\/\d+\/watch/i;
const NETFLIX_TITLE_RE = /netflix\.com\/title\//i;

/**
 * Classifies a provider watch URL into one of the three link kinds documented
 * in CONTRACT.md's Provider registry: a true per-title deep link ("direct"),
 * a provider search-results template ("search"), or the shared TMDB watch
 * page that lists real providers itself ("fallback"). Returns null for a
 * missing/empty url.
 */
export function linkKind(slug, url) {
  const u = String(url || "");
  if (!u) return null;
  if (isFreeSlug(slug)) return "direct";
  if (TMDB_FALLBACK_RE.test(u)) return "fallback";
  if (slug === "netflix" && NETFLIX_TITLE_RE.test(u)) return "direct";
  return "search";
}

/** Call-to-action text that matches the link kind instead of implying every link plays directly. */
export function watchCta(slug, url) {
  if (isFreeSlug(slug) && url) return FREE_CTA[slug] || "Open";
  const label = providerLabel(slug);
  const kind = linkKind(slug, url);
  if (kind === "direct") return "Watch on " + label;
  if (kind === "fallback") return "See where to watch (TMDB)";
  if (kind === "search") return "Find on " + label;
  return "Watch on " + label;
}

// Catalog snapshots store https://www.hotstar.com/in/search?q={title}.
// JioHotstar ignores `q` and lands on an empty /in/search bar. Its own search
// uses `search_query`. The catalog has no Hotstar content id, so this stays
// a search URL rather than a title page.
const HOTSTAR_Q_SEARCH = /^https:\/\/www\.hotstar\.com\/in\/search\?q=([^#]*)$/i;

export function providerHref(slug, url) {
  const value = String(url || "");
  if (slug !== "hotstar") return value;
  const match = HOTSTAR_Q_SEARCH.exec(value);
  if (!match) return value;
  return "https://www.hotstar.com/in/search?search_query=" + match[1];
}

/**
 * Returns a shallow copy of a catalog record (or pick) whose `p` and `u`
 * fields are restricted to the given set of subscribed provider slugs. Used
 * everywhere a title is displayed or handed to the agent, so a viewer never
 * sees a provider or watch link outside their selected subscriptions.
 */
export function intersectProviders(rec, allowed) {
  if (!rec || !allowed) return rec;
  const set = allowed instanceof Set ? allowed : new Set(allowed);
  const p = Array.isArray(rec.p) ? rec.p.filter((slug) => set.has(slug)) : [];
  const u = {};
  if (rec.u && typeof rec.u === "object") {
    for (const slug of Object.keys(rec.u)) {
      if (set.has(slug)) u[slug] = rec.u[slug];
    }
  }
  return { ...rec, p, u };
}

export const FREE_PROVIDER_LABELS = Object.freeze({
  free_apple: "Apple Podcasts",
  free_spotify: "Spotify",
  free_librivox: "LibriVox",
  free_rss: "RSS feed",
  free_youtube: "YouTube",
  free_vimeo: "Vimeo",
  free_archive: "Internet Archive",
  free_openculture: "Open Culture",
  free_web: "Official site"
});

export const FREE_PROVIDER_SLUGS = Object.freeze(Object.keys(FREE_PROVIDER_LABELS));

const FREE_CTA = Object.freeze({
  free_apple: "Listen on Apple Podcasts",
  free_spotify: "Listen on Spotify",
  free_librivox: "Listen on LibriVox",
  free_rss: "Open RSS feed",
  free_youtube: "Watch free on YouTube",
  free_vimeo: "Watch free on Vimeo",
  free_archive: "Open on Internet Archive",
  free_openculture: "Open on Open Culture",
  free_web: "Open official site"
});

const FREE_SLUG_SET = new Set(FREE_PROVIDER_SLUGS);

export function isFreeSlug(slug) {
  return FREE_SLUG_SET.has(slug);
}

export function isFreeRecord(rec) {
  return Boolean(rec) && typeof rec.id === "string" && rec.id.startsWith("free:");
}

const APPLE_STORE_RE = /^https:\/\/(podcasts|books|itunes)\.apple\.com\/([a-z]{2})\//i;

export function linkUrl(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.url === "string") return value.url;
  return "";
}

export function linkAllowed(link, region) {
  const regions = link && Array.isArray(link.regions)
    ? link.regions.filter((code) => typeof code === "string" && code)
    : [];
  if (regions.length === 0) return true;
  const code = String(region || DEFAULT_REGION).trim().toUpperCase();
  return regions.some((item) => item.toUpperCase() === code);
}

export function localizeLink(url, region) {
  const value = String(url || "");
  const code = String(region || DEFAULT_REGION).trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return value;
  return value.replace(APPLE_STORE_RE, (_match, host) => "https://" + host.toLowerCase() + ".apple.com/" + code + "/");
}

export function isUsableFreeRecord(rec) {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return false;
  if (!isFreeRecord(rec) || typeof rec.t !== "string" || rec.t.trim() === "") return false;
  if (!Array.isArray(rec.p) || rec.p.length === 0) return false;
  if (!rec.u || typeof rec.u !== "object" || Array.isArray(rec.u)) return false;
  return Object.values(rec.u).some((value) => linkUrl(value).startsWith("https://"));
}

export function mergeFreeRecords(base, freeDoc, options = {}) {
  const records = Array.isArray(base) ? base : [];
  const incoming = freeDoc && Array.isArray(freeDoc.records) ? freeDoc.records : [];
  const region = typeof options.region === "string" && options.region ? options.region : DEFAULT_REGION;
  if (incoming.length === 0) return { records, added: 0 };
  const seen = new Set(records.map((rec) => rec && rec.id));
  const accepted = [];
  for (const rec of incoming) {
    if (!isUsableFreeRecord(rec) || seen.has(rec.id)) continue;
    const providers = [];
    const urls = {};
    for (const slug of rec.p) {
      const raw = rec.u?.[slug];
      const url = linkUrl(raw);
      if (!url.startsWith("https://")) continue;
      const link = typeof raw === "string" ? { url, regions: [] } : raw;
      if (!linkAllowed(link, region)) continue;
      providers.push(slug);
      urls[slug] = localizeLink(url, region);
    }
    if (providers.length === 0) continue;
    seen.add(rec.id);
    accepted.push({ ...rec, p: providers, u: urls });
  }
  if (accepted.length === 0) return { records, added: 0 };
  return { records: records.concat(accepted), added: accepted.length };
}

export function dailyFreePick(records, now, isExcluded) {
  const skip = typeof isExcluded === "function" ? isExcluded : () => false;
  const pool = (Array.isArray(records) ? records : [])
    .filter((rec) => isFreeRecord(rec) && !skip(rec))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (pool.length === 0) return null;
  const date = now instanceof Date ? now : new Date();
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return pool[Math.floor(midnight / 86400000) % pool.length];
}
