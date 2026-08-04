import assert from "node:assert/strict";
import { runAgent } from "../docs/js/agent.js";

const tools = {
  schemas: [{
    type: "function",
    function: {
      name: "search_titles",
      description: "d",
      parameters: { type: "object", properties: {}, required: [] }
    }
  }],
  handlers: {
    search_titles: async () => ({ count: 1, results: [{ id: "netflix:1", t: "A" }] }),
    get_titles: async () => ({
      count: 1,
      results: [{
        id: "netflix:1",
        t: "A",
        y: 2020,
        k: "movie",
        rt: 90,
        r: 7,
        p: ["netflix"],
        u: { netflix: "https://x/1" },
        img: null
      }]
    })
  }
};

const prompts = { system: "sys", planner: "plan {{QUERY}}", rerank: "rerank", no_results: "none" };
const config = { baseUrl: "https://fake/v1", apiKey: "sk-test", model: "m" };

function sequenceFetch(responses) {
  let i = 0;
  return async () => {
    const next = responses[i++];
    if (!next) throw new Error("unexpected extra fetch call");
    return next;
  };
}

function ok(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

// Test 1 - happy path.
{
  const fetchImpl = sequenceFetch([
    ok({
      choices: [{
        message: {
          role: "assistant",
          tool_calls: [{
            id: "c1",
            type: "function",
            function: { name: "search_titles", arguments: "{}" }
          }]
        }
      }]
    }),
    ok({ choices: [{ message: { role: "assistant", content: "done thinking" } }] }),
    ok({
      choices: [{
        message: {
          role: "assistant",
          content: "{\"picks\":[{\"id\":\"netflix:1\",\"reason\":\"fits\"}],\"note\":\"here\"}"
        }
      }]
    })
  ]);

  const events = [];
  const result = await runAgent({
    config,
    prompts,
    tools,
    context: { youmd: "about me", history: null, mood: "chill" },
    query: "something fun",
    onEvent: (e) => events.push(e),
    signal: null,
    fetchImpl
  });

  assert.ok(events.some((e) => e.type === "tool_call" && e.name === "search_titles"));
  assert.ok(events.some((e) => e.type === "tool_result" && e.count === 1));
  assert.equal(result.picks.length, 1);
  assert.equal(result.picks[0].reason, "fits");
  assert.deepStrictEqual(
    Object.keys(result.picks[0]).sort(),
    ["id", "img", "k", "p", "r", "reason", "rt", "t", "u", "y"]
  );
  assert.equal(events.at(-1).type, "done");
}

// Test 2 - error mapping.
{
  const cases = [
    [401, "auth"],
    [402, "credit"],
    [429, "rate"],
    [400, "context"],
    [500, "network"]
  ];
  for (const [status, code] of cases) {
    const events = [];
    const result = await runAgent({
      config,
      prompts,
      tools,
      context: { youmd: "", history: null, mood: "" },
      query: "q",
      onEvent: (e) => events.push(e),
      signal: null,
      fetchImpl: async () => ({ ok: false, status, text: async () => "boom" })
    });
    const errors = events.filter((e) => e.type === "error");
    assert.equal(errors.length, 1, "expected one error for status " + status);
    assert.equal(errors[0].code, code, "wrong code for status " + status);
    assert.equal(result.picks.length, 0);
  }
}

// Test 3 - missing key.
{
  const events = [];
  const result = await runAgent({
    config: { ...config, apiKey: "" },
    prompts,
    tools,
    context: { youmd: "", history: null, mood: "" },
    query: "q",
    onEvent: (e) => events.push(e),
    signal: null,
    fetchImpl: async () => {
      throw new Error("should not fetch without an api key");
    }
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "error");
  assert.equal(events[0].code, "auth");
  assert.equal(result.picks.length, 0);
}

// Test 4 - abort.
{
  const events = [];
  const result = await runAgent({
    config,
    prompts,
    tools,
    context: { youmd: "", history: null, mood: "" },
    query: "q",
    onEvent: (e) => events.push(e),
    signal: AbortSignal.abort(),
    fetchImpl: async () => {
      throw new Error("should not fetch after abort");
    }
  });
  const errors = events.filter((e) => e.type === "error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "aborted");
  assert.equal(result.picks.length, 0);
}

console.log("check_agent OK");
