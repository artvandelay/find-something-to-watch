import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
    get_titles: async (args) => {
      const known = new Map([
        ["netflix:1", {
          id: "netflix:1", t: "A", y: 2020, k: "movie", rt: 90, r: 7,
          p: ["netflix"], l: "en", g: ["Comedy"], u: { netflix: "https://x/1" }, img: null
        }]
      ]);
      const ids = Array.isArray(args?.ids) ? args.ids : [];
      const results = ids.map((id) => known.get(id)).filter(Boolean);
      return { count: results.length, results };
    }
  }
};

const prompts = JSON.parse(await readFile(
  new URL("../docs/assets/prompts.json", import.meta.url),
  "utf8"
));
const config = { baseUrl: "https://fake/v1", apiKey: "sk-test", model: "m" };

assert.equal(prompts.version, 2);
assert.match(prompts.rerank, /unordered or ordered lists/);
assert.match(prompts.rerank, /Never emit raw HTML/);
assert.match(prompts.history_plan, /bounded sample/);
assert.match(prompts.history_plan, /"schema": 1/);

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

// Test 1 - happy path, with a queue update.
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
          content: "{\"reply\":\"Try Space Heist tonight.\",\"queue\":[\"netflix:1\",\"netflix:1\",\"nope:9\"]}"
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
    conversation: [{ role: "user", content: "hey" }, { role: "assistant", content: "hi there" }],
    onEvent: (e) => events.push(e),
    signal: null,
    fetchImpl
  });

  assert.ok(events.some((e) => e.type === "tool_call" && e.name === "search_titles"));
  assert.ok(events.some((e) => e.type === "tool_result" && e.count === 1));
  assert.equal(result.ok, true);
  assert.equal(result.reply, "Try Space Heist tonight.");
  // duplicates removed, unresolved id dropped, order preserved.
  assert.deepStrictEqual(result.queue, ["netflix:1"]);
  const done = events.at(-1);
  assert.equal(done.type, "done");
  assert.equal(done.reply, "Try Space Heist tonight.");
  assert.deepStrictEqual(done.queue, ["netflix:1"]);
}

// Test 1a - agent uses the shared client and preserves safe Markdown replies.
{
  const requests = [];
  const responses = [
    ok({ choices: [{ message: { role: "assistant", content: "I have enough." } }] }),
    ok({
      choices: [{
        message: {
          role: "assistant",
          content: "{\"reply\":\"**Solar Drift** is a *quiet* pick.\\n\\n- Its `94-minute` runtime fits tonight.\",\"queue\":[]}"
        }
      }]
    })
  ];
  const fetchImpl = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body), signal: init.signal });
    const response = responses.shift();
    if (!response) throw new Error("unexpected extra fetch call");
    return response;
  };

  const result = await runAgent({
    config,
    prompts,
    tools,
    context: {
      youmd: "",
      mood: "",
      history: {
        sources: [{ name: "Watched.json", format: "json", records: 2 }],
        series: [],
        movies: [],
        other: [{ title: "Unclassified documentary", lastWatched: null }]
      }
    },
    query: "something calm",
    conversation: [],
    onEvent: () => {},
    fetchImpl
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://fake/v1/chat/completions");
  assert.equal(requests[0].body.model, "m");
  assert.equal(requests[0].body.stream, false);
  const contextMessage = requests[0].body.messages[1].content;
  assert.match(contextMessage, /Source: Watched\.json \(json; 2 records\)/);
  assert.match(contextMessage, /Other: Unclassified documentary/);
  assert.equal(result.reply, "**Solar Drift** is a *quiet* pick.\n\n- Its `94-minute` runtime fits tonight.");
  assert.deepStrictEqual(result.queue, []);
}

// Test 1b - omitted queue key means "leave the display unchanged" (null, not []).
{
  const fetchImpl = sequenceFetch([
    ok({ choices: [{ message: { role: "assistant", content: "sure, one sec" } }] }),
    ok({
      choices: [{
        message: { role: "assistant", content: "{\"reply\":\"Could you say more about the mood?\"}" }
      }]
    })
  ]);

  const events = [];
  const result = await runAgent({
    config,
    prompts,
    tools,
    context: { youmd: "", history: null, mood: "" },
    query: "something",
    conversation: [],
    onEvent: (e) => events.push(e),
    signal: null,
    fetchImpl
  });

  assert.equal(result.reply, "Could you say more about the mood?");
  assert.equal(result.ok, true);
  assert.equal(result.queue, null);
}

// Test 1c - an explicit empty queue clears the display (distinct from omitted).
{
  const fetchImpl = sequenceFetch([
    ok({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
    ok({
      choices: [{
        message: { role: "assistant", content: "{\"reply\":\"Nothing fits, clearing your tray.\",\"queue\":[]}" }
      }]
    })
  ]);

  const result = await runAgent({
    config,
    prompts,
    tools,
    context: { youmd: "", history: null, mood: "" },
    query: "something",
    conversation: [],
    onEvent: () => {},
    signal: null,
    fetchImpl
  });

  assert.equal(result.ok, true);
  assert.deepStrictEqual(result.queue, []);
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
    assert.equal(result.ok, false);
    assert.equal(result.reply, "");
    assert.equal(result.queue, null);
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
  assert.equal(result.ok, false);
  assert.equal(result.reply, "");
  assert.equal(result.queue, null);
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
  assert.equal(result.ok, false);
  assert.equal(result.reply, "");
  assert.equal(result.queue, null);
}

// Test 5 - invalid base URLs are rejected before the key can be sent.
{
  const events = [];
  let fetched = false;
  const result = await runAgent({
    config: { ...config, baseUrl: "/relative" },
    prompts,
    tools,
    context: { youmd: "", history: null, mood: "" },
    query: "q",
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
