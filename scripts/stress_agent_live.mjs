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

const limit = parseLimit(process.argv.slice(2));
const envFile = process.env.STRESS_ENV_FILE || path.join(ROOT, ".env");
const apiKey = (process.env.OPENROUTER_API_KEY || "").trim()
  || await readKeyFromEnvFile(envFile);

if (!apiKey) {
  console.log("OPENROUTER_API_KEY not set in .env; skipping live stress");
  process.exit(1);
}

const catalog = JSON.parse(await readFile(path.join(ROOT, "docs/assets/catalog.json"), "utf8"));
const prompts = JSON.parse(await readFile(path.join(ROOT, "docs/assets/prompts.json"), "utf8"));
const records = catalog.records;
const catalogIds = new Set(records.map((r) => r.id));
const tools = createTools({
  records,
  index: buildIndex(records),
  search,
  filterIndices,
  seenKeys: []
});

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
  + " model " + config.model + " (" + records.length + " catalog records)");

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
  let result;
  let thrown = null;
  try {
    result = await runAgent({
      config,
      prompts,
      tools,
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
  const badIds = queue.filter((id) => !catalogIds.has(id));
  const ok = !thrown && result.ok === true && !errorEvent &&
    typeof result.reply === "string" && result.reply.trim() !== "" && badIds.length === 0;

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
