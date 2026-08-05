import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PROVIDER_LABELS } from "../docs/js/providers.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const assets = join(root, "docs", "assets");
const RECORD_FIELDS = ["id", "t", "y", "k", "rt", "s", "im", "r", "p", "u", "img", "l", "g", "v"];
const ANALYTICAL_FIELDS = ["id", "t", "y", "k", "rt", "s", "im", "r", "p", "l", "g", "v"];

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0);
}

const catalog = await readJson(join(assets, "catalog.json"));
const sidecar = await readJson(join(assets, "catalog.text.json"));
const records = catalog.records;
assert.ok(Array.isArray(records) && records.length > 0, "catalog must contain records");

const ids = new Set();
for (const record of records) {
  assert.deepEqual(Object.keys(record), RECORD_FIELDS, "full record field order must remain frozen");
  assert.ok(!ids.has(record.id), "duplicate catalog id: " + record.id);
  ids.add(record.id);
  assert.ok(Array.isArray(record.p) && record.p.length > 0, "record must include curated providers: " + record.id);
  for (const slug of record.p) {
    assert.ok(Object.hasOwn(PROVIDER_LABELS, slug), "unknown provider slug " + slug + " on " + record.id);
  }
  assert.ok(record.u && typeof record.u === "object" && !Array.isArray(record.u),
    "record URLs must be an object: " + record.id);
  for (const slug of Object.keys(record.u)) {
    assert.ok(record.p.includes(slug), "URL provider " + slug + " is absent from p on " + record.id);
  }
}

for (const slug of catalog.meta.providers || []) {
  assert.ok(Object.hasOwn(PROVIDER_LABELS, slug), "catalog meta has unknown provider slug " + slug);
}
for (const id of Object.keys(sidecar.s || {})) {
  assert.ok(ids.has(id), "synopsis sidecar id is absent from catalog: " + id);
}

const sourceCounts = {
  poster: records.filter((record) => hasValue(record.img)).length,
  imdb: records.filter((record) => hasValue(record.im)).length,
  rating: records.filter((record) => hasValue(record.r)).length,
  votes: records.filter((record) => Number.isInteger(record.v) && record.v > 0).length,
  language: records.filter((record) => hasValue(record.l)).length,
  genre: records.filter((record) => hasValue(record.g)).length
};
for (const [field, count] of Object.entries(sourceCounts)) {
  assert.ok(count > 0, "source catalog has no " + field + " values to preserve");
}

// The main-thread full-record path must retain each present display field. This
// explicitly tests field retention independently from unavailable source values.
const recordsById = new Map(records.map((record) => [record.id, record]));
for (const record of records) {
  const full = recordsById.get(record.id);
  for (const field of ["img", "im", "r", "v", "l", "g"]) {
    assert.deepEqual(full[field], record[field], "full-record path lost " + field + " for " + record.id);
  }
}

const workerSource = await readFile(join(root, "docs", "js", "catalog-worker.js"), "utf8");
const projectionMatch = workerSource.match(/const PROJECTION_KEYS = (\[[^;]+\]);/);
assert.ok(projectionMatch, "catalog Worker must declare its analytical projection");
const workerProjectionFields = JSON.parse(projectionMatch[1].replace(/'/g, "\""));
assert.deepEqual(workerProjectionFields, ANALYTICAL_FIELDS,
  "Worker analytical projection must retain display analysis fields but exclude URLs and images");
assert.ok(!workerProjectionFields.includes("u") && !workerProjectionFields.includes("img"),
  "Worker projection must not include watch URLs or images");

console.log(
  "check_catalog_fidelity OK: " + records.length + " records; source display values "
  + Object.entries(sourceCounts).map(([field, count]) => field + "=" + count).join(", ")
);
