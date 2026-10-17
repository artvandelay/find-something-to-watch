// Three real OpenRouter calls for the hero loops. The key is never printed.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "../docs/js/agent.js";
import { DEFAULT_LLM } from "../docs/js/store.js";
import { createTools } from "../docs/js/tools.js";
import { FREE_PROVIDER_SLUGS, mergeFreeRecords } from "../docs/js/providers.js";
import { buildTemporalBlock } from "../docs/js/tonight.js";
import { createLocalRuntimeAdapter, readKeyFromEnvFile } from "./stress_agent_live.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const key = (process.env.OPENROUTER_API_KEY || "").trim()
  || await readKeyFromEnvFile(path.join(ROOT, ".env"));
if (!key) {
  console.error("OPENROUTER_API_KEY is missing");
  process.exit(1);
}

const freeDoc = JSON.parse(await readFile(path.join(ROOT, "docs/assets/free-sources.json"), "utf8"));
const freeRecords = mergeFreeRecords([], freeDoc, { region: "IN" }).records;
const runtime = await createLocalRuntimeAdapter({ extraRecords: freeRecords });
const prompts = JSON.parse(await readFile(path.join(ROOT, "docs/assets/prompts.json"), "utf8"));
prompts.system = String(prompts.system || "").replaceAll("{region}", "IN");
const subscriptions = new Set(["netflix", "prime", "hotstar", ...FREE_PROVIDER_SLUGS]);
const tools = createTools({
  runtime,
  scope: { subscriptions: [...subscriptions] },
  seenKeys: []
});
const ids = new Set(runtime.recordsById.keys());

async function ask(query, conversation = []) {
  return runAgent({
    config: { baseUrl: DEFAULT_LLM.baseUrl, apiKey: key, model: DEFAULT_LLM.model },
    prompts,
    tools,
    context: {
      youmd: "",
      history: null,
      mood: "",
      recommendationQueue: null,
      temporal: buildTemporalBlock({ now: new Date(), lastActivityIso: null, region: "IN" })
    },
    query,
    conversation,
    fetchImpl: globalThis.fetch
  });
}

function idsOk(queue) {
  return (queue || []).every((item) => ids.has(item.id));
}

const h2 = await ask("a free history podcast for my commute");
const h2Free = (h2.queue || []).filter((item) => (
  String(item.id).startsWith("free:") && runtime.recordsById.get(item.id)?.k === "podcast"
));
const h2Pass = h2.ok === true && h2Free.length >= 1 && idsOk(h2.queue);
console.log((h2Pass ? "ok" : "FAIL") + " H2 free=" + h2Free.map((item) => item.id).slice(0, 3).join(","));

const h3 = await ask("I always avoid horror, I only watch on weeknights after 9pm, and I watched Dark Matter last week. Suggest a comedy for tonight");
const h3Habit = (h3.memoryCandidates || []).some((item) => item.kind === "habit" || item.polarity === "avoid");
const h3Watched = (h3.watched || []).some((title) => String(title).toLowerCase() === "dark matter");
const h3Pass = h3.ok === true && h3Watched && h3Habit && idsOk(h3.queue);
console.log((h3Pass ? "ok" : "FAIL") + " H3 watched=" + JSON.stringify(h3.watched || []) + " memory=" + (h3.memoryCandidates || []).length);

const paid = await ask("a short comedy for tonight");
const paidPass = paid.ok === true && idsOk(paid.queue) && (paid.queue || []).length > 0;
console.log((paidPass ? "ok" : "FAIL") + " paid=" + (paid.queue || []).map((item) => item.id).slice(0, 3).join(","));

if (!h2Pass || !h3Pass || !paidPass) process.exit(1);
console.log("live hero smoke ok");
