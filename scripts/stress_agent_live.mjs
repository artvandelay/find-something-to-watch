// Live OpenRouter stress harness for the agent loop. Makes real API calls.
// Usage: node scripts/stress_agent_live.mjs [--limit N]
// Key resolution: process.env.OPENROUTER_API_KEY first, then the .env file at
// the repo root (override the path with STRESS_ENV_FILE). The key is never
// printed. Missing key exits non-zero so the script is safe to wire into CI.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "../docs/js/agent.js";
import { DEFAULT_LLM } from "../docs/js/store.js";
import { createTools } from "../docs/js/tools.js";
import { buildIndex, search, filterIndices } from "../docs/js/catalog.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_PROMPT_TOKENS = 20000;
const MAX_QUERY_MS = 60000;
const STRESS_SUBSCRIPTIONS = new Set(["netflix", "prime", "hotstar"]);

function parseLimit(argv) {
  const i = argv.indexOf("--limit");
  if (i === -1) return null;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) {
    console.error("bad --limit value: " + argv[i + 1]);
    process.exit(2);
  }
  return n;
}

async function readKeyFromEnvFile(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    return "";
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() === "OPENROUTER_API_KEY") {
      const v = trimmed.slice(eq + 1).trim();
      // dotenv convention: matching surrounding quotes are not part of the value
      if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'")))) {
        return v.slice(1, -1);
      }
      return v;
    }
  }
  return "";
}

// Browser catalog runtimes can use a Worker. Node cannot, so live stress uses
// this real in-process adapter over the same lean catalog plus synopsis sidecar.
async function createLocalRuntimeAdapter() {
  const catalog = JSON.parse(await readFile(path.join(ROOT, "docs/assets/catalog.json"), "utf8"));
  const sidecar = JSON.parse(await readFile(path.join(ROOT, "docs/assets/catalog.text.json"), "utf8"));
  const leanRecords = Array.isArray(catalog) ? catalog : catalog.records;
  const synopses = sidecar && sidecar.s && typeof sidecar.s === "object" ? sidecar.s : {};
  if (!Array.isArray(leanRecords)) throw new Error("catalog records are unavailable");

  const records = leanRecords.map((record) => ({
    ...record,
    s: typeof synopses[record.id] === "string" ? synopses[record.id] : (record.s || "")
  }));
  const index = buildIndex(records);
  const recordsById = new Map(records.map((record) => [record.id, record]));

  return {
    kind: "local Node catalog adapter",
    records,
    catalogIds: new Set(recordsById.keys()),
    createToolDeps(subscriptions) {
      return {
        records,
        recordsById,
        index,
        search,
        filterIndices,
        seenKeys: [],
        subscriptions: new Set(subscriptions)
      };
    }
  };
}

function isScopedRecord(record, subscriptions) {
  if (!record || typeof record.id !== "string") return false;
  if (!Array.isArray(record.p) || record.p.length === 0 || record.p.some((slug) => !subscriptions.has(slug))) {
    return false;
  }
  return !record.u || typeof record.u !== "object"
    || Object.keys(record.u).every((slug) => subscriptions.has(slug));
}

function createObservedTools(runtime, subscriptions) {
  const observed = { records: new Map(), scopeViolations: [] };
  const base = createTools(runtime.createToolDeps(subscriptions));
  const handlers = {};

  for (const [name, handler] of Object.entries(base.handlers)) {
    handlers[name] = async (args) => {
      const value = await handler(args);
      for (const record of Array.isArray(value && value.results) ? value.results : []) {
        if (!isScopedRecord(record, subscriptions)) {
          observed.scopeViolations.push(name + ":" + (record && record.id ? record.id : "unknown"));
        } else {
          observed.records.set(record.id, record);
        }
      }
      return value;
    };
  }

  return { tools: { schemas: base.schemas, handlers }, observed };
}

const limit = parseLimit(process.argv.slice(2));
const envFile = process.env.STRESS_ENV_FILE || path.join(ROOT, ".env");
const apiKey = (process.env.OPENROUTER_API_KEY || "").trim()
  || await readKeyFromEnvFile(envFile);

if (!apiKey) {
  console.log("OPENROUTER_API_KEY not set in .env; skipping live stress");
  process.exit(1);
}

const prompts = JSON.parse(await readFile(path.join(ROOT, "docs/assets/prompts.json"), "utf8"));
let runtime;
try {
  runtime = await createLocalRuntimeAdapter();
} catch {
  console.log("catalog runtime could not be instantiated; skipping live stress");
  process.exit(0);
}

const config = {
  baseUrl: DEFAULT_LLM.baseUrl,
  apiKey,
  model: DEFAULT_LLM.model
};

const QUERIES = [
  "Malayalam thrillers",
  "Tamil comedies from the 90s",
  "Hindi crime series on Netflix",
  "something on JioHotstar",
  "Kannada action movies rated above 7",
  "Telugu TV series",
  "feel-good Bollywood romance",
  "short Bengali films under two hours",
  "Marathi family dramas",
  "Punjabi comedy movies",
  "Indian documentaries on Netflix",
  "new Hindi releases from 2023",
  "South Indian dubbed action",
  "something like Scam 1992",
  "kids movies in Hindi",
  "slow burn Malayalam drama",
  "crime thrillers on Prime Video",
  "horror movies in Tamil",
  "romantic series for a weekend binge",
  "highly rated Indian indie films",
  "movies about the Mumbai underworld",
  "light sitcoms in Hindi",
  "epic historical dramas from India",
  "surprise me with something weird"
];

const queries = limit === null ? QUERIES : QUERIES.slice(0, limit);
console.log("live stress: " + queries.length + " queries against " + config.baseUrl
  + " model " + config.model + " (" + runtime.records.length + " catalog records)");
console.log("runtime: " + runtime.kind + " | subscriptions: "
  + [...STRESS_SUBSCRIPTIONS].join(", "));

const SOFT_CODES = new Set(["credit", "rate"]);
const rows = [];
let passed = 0;
let softFails = 0;
let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
let usageSeen = false;
const wallStart = Date.now();

for (const query of queries) {
  const events = [];
  const start = Date.now();
  const fixture = createObservedTools(runtime, STRESS_SUBSCRIPTIONS);
  let result;
  let thrown = null;
  try {
    result = await runAgent({
      config,
      prompts,
      tools: fixture.tools,
      context: { youmd: "", history: null, mood: "" },
      query,
      conversation: [],
      onEvent: (e) => events.push(e),
      signal: null,
      fetchImpl: globalThis.fetch
    });
  } catch (err) {
    thrown = err;
    result = { reply: "", queue: null, usage: null };
  }
  const ms = Date.now() - start;

  const errorEvent = events.find((e) => e.type === "error");
  const soft = !thrown && errorEvent && SOFT_CODES.has(errorEvent.code);
  const queue = result.queue || [];
  const badIds = queue.filter((id) => !runtime.catalogIds.has(id));
  const unobservedQueueIds = queue.filter((id) => !fixture.observed.records.has(id));
  const unscopedQueueIds = queue.filter((id) => {
    const record = fixture.observed.records.get(id);
    return record && !isScopedRecord(record, STRESS_SUBSCRIPTIONS);
  });
  const promptTokens = Number(result.usage && result.usage.prompt_tokens);
  const budgetViolations = [];
  if (Number.isFinite(promptTokens) && promptTokens > MAX_PROMPT_TOKENS) {
    budgetViolations.push("prompt tokens " + promptTokens + " > " + MAX_PROMPT_TOKENS);
  }
  if (Number.isFinite(ms) && ms > MAX_QUERY_MS) {
    budgetViolations.push("time " + ms + " ms > " + MAX_QUERY_MS + " ms");
  }
  const ok = !thrown && result.ok === true && !errorEvent &&
    typeof result.reply === "string" && result.reply.trim() !== "" && badIds.length === 0 &&
    unobservedQueueIds.length === 0 && unscopedQueueIds.length === 0 &&
    fixture.observed.scopeViolations.length === 0 && budgetViolations.length === 0;

  if (ok) passed++;
  if (soft) softFails++;

  if (result.usage) {
    usageSeen = true;
    totalUsage.prompt_tokens += result.usage.prompt_tokens || 0;
    totalUsage.completion_tokens += result.usage.completion_tokens || 0;
    totalUsage.total_tokens += result.usage.total_tokens || 0;
  }

  rows.push({
    query,
    status: ok ? "PASS" : (soft ? "SOFT(" + errorEvent.code + ")" : "FAIL"),
    queue: queue.length,
    ms,
    tokens: result.usage ? String(result.usage.total_tokens) : "-",
    detail: thrown ? String(thrown && thrown.message)
      : errorEvent ? errorEvent.code + ": " + errorEvent.message
      : badIds.length ? "unresolved ids: " + badIds.join(",")
      : unobservedQueueIds.length ? "queue ids not returned by observed tools: " + unobservedQueueIds.join(",")
      : unscopedQueueIds.length ? "queue ids escaped subscription scope: " + unscopedQueueIds.join(",")
      : fixture.observed.scopeViolations.length
        ? "tool results escaped subscription scope: " + fixture.observed.scopeViolations.join(",")
      : budgetViolations.length ? budgetViolations.join("; ")
      : ""
  });
}

const wallMs = Date.now() - wallStart;

console.log("");
console.log("query                                   | result      | queue |     ms | tokens");
console.log("----------------------------------------+-------------+-------+--------+-------");
for (const row of rows) {
  console.log(
    row.query.slice(0, 39).padEnd(39)
    + " | " + row.status.padEnd(11)
    + " | " + String(row.queue).padStart(5)
    + " | " + String(row.ms).padStart(6)
    + " | " + row.tokens.padStart(6)
    + (row.detail ? "\n    " + row.detail : "")
  );
}
console.log("----------------------------------------+-------------+-------+--------+-------");
console.log("passed " + passed + "/" + queries.length
  + (softFails ? " (" + softFails + " soft credit/rate failures)" : "")
  + " | wall " + (wallMs / 1000).toFixed(1) + "s"
  + " | tokens " + (usageSeen
    ? totalUsage.total_tokens + " (prompt " + totalUsage.prompt_tokens
      + ", completion " + totalUsage.completion_tokens + ")"
    : "not reported by API"));

const failed = queries.length - passed;
if (failed > 2) {
  console.log("live stress FAILED: " + failed + " failures (max 2 allowed)");
  process.exit(1);
}
console.log("live stress OK");
process.exit(0);
