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

// Fallback India display order used until catalog.json metadata is loaded.
export const DEFAULT_PROVIDER_ORDER = Object.freeze([
  "netflix", "prime", "appletv", "zee5", "hotstar", "sunnxt", "plex", "mubi",
  "curiosity", "aha", "sonyliv", "crunchyroll", "hungama", "hoichoi", "epicon",
  "shemaroo", "tataplay", "discovery", "manoramamax", "mxplayer", "lionsgate",
  "chaupal", "bbcplayer", "docubay", "erosnow", "tubi"
]);

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
  return PROVIDER_LABELS[s] || s;
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
  if (TMDB_FALLBACK_RE.test(u)) return "fallback";
  if (slug === "netflix" && NETFLIX_TITLE_RE.test(u)) return "direct";
  return "search";
}

/** Call-to-action text that matches the link kind instead of implying every link plays directly. */
export function watchCta(slug, url) {
  const label = providerLabel(slug);
  const kind = linkKind(slug, url);
  if (kind === "direct") return "Watch on " + label;
  if (kind === "fallback") return "See where to watch (TMDB)";
  if (kind === "search") return "Find on " + label;
  return "Watch on " + label;
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
