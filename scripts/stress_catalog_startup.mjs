// Real-catalog startup benchmark. Times display-only main-thread prep versus
// Worker-owned search index build against the shipped catalog snapshot.
// Usage: node scripts/stress_catalog_startup.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { buildIndex } from "../docs/js/catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(here, "..", "docs", "assets", "catalog.json");
const sidecarPath = join(here, "..", "docs", "assets", "catalog.text.json");

const DISPLAY_PARSE_MS = 2500;
const WORKER_INDEX_MS = 4000;
const WARM_REPARSE_RATIO = 0.85;

function timed(label, fn) {
  const start = performance.now();
  const value = fn();
  const ms = performance.now() - start;
  return { label, ms, value };
}

const rawText = readFileSync(catalogPath, "utf8");
const sidecarText = readFileSync(sidecarPath, "utf8");

const coldParse = timed("cold JSON.parse(catalog)", () => JSON.parse(rawText));
const catalog = coldParse.value;
const records = Array.isArray(catalog) ? catalog : catalog.records;
if (!Array.isArray(records) || records.length === 0) {
  console.error("catalog records unavailable");
  process.exit(1);
}

const displayPath = timed("display projections (Map by id, no BM25)", () => {
  const byId = new Map();
  for (const record of records) byId.set(record.id, record);
  return byId.size;
});

const workerIndex = timed("worker-owned buildIndex(records)", () => buildIndex(records));

const sidecar = JSON.parse(sidecarText);
const synopses = sidecar && sidecar.s && typeof sidecar.s === "object" ? sidecar.s : {};
const richMerge = timed("display synopsis merge (no second index)", () => {
  let merged = 0;
  for (const record of records) {
    if (typeof synopses[record.id] === "string" && synopses[record.id] !== "") merged += 1;
  }
  return merged;
});

// Simulate a warm reload that reuses HTTP-cached bytes (already in memory here).
const warmParse = timed("warm JSON.parse(catalog) reused bytes", () => JSON.parse(rawText));

console.log("real-catalog startup benchmark");
console.log("records " + records.length);
console.log("");
console.log(coldParse.label.padEnd(48) + coldParse.ms.toFixed(1).padStart(8) + " ms");
console.log(displayPath.label.padEnd(48) + displayPath.ms.toFixed(1).padStart(8) + " ms");
console.log(workerIndex.label.padEnd(48) + workerIndex.ms.toFixed(1).padStart(8) + " ms");
console.log(richMerge.label.padEnd(48) + richMerge.ms.toFixed(1).padStart(8) + " ms"
  + " (" + richMerge.value + " synopses)");
console.log(warmParse.label.padEnd(48) + warmParse.ms.toFixed(1).padStart(8) + " ms");
console.log("");
console.log("Budgets: display parse < " + DISPLAY_PARSE_MS + " ms; worker index < "
  + WORKER_INDEX_MS + " ms; warm reparse not slower than cold*" + WARM_REPARSE_RATIO + ".");
console.log("Note: browser HTTP cache avoids re-transfer on warm navigations; this harness");
console.log("measures parse/index CPU only. Main thread must not rebuild BM25.");

const failures = [];
if (coldParse.ms > DISPLAY_PARSE_MS) {
  failures.push("cold catalog parse " + coldParse.ms.toFixed(1) + " ms > " + DISPLAY_PARSE_MS);
}
if (workerIndex.ms > WORKER_INDEX_MS) {
  failures.push("worker index " + workerIndex.ms.toFixed(1) + " ms > " + WORKER_INDEX_MS);
}
if (warmParse.ms > coldParse.ms * WARM_REPARSE_RATIO + 50) {
  failures.push("warm parse unexpectedly slower than cold");
}

if (failures.length) {
  console.log("startup benchmark FAILED: " + failures.join("; "));
  process.exit(1);
}
console.log("startup benchmark OK");
