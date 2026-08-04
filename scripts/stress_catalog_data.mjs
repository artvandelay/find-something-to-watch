import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, "..", "docs", "assets", "catalog.json"), "utf8"));
const records = Array.isArray(raw) ? raw : raw.records;

const ISO_639_1 = new Set([
  "aa", "ab", "ae", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az",
  "ba", "be", "bg", "bh", "bi", "bm", "bn", "bo", "br", "bs",
  "ca", "ce", "ch", "co", "cr", "cs", "cu", "cv", "cy",
  "da", "de", "dv", "dz",
  "ee", "el", "en", "eo", "es", "et", "eu",
  "fa", "ff", "fi", "fj", "fo", "fr", "fy",
  "ga", "gd", "gl", "gn", "gu", "gv",
  "ha", "he", "hi", "ho", "hr", "ht", "hu", "hy", "hz",
  "ia", "id", "ie", "ig", "ii", "ik", "io", "is", "it", "iu",
  "ja", "jv",
  "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn", "ko", "kr", "ks", "ku", "kv", "kw", "ky",
  "la", "lb", "lg", "li", "ln", "lo", "lt", "lu", "lv",
  "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my",
  "na", "nb", "nd", "ne", "ng", "nl", "nn", "no", "nr", "nv", "ny",
  "oc", "oj", "om", "or", "os",
  "pa", "pi", "pl", "ps", "pt",
  "qu",
  "rm", "rn", "ro", "ru", "rw",
  "sa", "sc", "sd", "se", "sg", "si", "sk", "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw",
  "ta", "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw", "ty",
  "ug", "uk", "ur", "uz",
  "ve", "vi", "vo",
  "wa", "wo",
  "xh",
  "yi", "yo",
  "za", "zh", "zu"
]);

const GENRES = new Set([
  "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama",
  "Family", "Fantasy", "History", "Horror", "Music", "Mystery", "Romance",
  "Science Fiction", "TV Movie", "Thriller", "War", "Western",
  "Action & Adventure", "Kids", "News", "Reality", "Sci-Fi & Fantasy", "Soap",
  "Talk", "War & Politics"
]);

const PROVIDERS = new Set([
  "netflix", "prime", "hotstar", "zee5", "sonyliv", "mubi", "crunchyroll",
  "sunnxt", "mxplayer", "discovery", "shemaroo", "lionsgate", "manoramamax",
  "hungama", "hoichoi", "aha", "curiosity", "appletv", "epicon", "tataplay",
  "plex", "tubi", "docubay", "bbcplayer", "chaupal", "erosnow"
]);

const EXPECTED_KEYS = ["id", "t", "y", "k", "rt", "s", "im", "r", "p", "u", "img", "l", "g", "v"];
const ID_RE = /^(tmdb:[mt]|netflix:)\d+$/;
const ENTITY_RE = /&(?:amp|lt|gt|quot|nbsp|#\d+);/;
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF]/;

function normalizeForDup(s) {
  return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

console.log("records: " + records.length);

let htmlViol = 0;
const htmlExamples = [];
let imgViol = 0;
const imgHosts = new Map();
let uViol = 0;
const uExamples = [];
let lViol = 0;
const lBad = new Map();
let gViol = 0;
const gBad = new Map();
let pViol = 0;
const pBad = new Map();
let keyViol = 0;
const keyExamples = [];
let idViol = 0;
const idExamples = [];
const dupGroups = new Map();

for (const rec of records) {
  const id = rec && rec.id !== undefined ? rec.id : "<no id>";

  const keys = rec ? Object.keys(rec) : [];
  if (keys.length !== EXPECTED_KEYS.length || !EXPECTED_KEYS.every((k) => keys.includes(k))) {
    keyViol++;
    if (keyExamples.length < 5) keyExamples.push(id + " keys=[" + keys.join(",") + "]");
  }
  if (typeof rec.id !== "string" || !ID_RE.test(rec.id)) {
    idViol++;
    if (idExamples.length < 5) idExamples.push(String(rec.id));
  }

  for (const field of ["t", "s"]) {
    const val = rec[field];
    if (typeof val !== "string") continue;
    if (ENTITY_RE.test(val) || ZERO_WIDTH_RE.test(val)) {
      htmlViol++;
      if (htmlExamples.length < 5) htmlExamples.push(id + " " + field + "=" + JSON.stringify(val.slice(0, 80)));
    }
  }

  if (rec.img !== null && rec.img !== undefined) {
    let ok = false;
    try {
      const url = new URL(rec.img);
      ok = url.protocol === "https:" && url.host === "image.tmdb.org";
    } catch {
      ok = false;
    }
    if (!ok) {
      imgViol++;
      let host = "<unparseable>";
      try { host = new URL(rec.img).host; } catch { /* keep */ }
      imgHosts.set(host, (imgHosts.get(host) || 0) + 1);
    }
  }

  if (rec.u !== null && rec.u !== undefined) {
    const pSet = new Set(Array.isArray(rec.p) ? rec.p : []);
    for (const [slug, url] of Object.entries(rec.u)) {
      let https = false;
      try { https = new URL(url).protocol === "https:"; } catch { /* false */ }
      if (!https) {
        uViol++;
        if (uExamples.length < 5) uExamples.push(id + " u." + slug + " not https: " + String(url).slice(0, 80));
      }
      if (!pSet.has(slug)) {
        uViol++;
        if (uExamples.length < 5) uExamples.push(id + " u key '" + slug + "' missing from p");
      }
    }
  }

  if (rec.l !== null && rec.l !== undefined && !ISO_639_1.has(rec.l)) {
    lViol++;
    lBad.set(String(rec.l), (lBad.get(String(rec.l)) || 0) + 1);
  }

  if (Array.isArray(rec.g)) {
    for (const g of rec.g) {
      if (!GENRES.has(g)) {
        gViol++;
        gBad.set(String(g), (gBad.get(String(g)) || 0) + 1);
      }
    }
  }

  if (Array.isArray(rec.p)) {
    for (const p of rec.p) {
      if (!PROVIDERS.has(p)) {
        pViol++;
        pBad.set(String(p), (pBad.get(String(p)) || 0) + 1);
      }
    }
  }

  // Skip records whose title normalizes to "" (CJK/Cyrillic/Arabic-only titles):
  // an empty key carries no title information, so grouping on it only collides
  // unrelated titles.
  const normTitle = normalizeForDup(rec.t);
  if (normTitle) {
    const dupKey = normTitle + "|" + rec.y + "|" + rec.k;
    let group = dupGroups.get(dupKey);
    if (!group) { group = new Set(); dupGroups.set(dupKey, group); }
    group.add(rec.id);
  }
}

let dupViol = 0;
const dupExamples = [];
for (const [key, ids] of dupGroups) {
  if (ids.size > 1) {
    dupViol++;
    if (dupExamples.length < 10) dupExamples.push(key + " -> " + [...ids].join(", "));
  }
}

function topEntries(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, c]) => k + " (" + c + ")").join("; ");
}

console.log("html-entities/zero-width in t,s: " + htmlViol + " violations");
for (const e of htmlExamples) console.log("  " + e);
console.log("img host violations: " + imgViol + " violations");
if (imgHosts.size) console.log("  hosts: " + topEntries(imgHosts, 10));
console.log("u url/key violations: " + uViol + " violations");
for (const e of uExamples) console.log("  " + e);
console.log("l invalid ISO-639-1: " + lViol + " violations");
if (lBad.size) console.log("  values: " + topEntries(lBad, 10));
console.log("g outside vocabulary: " + gViol + " violations");
if (gBad.size) console.log("  values: " + topEntries(gBad, 10));
console.log("p outside curated slugs: " + pViol + " violations");
if (pBad.size) console.log("  values: " + topEntries(pBad, 10));
console.log("near-duplicate title groups: " + dupViol + " violations");
for (const e of dupExamples) console.log("  " + e);
console.log("key-set violations: " + keyViol + " violations");
for (const e of keyExamples) console.log("  " + e);
console.log("id format violations: " + idViol + " violations");
for (const e of idExamples) console.log("  " + e);

const total = htmlViol + imgViol + uViol + lViol + gViol + pViol + dupViol + keyViol + idViol;
if (total > 0) {
  console.error("VERDICT: FAIL — " + total + " total violations across catalog");
  process.exit(1);
}
console.log("VERDICT: PASS — all data integrity checks clean");
