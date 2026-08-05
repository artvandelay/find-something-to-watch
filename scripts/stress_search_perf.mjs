import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { buildIndex, filterIndices, search } from "../docs/js/catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, "..", "docs", "assets", "catalog.json"), "utf8"));
const sidecar = JSON.parse(readFileSync(join(here, "..", "docs", "assets", "catalog.text.json"), "utf8"));
const leanRecords = Array.isArray(raw) ? raw : raw.records;
const synopses = sidecar && sidecar.s && typeof sidecar.s === "object" ? sidecar.s : {};
const records = leanRecords.map((record) => ({
  ...record,
  s: typeof synopses[record.id] === "string" ? synopses[record.id] : (record.s || "")
}));

const INDEX_BUILD_MS = 4000;
const HEAP_GROWTH_BYTES = 256 * 1024 * 1024;
const P50_MS = 30;
const P95_MS = 60;
const ANALYTICAL_SUBSCRIPTIONS = new Set(["netflix", "prime", "hotstar"]);

const QUERIES = [
  "heist", "love", "war", "space", "murder", "dragon", "wedding", "school",
  "ghost", "detective", "king", "robot", "zombie", "spy", "alien",
  "the dark knight", "money heist", "game of", "breaking bad", "stranger things",
  "sacred games", "delhi crime", "family man", "squid game", "peaky blinders",
  "action", "comedy", "drama", "horror", "thriller", "romance", "documentary",
  "animation", "crime", "fantasy", "mystery", "science fiction", "adventure",
  "hindi", "tamil", "telugu", "malayalam", "kannada", "english", "korean",
  "japanese", "french", "spanish", "bengali", "marathi", "punjabi",
  "netflix", "prime video", "hotstar", "zee5", "sonyliv", "mubi", "crunchyroll",
  "watch on netflix", "prime original", "hotstar specials",
  "shah rukh khan", "aamir khan", "rajamouli", "nolan", "scorsese",
  "best movies 2023", "new series", "classic film", "award winning",
  "true story", "based on novel", "stand up", "reality show", "talk show",
  "kids", "family", "anime", "bollywood", "hollywood", "tollywood",
  "rrr", "kgf", "pushpa", "dangal", "3 idiots", "inception", "interstellar",
  "parasite", "dune", "oppenheimer", "barbie", "jawan", "pathaan", "animal",
  "the", "of", "and", "a", "in",
  "x", "go", "up", "it", "21",
  "mumbai saga", "chennai express", "bangalore days", "kerala story",
  "fast furious", "mission impossible", "james bond", "harry potter",
  "lord rings", "star wars", "marvel", "avengers", "batman", "superman",
  "spider man", "iron man", "thor", "hulk", "black panther",
  "romantic comedy", "action thriller", "crime drama", "sci fi adventure",
  "horror mystery", "war history", "musical romance", "dark comedy",
  "serial killer", "bank robbery", "courtroom drama", "political thriller",
  "survival", "revenge", "friendship", "betrayal", "redemption",
  "undercover cop", "gangster", "mafia", "cartel", "heist gone wrong",
  "time travel", "parallel universe", "dystopian future", "post apocalyptic",
  "vampire", "werewolf", "witch", "demon", "exorcism",
  "football", "cricket", "boxing", "racing", "olympics",
  "chef", "restaurant", "food documentary", "travel show", "nature",
  "planet earth", "blue planet", "our planet", "wildlife",
  "world war", "cold war", "civil war", "independence", "revolution",
  "biopic", "musician", "artist", "writer", "scientist",
  "college romance", "high school drama", "office comedy", "medical drama",
  "legal thriller", "police procedural", "prison break", "court case",
  "sitcom", "mockumentary", "anthology", "miniseries", "docuseries",
  "feel good", "coming of age", "cult classic", "hidden gem", "binge worthy",
  "slow burn", "plot twist", "ensemble cast"
];

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function fail(msg) {
  console.error("FAIL: " + msg);
  process.exit(1);
}

const maybeGc = () => { if (typeof globalThis.gc === "function") globalThis.gc(); };

function scopedAnalyticalProjection(source, subscriptions) {
  const allowed = new Set(subscriptions);
  return filterIndices(source, { providers: allowed }).map((i) => {
    const record = source[i];
    const p = record.p.filter((slug) => allowed.has(slug));
    return {
      id: record.id,
      t: record.t,
      y: record.y,
      k: record.k,
      rt: record.rt,
      r: record.r,
      v: record.v,
      p,
      l: record.l,
      g: record.g,
      s: record.s
    };
  });
}

// Node-only equivalent of the browser execution setup: it keeps raw records
// for direct scans while passing a hard provider allow-list to helper search.
function prepareExecutionEnvironment(source, index, subscriptions) {
  const allowedIndices = filterIndices(source, { providers: subscriptions });
  return {
    records: source,
    index,
    subscriptions: new Set(subscriptions),
    allowed: new Set(allowedIndices),
    recordsById: new Map(source.map((record) => [record.id, record]))
  };
}

function directFullScanAndSort(environment) {
  const results = [];
  for (const record of environment.records) {
    if (!record.p.some((slug) => environment.subscriptions.has(slug))) continue;
    results.push(record);
  }
  results.sort((a, b) => (b.r ?? -1) - (a.r ?? -1) || a.id.localeCompare(b.id));
  return results.slice(0, 20);
}

function helperSearch(environment, query) {
  return search(environment.index, query, { limit: 20, allow: environment.allowed });
}

console.log("records: " + records.length);
console.log("sidecar synopses: " + Object.keys(synopses).length);

maybeGc();
const heapBefore = process.memoryUsage().heapUsed;
const t0 = performance.now();
let idx = buildIndex(records);
const buildMs = performance.now() - t0;
maybeGc();
const heapAfterFirst = process.memoryUsage().heapUsed;
console.log("rich index build ms: " + buildMs.toFixed(1));
if (buildMs >= INDEX_BUILD_MS) {
  fail("index build " + buildMs.toFixed(1) + " ms >= threshold " + INDEX_BUILD_MS + " ms");
}

idx = null;
maybeGc();
const idx2 = buildIndex(records);
maybeGc();
const heapAfterSecond = process.memoryUsage().heapUsed;
const retainedGrowth = heapAfterSecond - heapAfterFirst;
console.log("heapUsed before build: " + (heapBefore / 1048576).toFixed(1) + " MB");
console.log("heapUsed after first build: " + (heapAfterFirst / 1048576).toFixed(1) + " MB");
console.log("heapUsed after second build (first dropped): " + (heapAfterSecond / 1048576).toFixed(1) + " MB");
console.log("retained growth of second build over first: " + (retainedGrowth / 1048576).toFixed(1) + " MB");
if (retainedGrowth >= HEAP_GROWTH_BYTES) {
  fail("second-build retained heap growth " + (retainedGrowth / 1048576).toFixed(1) +
    " MB >= threshold 256 MB");
}
idx = idx2;

const projectionStart = performance.now();
const projection = scopedAnalyticalProjection(records, ANALYTICAL_SUBSCRIPTIONS);
const projectionMs = performance.now() - projectionStart;
const projectionJson = JSON.stringify(projection);
if (projectionJson.includes('"u":') || projectionJson.includes('"img":')) {
  fail("analytical projection must not serialize provider URLs or images");
}
const projectionJsonBytes = Buffer.byteLength(projectionJson);
console.log("scoped analytical projection: " + projection.length + " records in "
  + projectionMs.toFixed(1) + " ms, JSON " + projectionJsonBytes + " bytes");

const environmentStart = performance.now();
const environment = prepareExecutionEnvironment(records, idx, ANALYTICAL_SUBSCRIPTIONS);
const environmentMs = performance.now() - environmentStart;
console.log("prepareExecutionEnvironment ms: " + environmentMs.toFixed(1)
  + " (allowed " + environment.allowed.size + ")");

const directStart = performance.now();
const directResults = directFullScanAndSort(environment);
const directMs = performance.now() - directStart;
console.log("direct full scan/sort ms: " + directMs.toFixed(3)
  + " (top " + directResults.length + ")");

if (QUERIES.length !== 200) {
  fail("query list must contain exactly 200 entries, found " + QUERIES.length);
}

const latencies = [];
for (const q of QUERIES) {
  const s = performance.now();
  helperSearch(environment, q);
  latencies.push(performance.now() - s);
}
latencies.sort((a, b) => a - b);
const p50 = percentile(latencies, 50);
const p95 = percentile(latencies, 95);
console.log("queries: " + QUERIES.length);
console.log("helper search p50 ms: " + p50.toFixed(3));
console.log("helper search p95 ms: " + p95.toFixed(3));
if (p50 >= P50_MS) {
  fail("query p50 " + p50.toFixed(3) + " ms >= threshold " + P50_MS + " ms");
}
if (p95 >= P95_MS) {
  fail("query p95 " + p95.toFixed(3) + " ms >= threshold " + P95_MS + " ms");
}

console.log("OK: all perf assertions passed (build " + buildMs.toFixed(1) + " ms < " +
  INDEX_BUILD_MS + " ms, retained growth " + (retainedGrowth / 1048576).toFixed(1) +
  " MB < 256 MB, p50 " + p50.toFixed(3) + " ms < " + P50_MS + " ms, p95 " +
  p95.toFixed(3) + " ms < " + P95_MS + " ms)");
