// Failure-mode harness for the generic agent loop. Every request is mocked.
// Run: node scripts/stress_agent_hostile.mjs

import assert from "node:assert/strict";
import { runAgent } from "../docs/js/agent.js";

let globalFetchCalls = 0;
globalThis.fetch = async () => {
  globalFetchCalls++;
  throw new Error("network is forbidden in this harness");
};

const config = { baseUrl: "https://mock.local/v1", apiKey: "sk-mock", model: "mock" };
const prompts = { system: "sys", planner: "plan {{QUERY}}", output: "output JSON", no_results: "none" };

function ok(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function toolMessage(name, argumentsText = "{}") {
  return ok({
    choices: [{
      message: {
        role: "assistant",
        tool_calls: [{ id: "call-1", type: "function", function: { name, arguments: argumentsText } }]
      }
    }]
  });
}

function finalMessage(content = "{\"reply\":\"Recovered.\"}") {
  return ok({ choices: [{ message: { role: "assistant", content } }] });
}

function sequence(responses, requests = []) {
  let index = 0;
  return async (url, init) => {
    requests.push({ url, init });
    const response = responses[index++];
    if (!response) throw new Error("unexpected request");
    return response;
  };
}

function makeTools(handler = async () => ({ count: 1, results: [{ id: "observed:1" }] })) {
  const calls = [];
  return {
    calls,
    schemas: [{
      type: "function",
      function: { name: "lookup", description: "generic local lookup", parameters: { type: "object" } }
    }],
    handlers: {
      lookup: async (args, signal) => {
        calls.push({ args, signal });
        return handler(args, signal);
      }
    },
    resolve: async (ids) => ids.map((id) => ({ id }))
  };
}

async function drive({ fetchImpl, tools = makeTools(), signal = null, budget, config: configOverride = config }) {
  const events = [];
  const result = await runAgent({
    config: configOverride,
    prompts,
    tools,
    context: { youmd: "", history: null, mood: "" },
    query: "q".repeat(40000),
    conversation: [{ role: "user", content: "u".repeat(8000) }, { role: "assistant", content: "a".repeat(8000) }],
    onEvent: (event) => events.push(event),
    signal,
    budget,
    fetchImpl
  });
  return { events, result };
}

function firstError(events) {
  return events.find((event) => event.type === "error");
}

const cases = [
  ["HTTP errors retain provider mapping", async () => {
    for (const [status, code] of [[401, "auth"], [402, "credit"], [429, "rate"], [413, "context"], [500, "network"]]) {
      const { events, result } = await drive({
        fetchImpl: async () => ({ ok: false, status, text: async () => "error" })
      });
      assert.equal(firstError(events).code, code);
      assert.deepStrictEqual(result, { ok: false, reply: "", queue: null, usage: null });
    }
  }],

  ["malformed and unknown calls become repairable tool results", async () => {
    for (const [name, argumentsText, expected] of [
      ["lookup", "{bad", "valid JSON object"],
      ["does_not_exist", "{}", "unknown tool"]
    ]) {
      const requests = [];
      const tools = makeTools();
      const { events, result } = await drive({
        tools,
        fetchImpl: sequence([toolMessage(name, argumentsText), finalMessage()], requests)
      });
      assert.equal(result.ok, true);
      assert.equal(firstError(events), undefined);
      assert.equal(requests.length, 2);
      const followUp = JSON.parse(requests[1].init.body);
      const repair = followUp.messages.at(-1);
      assert.equal(repair.role, "tool");
      assert.match(repair.content, new RegExp(expected));
      assert.equal(tools.calls.length, 0);
    }
  }],

  ["null and nonserializable local results are repairable", async () => {
    for (const handler of [
      async () => null,
      async () => {
        const value = {};
        value.self = value;
        return value;
      }
    ]) {
      const requests = [];
      const { events, result } = await drive({
        tools: makeTools(handler),
        fetchImpl: sequence([toolMessage("lookup"), finalMessage()], requests)
      });
      assert.equal(result.ok, true);
      assert.equal(firstError(events), undefined);
      const repair = JSON.parse(requests[1].init.body).messages.at(-1);
      assert.match(repair.content, /tool returned (no result|a non-serializable result)/);
    }
  }],

  ["bad final JSON and blank replies are parse failures", async () => {
    for (const content of ["{", "{\"reply\":\"\"}"]) {
      const { events, result } = await drive({ fetchImpl: sequence([finalMessage(content)]) });
      assert.equal(result.ok, false);
      assert.equal(firstError(events).code, "parse");
    }
  }],

  ["tool-call loop stops at configured step budget", async () => {
    let count = 0;
    const { events, result } = await drive({
      budget: { maxSteps: 3, maxMs: 1000 },
      fetchImpl: async () => {
        count++;
        return toolMessage("lookup");
      }
    });
    assert.equal(count, 3);
    assert.equal(result.ok, false);
    assert.equal(firstError(events).code, "budget");
  }],

  ["external abort cancels fetch as aborted", async () => {
    const controller = new AbortController();
    const fetchImpl = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    const pending = drive({ fetchImpl, signal: controller.signal, budget: { maxMs: 1000 } });
    setTimeout(() => controller.abort(), 10);
    const { events, result } = await pending;
    assert.equal(result.ok, false);
    assert.equal(firstError(events).code, "aborted");
  }],

  ["internal timeout cancels a hanging handler as budget", async () => {
    const tools = makeTools((args, signal) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("timed out"), { name: "AbortError" })));
    }));
    const { events, result } = await drive({
      tools,
      budget: { maxMs: 10, maxSteps: 4 },
      fetchImpl: sequence([toolMessage("lookup")])
    });
    assert.equal(result.ok, false);
    assert.equal(firstError(events).code, "budget");
  }],

  ["OpenRouter plugin is advertised but never locally dispatched", async () => {
    const requests = [];
    const tools = makeTools();
    let pluginHandlerCalls = 0;
    tools.handlers["openrouter:web_search"] = async () => {
      pluginHandlerCalls++;
      return { count: 1 };
    };
    const { events, result } = await drive({
      tools,
      config: { ...config, baseUrl: "https://openrouter.ai/api/v1", webSearch: true },
      fetchImpl: sequence([
        toolMessage("openrouter:web_search", "{\"query\":\"news\"}"),
        finalMessage()
      ], requests)
    });
    assert.equal(result.ok, true);
    assert.equal(tools.calls.length, 0);
    assert.equal(pluginHandlerCalls, 0);
    assert.equal(firstError(events), undefined);
    const firstBody = JSON.parse(requests[0].init.body);
    assert.ok(firstBody.tools.some((tool) => tool.type === "openrouter:web_search"));
    const repair = JSON.parse(requests[1].init.body).messages.at(-1);
    assert.match(repair.content, /unknown tool/);
  }]
];

let passed = 0;
for (const [name, run] of cases) {
  await run();
  passed++;
  console.log("PASS - " + name);
}

assert.equal(globalFetchCalls, 0, "a real fetch was attempted");
console.log(passed + "/" + cases.length + " hostile cases passed; real fetch calls: " + globalFetchCalls);
