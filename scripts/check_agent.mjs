import assert from "node:assert/strict";
import { runAgent } from "../docs/js/agent.js";

const config = { baseUrl: "https://model.example/v1", apiKey: "sk-test", model: "m" };
const prompts = {
  system: "system instructions",
  planner: "latest: {{QUERY}}",
  output: "return final JSON",
  no_results: "none"
};

function ok(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function sequenceFetch(responses, seen = []) {
  let index = 0;
  return async (url, init) => {
    seen.push({ url, init });
    const response = responses[index++];
    if (!response) throw new Error("unexpected extra request");
    return response;
  };
}

function makeTools() {
  const calls = [];
  const resolutions = [];
  return {
    calls,
    resolutions,
    schemas: [{
      type: "function",
      function: {
        name: "lookup",
        description: "generic local lookup",
        parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
      }
    }, {
      type: "function",
      function: { name: "not_local", description: "must not be exposed", parameters: { type: "object" } }
    }],
    handlers: {
      lookup: async (args, signal) => {
        calls.push({ args, signal });
        return { count: 1, results: [{ id: "observed:1", t: "Observed" }] };
      }
    },
    resolve: async (ids, signal) => {
      resolutions.push({ ids, signal });
      return ids.filter((id) => id === "observed:1").map((id) => ({ id }));
    }
  };
}

function requestBody(request) {
  return JSON.parse(request.init.body);
}

// A direct JSON answer is final immediately: one model request, no rerank, no done event.
{
  const seen = [];
  const events = [];
  const tools = makeTools();
  const result = await runAgent({
    config,
    prompts,
    tools,
    context: { mood: "calm", youmd: "viewer", history: null, catalogManifest: { region: "IN", count: 1 } },
    query: "just explain the queue",
    conversation: [],
    onEvent: (event) => events.push(event),
    fetchImpl: sequenceFetch([
      ok({ choices: [{ message: { role: "assistant", content: "{\"reply\":\"The queue keeps your current picks.\"}" } }] })
    ], seen)
  });
  assert.equal(seen.length, 1, "direct answer must use exactly one request");
  assert.equal(result.ok, true);
  assert.equal(result.reply, "The queue keeps your current picks.");
  assert.equal(result.queue, null);
  assert.equal(tools.resolutions.length, 0);
  assert.equal(events.some((event) => event.type === "done"), false, "done events were removed");
  const messages = requestBody(seen[0]).messages;
  assert.ok(messages.some((message) => message.content === prompts.output), "output prompt is sent with first request");
  assert.ok(messages.some((message) => message.content.includes("Catalog manifest")), "manifest is a bounded system message");
}

// A generic local tool path makes two requests (tool call + final JSON), and
// queue IDs are grounded by one ordered resolver call.
{
  const seen = [];
  const events = [];
  const tools = makeTools();
  const external = new AbortController();
  const result = await runAgent({
    config,
    prompts,
    tools,
    context: { youmd: "", history: null, mood: "" },
    query: "find one",
    conversation: [],
    onEvent: (event) => events.push(event),
    signal: external.signal,
    fetchImpl: sequenceFetch([
      ok({
        choices: [{
          message: {
            role: "assistant",
            tool_calls: [{
              id: "lookup-1",
              type: "function",
              function: { name: "lookup", arguments: "{\"id\":\"observed:1\"}" }
            }]
          }
        }]
      }),
      ok({
        choices: [{
          message: {
            role: "assistant",
            content: "{\"reply\":\"Observed is a good match.\",\"queue\":[\"observed:1\",\"missing:2\",\"observed:1\"]}"
          }
        }]
      })
    ], seen)
  });
  assert.equal(seen.length, 2, "tool answer must use exactly two requests, with no rerank request");
  assert.equal(result.ok, true);
  assert.deepStrictEqual(result.queue, ["observed:1"]);
  assert.deepStrictEqual(tools.resolutions.map((entry) => entry.ids), [["observed:1", "missing:2"]]);
  assert.equal(tools.calls.length, 1);
  assert.notEqual(tools.calls[0].signal, external.signal, "handlers receive the run signal");
  assert.equal(tools.calls[0].signal.aborted, false);
  assert.ok(events.some((event) => event.type === "tool_call" && event.name === "lookup"));
  assert.ok(events.some((event) => event.type === "tool_result" && event.count === 1));
  const firstTools = requestBody(seen[0]).tools;
  assert.deepStrictEqual(firstTools.map((tool) => tool.function && tool.function.name), ["lookup"]);
}

// Bad final payloads remain parse failures, including an empty reply.
for (const content of ["not json", "{\"reply\":\"   \"}"]) {
  const events = [];
  const result = await runAgent({
    config,
    prompts,
    tools: makeTools(),
    context: {},
    query: "q",
    conversation: [],
    onEvent: (event) => events.push(event),
    fetchImpl: sequenceFetch([ok({ choices: [{ message: { role: "assistant", content } }] })])
  });
  assert.equal(result.ok, false);
  assert.equal(result.reply, "");
  assert.equal(result.queue, null);
  assert.equal(events.at(-1).code, "parse");
}

// Partial budgets merge with defaults: one allowed tool step ends with budget,
// rather than treating maxMs as absent.
{
  const events = [];
  const result = await runAgent({
    config,
    prompts,
    tools: makeTools(),
    context: {},
    query: "q",
    conversation: [],
    onEvent: (event) => events.push(event),
    budget: { maxSteps: 1 },
    fetchImpl: sequenceFetch([ok({
      choices: [{
        message: {
          role: "assistant",
          tool_calls: [{ id: "one", type: "function", function: { name: "lookup", arguments: "{}" } }]
        }
      }]
    })])
  });
  assert.equal(result.ok, false);
  assert.equal(events.at(-1).code, "budget");
}

// OpenRouter's web-search plugin is an advertised provider capability, never
// a local handler. Exact hostname matching excludes lookalikes and subdomains.
for (const [baseUrl, webSearch, shouldInclude] of [
  ["https://openrouter.ai/api/v1", true, true],
  ["https://api.openrouter.ai/v1", true, false],
  ["https://openrouter.ai/api/v1", false, false]
]) {
  const seen = [];
  const tools = makeTools();
  const result = await runAgent({
    config: { ...config, baseUrl, webSearch },
    prompts,
    tools,
    context: {},
    query: "q",
    conversation: [],
    onEvent: () => {},
    fetchImpl: sequenceFetch([
      ok({ choices: [{ message: { role: "assistant", content: "{\"reply\":\"Done.\"}" } }] })
    ], seen)
  });
  assert.equal(result.ok, true);
  const hasPlugin = requestBody(seen[0]).tools.some((tool) => tool.type === "openrouter:web_search");
  assert.equal(hasPlugin, shouldInclude);
  assert.equal(tools.calls.length, 0);
}

// Preserve invalid-base handling before any key-bearing request.
{
  let fetched = false;
  const events = [];
  const result = await runAgent({
    config: { ...config, baseUrl: "/relative" },
    prompts,
    tools: makeTools(),
    context: {},
    query: "q",
    conversation: [],
    onEvent: (event) => events.push(event),
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not fetch");
    }
  });
  assert.equal(fetched, false);
  assert.equal(result.ok, false);
  assert.equal(events.at(-1).code, "config");
}

console.log("check_agent OK");
