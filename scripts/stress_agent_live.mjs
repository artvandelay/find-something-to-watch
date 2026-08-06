// Live OpenRouter stress harness for the agent loop. Makes real API calls.
// Usage:
//   node scripts/stress_agent_live.mjs [--limit N]
//   node scripts/stress_agent_live.mjs --matrix
// Key resolution: process.env.OPENROUTER_API_KEY first, then the .env file at
// the repo root. The key is never printed. Missing key exits non-zero so the
// script is safe to wire into CI. See docs/LATENCY.md for targets.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "../docs/js/agent.js";
import { DEFAULT_LLM } from "../docs/js/store.js";
import { createTools } from "../docs/js/tools.js";
import { executeCatalogCode, prepareExecutionEnvironment } from "../docs/js/catalog-execution.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_PROMPT_TOKENS = 20000;
const MATRIX_MAX_PROMPT_TOKENS = 120000;
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

function wantsMatrix(argv) {
  return argv.includes("--matrix");
}

const MATRIX_CASES = [
  {
    name: "short-follow-up",
    query: "why would I like it?",
    conversation: [
      { role: "user", content: "surreal indian gem" },
      { role: "assistant", content: "Try My Dear Kuttichathan." }
    ],
    recommendationQueue: {
      source: { conversationId: "live", turnId: "t1", query: "surreal indian gem" },
      items: [{ id: "netflix:placeholder", t: "My Dear Kuttichathan", reason: "Surreal fit." }]
    },
    expectTurnClass: "direct"
  },
  {
    name: "fresh-recommendation",
    query: "Malayalam thrillers",
    conversation: [],
    recommendationQueue: null,
    expectTurnClass: "normal"
  },
  {
    name: "complex-compare",
    query: "compare a slow-burn Malayalam drama versus a Hindi crime series across my services",
    conversation: [],
    recommendationQueue: null,
    expectTurnClass: "complex"
  }
];

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

function normalizedSubscriptions(scope) {
  return new Set((Array.isArray(scope?.subscriptions) ? scope.subscriptions : [])
    .filter((slug) => typeof slug === "string" && slug.trim() !== ""));
}

function scopedRecord(record, subscriptions, excludeKeys) {
  if (!record || !Array.isArray(record.p) || !record.p.some((slug) => subscriptions.has(slug))) {
    return null;
  }
  if (excludeKeys.has(record.k)) return null;
  return {
    id: record.id,
    t: record.t,
    y: record.y,
    k: record.k,
    rt: record.rt,
    s: record.s || "",
    im: record.im,
    r: record.r,
    p: record.p.filter((slug) => subscriptions.has(slug)),
    l: record.l || null,
    g: Array.isArray(record.g) ? record.g : [],
    v: record.v
  };
}

function card(record, subscriptions) {
  if (!record || !Array.isArray(record.p) || !record.p.some((slug) => subscriptions.has(slug))) {
    return null;
  }
  const p = record.p.filter((slug) => subscriptions.has(slug));
  const u = {};
  for (const slug of p) {
    if (typeof record.u?.[slug] === "string") u[slug] = record.u[slug];
  }
  return {
    id: record.id,
    t: record.t,
    y: record.y,
    k: record.k,
    rt: record.rt,
    r: record.r,
    p,
    u,
    img: record.img,
    s: record.s || "",
    l: record.l || null,
    g: Array.isArray(record.g) ? record.g : [],
    reason: ""
  };
}

// Browser catalog runtimes use a Worker. Node cannot, so live stress uses this
// in-process adapter over the same scoped projection and trusted display cards.
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
  const recordsById = new Map(records.map((record) => [record.id, record]));

  return {
    kind: "local Node catalog adapter",
    records,
    recordsById,
    catalogIds: new Set(recordsById.keys()),
    async runCode({ code, scope, excludeKeys = [] }) {
      const subscriptions = normalizedSubscriptions(scope);
      const excluded = new Set((Array.isArray(excludeKeys) ? excludeKeys : [])
        .filter((key) => typeof key === "string" && key.trim() !== ""));
      const projection = records
        .map((record) => scopedRecord(record, subscriptions, excluded))
        .filter(Boolean);
      const environment = prepareExecutionEnvironment(JSON.stringify({
        records: projection,
        meta: { count: projection.length },
        fields: ["id", "t", "y", "k", "rt", "s", "im", "r", "p", "l", "g", "v"]
      }));
      const execution = await executeCatalogCode(code, environment);
      return { result: execution.json, observedIds: execution.observedIds, count: execution.count };
    },
    async resolve({ ids, scope }) {
      const subscriptions = normalizedSubscriptions(scope);
      const requested = new Set((Array.isArray(ids) ? ids : [])
        .filter((id) => typeof id === "string" && id.trim() !== ""));
      return [...requested]
        .map((id) => card(recordsById.get(id), subscriptions))
        .filter(Boolean);
    }
  };
}

function isScopedCard(record, subscriptions) {
  if (!record || typeof record.id !== "string") return false;
  if (!Array.isArray(record.p) || record.p.length === 0 || record.p.some((slug) => !subscriptions.has(slug))) {
    return false;
  }
  return !record.u || typeof record.u !== "object"
    || Object.keys(record.u).every((slug) => subscriptions.has(slug));
}

function createObservedTools(runtime, subscriptions) {
  const observed = { records: new Map(), scopeViolations: [] };
  const observedRuntime = {
    async runCode(request) {
      const value = await runtime.runCode(request);
      for (const id of Array.isArray(value?.observedIds) ? value.observedIds : []) {
        const record = runtime.recordsById.get(id);
        if (!record || !record.p.some((slug) => subscriptions.has(slug))) {
          observed.scopeViolations.push("run_catalog_js:" + id);
        } else {
          observed.records.set(id, record);
        }
      }
      return value;
    },
    async resolve(request) {
      const cards = await runtime.resolve(request);
      for (const record of cards) {
        if (!isScopedCard(record, subscriptions)) {
          observed.scopeViolations.push("resolve:" + (record && record.id ? record.id : "unknown"));
        }
      }
      return cards;
    }
  };
  const tools = createTools({
    runtime: observedRuntime,
    scope: { subscriptions: [...subscriptions] },
    currentQueueIds: [],
    seenKeys: []
  });

  return { tools, observed };
}

const argv = process.argv.slice(2);
const limit = parseLimit(argv);
const matrixMode = wantsMatrix(argv);
const envFile = path.join(ROOT, ".env");
const apiKey = (process.env.OPENROUTER_API_KEY || "").trim()
  || await readKeyFromEnvFile(envFile);

if (!apiKey) {
  console.log("OPENROUTER_API_KEY not set in .env; skipping live stress (deterministic checks still apply)");
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

function firstTokenMs(events, result) {
  if (Number.isFinite(result?.timing?.firstTokenMs)) return result.timing.firstTokenMs;
  const delta = events.find((event) => event.type === "delta");
  return delta && Number.isFinite(delta.atMs) ? delta.atMs : null;
}

function requestCount(result, events) {
  if (Number.isFinite(result?.billing?.requestCount)) return result.billing.requestCount;
  if (Number.isFinite(result?.usage?.requestCount)) return result.usage.requestCount;
  return events.filter((event) => event.type === "status").length;
}

async function runCase({
  query,
  conversation = [],
  recommendationQueue = null,
  label = query,
  maxPromptTokens = MAX_PROMPT_TOKENS
} = {}) {
  const events = [];
  const start = Date.now();
  const fixture = createObservedTools(runtime, STRESS_SUBSCRIPTIONS);
  // Resolve a real catalog id for matrix follow-ups when a placeholder was supplied.
  let queueContext = recommendationQueue;
  if (queueContext?.items?.[0]?.id === "netflix:placeholder") {
    const sample = runtime.records.find((record) =>
      record.p.some((slug) => STRESS_SUBSCRIPTIONS.has(slug)));
    if (sample) {
      queueContext = {
        ...queueContext,
        items: [{ id: sample.id, t: sample.t, reason: queueContext.items[0].reason }]
      };
    }
  }
  let result;
  let thrown = null;
  try {
    result = await runAgent({
      config,
      prompts,
      tools: fixture.tools,
      context: {
        youmd: "",
        history: null,
        mood: "",
        recommendationQueue: queueContext
      },
      query,
      conversation,
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
  const badIds = queue.filter((item) => {
    const id = typeof item === "string" ? item : item?.id;
    return id && !runtime.catalogIds.has(id);
  });
  const queueIds = queue.map((item) => typeof item === "string" ? item : item?.id).filter(Boolean);
  const unobservedQueueIds = queueIds.filter((id) => !fixture.observed.records.has(id));
  const unscopedQueueIds = queueIds.filter((id) => {
    const record = fixture.observed.records.get(id);
    return record && !record.p.some((slug) => STRESS_SUBSCRIPTIONS.has(slug));
  });
  const promptTokens = Number(result.usage && (result.usage.prompt_tokens ?? result.usage.promptTokens));
  const budgetViolations = [];
  if (Number.isFinite(promptTokens) && promptTokens > maxPromptTokens) {
    budgetViolations.push("prompt tokens " + promptTokens + " > " + maxPromptTokens);
  }
  if (Number.isFinite(ms) && ms > MAX_QUERY_MS) {
    budgetViolations.push("time " + ms + " ms > " + MAX_QUERY_MS + " ms");
  }
  const ok = !thrown && result.ok === true && !errorEvent &&
    typeof result.reply === "string" && result.reply.trim() !== "" && badIds.length === 0 &&
    unobservedQueueIds.length === 0 && unscopedQueueIds.length === 0 &&
    fixture.observed.scopeViolations.length === 0 && budgetViolations.length === 0;
  return {
    label,
    query,
    ok,
    soft,
    errorEvent,
    thrown,
    queue: queueIds.length,
    ms,
    ttft: firstTokenMs(events, result),
    requests: requestCount(result, events),
    turnClass: result.turnClass || events.find((event) => event.type === "context")?.diagnostics?.turnClass || "-",
    tokens: result.usage
      ? String(result.usage.total_tokens ?? result.usage.totalTokens ?? "-")
      : "-",
    usage: result.usage,
    detail: thrown ? String(thrown && thrown.message)
      : errorEvent ? errorEvent.code + ": " + errorEvent.message
      : badIds.length ? "unresolved ids: " + badIds.join(",")
      : unobservedQueueIds.length ? "queue ids not returned by observed tools: " + unobservedQueueIds.join(",")
      : unscopedQueueIds.length ? "queue ids escaped subscription scope: " + unscopedQueueIds.join(",")
      : fixture.observed.scopeViolations.length
        ? "tool results escaped subscription scope: " + fixture.observed.scopeViolations.join(",")
      : budgetViolations.length ? budgetViolations.join("; ")
      : ""
  };
}

const SOFT_CODES = new Set(["credit", "rate"]);
const rows = [];
let passed = 0;
let softFails = 0;
let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
let usageSeen = false;
const wallStart = Date.now();

if (matrixMode) {
  console.log("live latency matrix against " + config.baseUrl + " model " + config.model
    + " (" + runtime.records.length + " catalog records)");
  console.log("runtime: " + runtime.kind + " | subscriptions: "
    + [...STRESS_SUBSCRIPTIONS].join(", "));
  for (const testCase of MATRIX_CASES) {
    const row = await runCase({
      query: testCase.query,
      conversation: testCase.conversation,
      recommendationQueue: testCase.recommendationQueue,
      label: testCase.name,
      maxPromptTokens: MATRIX_MAX_PROMPT_TOKENS
    });
    if (testCase.expectTurnClass && row.turnClass !== testCase.expectTurnClass && row.ok) {
      row.ok = false;
      row.detail = "turnClass " + row.turnClass + " !== " + testCase.expectTurnClass;
    }
    if (testCase.expectTurnClass === "direct" && row.ok && row.requests !== 1) {
      row.ok = false;
      row.detail = "direct follow-up expected 1 request, got " + row.requests;
    }
    if (row.ok) passed += 1;
    if (row.soft) softFails += 1;
    if (row.usage) {
      usageSeen = true;
      totalUsage.prompt_tokens += row.usage.prompt_tokens || row.usage.promptTokens || 0;
      totalUsage.completion_tokens += row.usage.completion_tokens || row.usage.completionTokens || 0;
      totalUsage.total_tokens += row.usage.total_tokens || row.usage.totalTokens || 0;
    }
    rows.push({
      ...row,
      status: row.ok ? "PASS" : (row.soft ? "SOFT(" + row.errorEvent.code + ")" : "FAIL")
    });
  }
} else {
  const queries = limit === null ? QUERIES : QUERIES.slice(0, limit);
  console.log("live stress: " + queries.length + " queries against " + config.baseUrl
    + " model " + config.model + " (" + runtime.records.length + " catalog records)");
  console.log("runtime: " + runtime.kind + " | subscriptions: "
    + [...STRESS_SUBSCRIPTIONS].join(", "));
  for (const query of queries) {
    const row = await runCase({ query, label: query });
    if (row.ok) passed += 1;
    if (row.soft) softFails += 1;
    if (row.usage) {
      usageSeen = true;
      totalUsage.prompt_tokens += row.usage.prompt_tokens || row.usage.promptTokens || 0;
      totalUsage.completion_tokens += row.usage.completion_tokens || row.usage.completionTokens || 0;
      totalUsage.total_tokens += row.usage.total_tokens || row.usage.totalTokens || 0;
    }
    rows.push({
      ...row,
      status: row.ok ? "PASS" : (row.soft ? "SOFT(" + row.errorEvent.code + ")" : "FAIL")
    });
  }
}

const wallMs = Date.now() - wallStart;

console.log("");
console.log("case                                     | result      | class   | req |  ttft |     ms | tokens");
console.log("------------------------------------------+-------------+---------+-----+-------+--------+-------");
for (const row of rows) {
  console.log(
    String(row.label).slice(0, 41).padEnd(41)
    + " | " + row.status.padEnd(11)
    + " | " + String(row.turnClass).padEnd(7)
    + " | " + String(row.requests).padStart(3)
    + " | " + String(row.ttft ?? "-").padStart(5)
    + " | " + String(row.ms).padStart(6)
    + " | " + String(row.tokens).padStart(6)
    + (row.detail ? "\n    " + row.detail : "")
  );
}
console.log("------------------------------------------+-------------+---------+-----+-------+--------+-------");
console.log("passed " + passed + "/" + rows.length
  + (softFails ? " (" + softFails + " soft credit/rate failures)" : "")
  + " | wall " + (wallMs / 1000).toFixed(1) + "s"
  + " | tokens " + (usageSeen
    ? totalUsage.total_tokens + " (prompt " + totalUsage.prompt_tokens
      + ", completion " + totalUsage.completion_tokens + ")"
    : "not reported by API"));
console.log("Model speed is an honest BYOK trade-off; provider queue time is not controlled by this app.");

const failed = rows.length - passed;
const maxFail = matrixMode ? 0 : 2;
if (failed > maxFail) {
  console.log("live stress FAILED: " + failed + " failures (max " + maxFail + " allowed)");
  process.exit(1);
}
console.log("live stress OK");
process.exit(0);
