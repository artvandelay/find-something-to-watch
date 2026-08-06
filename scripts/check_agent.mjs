import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runAgent } from "../docs/js/agent.js";

const tools = {
  schemas: [{
    type: "function",
    function: {
      name: "run_catalog_js",
      description: "d",
      parameters: { type: "object", properties: {}, required: [] }
    }
  }],
  handlers: {
    run_catalog_js: async () => ({ count: 1, results: [{ id: "netflix:1", t: "A" }] })
  },
  resolve: async (ids) => {
      const known = new Map([
        ["netflix:1", {
          id: "netflix:1", t: "A", y: 2020, k: "movie", rt: 90, r: 7,
          p: ["netflix"], l: "en", g: ["Comedy"], u: { netflix: "https://x/1" }, img: null
        }]
      ]);
      const results = ids.map((id) => known.get(id)).filter(Boolean);
      return results;
  }
};

const prompts = JSON.parse(await readFile(
  new URL("../docs/assets/prompts.json", import.meta.url),
  "utf8"
));
const config = { baseUrl: "https://fake/v1", apiKey: "sk-test", model: "m" };

assert.equal(prompts.version, 4);
assert.match(prompts.rerank, /unordered or ordered lists/);
assert.match(prompts.rerank, /Never emit raw HTML/);
assert.match(prompts.rerank, /Do not return JSON/);
assert.match(prompts.planner, /why would I like it/);
assert.match(prompts.planner, /Omit "queue"/);
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
  const encoder = new TextEncoder();
  const streaming = {
    ...payload,
    choices: Array.isArray(payload.choices)
      ? payload.choices.map((choice) => choice?.message ? { ...choice, delta: choice.message } : choice)
      : payload.choices
  };
  const chunks = [
    encoder.encode("data: " + JSON.stringify(streaming) + "\n\n"),
    encoder.encode("data: [DONE]\n\n")
  ];
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      pull(controller) {
        if (index >= chunks.length) controller.close();
        else controller.enqueue(chunks[index++]);
      }
    })
  };
}

// Test 1 - happy path, with a queue update.
{
  const fetchImpl = sequenceFetch([
    ok({
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6, cost: 0.001 },
      choices: [{
        message: {
          role: "assistant",
          tool_calls: [{
            id: "c1",
            type: "function",
            function: { name: "run_catalog_js", arguments: "{}" }
          }]
        }
      }]
    }),
    ok({
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4, cost: 0.001 },
      choices: [{ message: { role: "assistant", content: "{\"queue\":[{\"id\":\"netflix:1\",\"reason\":\"A focused fit\"}]}" } }]
    }),
    ok({
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, cost: 0.002 },
      choices: [{
        message: {
          role: "assistant",
          content: "Try Space Heist tonight."
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

  assert.ok(events.some((e) => e.type === "tool_call" && e.name === "run_catalog_js"));
  assert.ok(events.some((e) => e.type === "tool_result" && e.count === 1));
  assert.equal(result.ok, true);
  assert.equal(result.reply, "Try Space Heist tonight.");
  // duplicates removed, unresolved id dropped, order preserved.
  assert.deepStrictEqual(result.queue, [{ id: "netflix:1", reason: "A focused fit" }]);
  const done = events.at(-1);
  assert.equal(done.type, "done");
  assert.equal(done.reply, "Try Space Heist tonight.");
  assert.deepStrictEqual(done.queue, [{ id: "netflix:1", reason: "A focused fit" }]);
  assert.equal(typeof done.turnId, "string");
  assert.deepStrictEqual(done.usage, {
    promptTokens: 9,
    completionTokens: 6,
    totalTokens: 15,
    requestCount: 3
  });
  assert.deepStrictEqual(done.billing, {
    basis: "provider_reported",
    amountUsd: 0.004,
    complete: true,
    requestCount: 3,
    pricedRequestCount: 3
  });
  assert.ok(done.timing.totalMs >= 0);
  assert.ok(done.timing.firstTokenMs !== null && done.timing.firstTokenMs >= 0);
  assert.equal(done.usage.requestCount, 3);
  assert.ok(events.some((event) => event.type === "status" && event.phase === "PLANNING"));
  assert.ok(events.some((event) => event.type === "status" && event.phase === "SEARCHING CATALOG"));
  assert.ok(events.some((event) => event.type === "status" && event.phase === "ANALYZING MATCHES"));
  assert.ok(events.some((event) => event.type === "status" && event.phase === "WRITING"));
  assert.ok(events.some((event) => event.type === "delta" && event.text === "Try Space Heist tonight."));
}

// Test 1a - agent uses the shared client and preserves safe Markdown replies.
{
  const requests = [];
  const responses = [
    ok({ choices: [{ message: { role: "assistant", content: "{\"queue\":[]}" } }] }),
    ok({
      choices: [{
        message: {
          role: "assistant",
          content: "**Solar Drift** is a *quiet* pick.\n\n- Its `94-minute` runtime fits tonight."
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
  assert.equal(requests[0].body.stream, true);
  const contextMessage = requests[0].body.messages[2].content;
  assert.match(contextMessage, /Source: Watched\.json \(json; 2 records\)/);
  assert.match(contextMessage, /Other: Unclassified documentary/);
  assert.equal(result.reply, "**Solar Drift** is a *quiet* pick.\n\n- Its `94-minute` runtime fits tonight.");
  assert.deepStrictEqual(result.queue, []);
}

// Test 1b - omitted queue key means "leave the display unchanged" (null, not []).
{
  const fetchImpl = sequenceFetch([
    ok({ choices: [{ message: { role: "assistant", content: "{}" } }] }),
    ok({
      choices: [{
        message: { role: "assistant", content: "Could you say more about the mood?" }
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
    ok({ choices: [{ message: { role: "assistant", content: "{\"queue\":[]}" } }] }),
    ok({
      choices: [{
        message: { role: "assistant", content: "Nothing fits, clearing your tray." }
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

// Test 6 - catalog manifests are bounded and dangling turns are not forwarded.
{
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return requests.length === 1
      ? ok({ choices: [{ message: { role: "assistant", content: "{}" } }] })
      : ok({ choices: [{ message: { role: "assistant", content: "Done." } }] });
  };
  const result = await runAgent({
    config,
    prompts,
    tools,
    context: { catalogManifest: "x".repeat(9000), youmd: "", history: null, mood: "" },
    query: "q",
    conversation: [{ role: "user", content: "unanswered turn" }],
    onEvent: () => {},
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(requests[0].messages[1].content.includes("does not include critic reviews"), true);
  assert.equal(requests[0].messages[3].role, "system");
  assert.match(requests[0].messages[3].content, /Current recommendations/);
  assert.equal(requests[0].messages[4].role, "system");
  assert.equal(requests[0].messages[4].content.length, "## Catalog manifest\n".length + 8000);
  assert.equal(requests[0].messages[5].content.includes("Viewer's latest message: q"), true);
  assert.equal(result.contextDiagnostics.conversation.includedTurns, 0);
  assert.equal(result.contextDiagnostics.conversation.droppedIncompleteMessages, 1);
}

// Test 6a - prior user and assistant turns both reach the model.
{
  const requests = [];
  const events = [];
  const fetchImpl = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return requests.length === 1
      ? ok({ choices: [{ message: { role: "assistant", content: "{}" } }] })
      : ok({ choices: [{ message: { role: "assistant", content: "Because it matches your mood." } }] });
  };
  const result = await runAgent({
    config,
    prompts,
    tools,
    context: {
      recommendationQueue: {
        source: { conversationId: "c1", turnId: "t1", query: "surreal indian gem" },
        items: [{ id: "netflix:1", t: "My Dear Kuttichathan", reason: "Surreal family fantasy." }]
      },
      youmd: "",
      history: null,
      mood: ""
    },
    query: "why would I like it?",
    conversation: [
      { role: "user", content: "surreal indian gem" },
      { role: "assistant", content: "Try My Dear Kuttichathan." }
    ],
    onEvent: (event) => events.push(event),
    fetchImpl
  });
  assert.equal(result.ok, true);
  const priorContents = requests[0].messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => message.content);
  assert.ok(priorContents.includes("surreal indian gem"));
  assert.ok(priorContents.includes("Try My Dear Kuttichathan."));
  assert.match(requests[0].messages[3].content, /My Dear Kuttichathan \(netflix:1\)/);
  assert.equal(result.queue, null);
  assert.equal(result.contextDiagnostics.queue.includedItems, 1);
  assert.equal(result.contextDiagnostics.conversation.includedTurns, 1);
  assert.equal(result.contextDiagnostics.queue.truncated, false);
  assert.deepEqual(
    events.find((event) => event.type === "context")?.diagnostics,
    result.contextDiagnostics
  );
}

// Test 6b - truncation keeps newest complete turns, not partial ones.
{
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return requests.length === 1
      ? ok({ choices: [{ message: { role: "assistant", content: "{}" } }] })
      : ok({ choices: [{ message: { role: "assistant", content: "Done." } }] });
  };
  const oldUser = "u".repeat(6000);
  const oldAssistant = "a".repeat(6000);
  const recentUser = "r".repeat(6000);
  const recentAssistant = "s".repeat(6000);
  const result = await runAgent({
    config,
    prompts,
    tools,
    context: { youmd: "", history: null, mood: "" },
    query: "follow up",
    conversation: [
      { role: "user", content: oldUser },
      { role: "assistant", content: oldAssistant },
      { role: "user", content: recentUser },
      { role: "assistant", content: recentAssistant },
      { role: "user", content: "dangling failed turn" }
    ],
    onEvent: () => {},
    fetchImpl
  });
  assert.equal(result.ok, true);
  const priorContents = requests[0].messages
    .filter((message) => (message.role === "user" || message.role === "assistant")
      && !String(message.content).includes("Viewer's latest message:"))
    .map((message) => message.content);
  assert.ok(!priorContents.includes(oldUser));
  assert.ok(!priorContents.includes(oldAssistant));
  assert.deepEqual(priorContents, [recentUser, recentAssistant]);
  assert.equal(result.contextDiagnostics.conversation.droppedTurns, 1);
  assert.equal(result.contextDiagnostics.conversation.droppedIncompleteMessages, 1);
}

// Test 7 - the OpenRouter web tool is advertised only for its exact hostname.
{
  for (const [baseUrl, webSearch, expected] of [
    ["https://openrouter.ai/api/v1", true, true],
    ["https://api.openrouter.ai/v1", true, false],
    ["https://openrouter.ai/api/v1", false, false]
  ]) {
    const requests = [];
    const fetchImpl = async (url, init) => {
      requests.push(JSON.parse(init.body));
      return requests.length === 1
        ? ok({ choices: [{ message: { role: "assistant", content: "{}" } }] })
        : ok({ choices: [{ message: { role: "assistant", content: "Done." } }] });
    };
    const result = await runAgent({
      config: { ...config, baseUrl, webSearch },
      prompts,
      tools,
      context: { youmd: "", history: null, mood: "" },
      query: "q",
      conversation: [],
      onEvent: () => {},
      fetchImpl
    });
    assert.equal(result.ok, true);
    assert.equal(
      requests[0].tools.some((tool) => tool.type === "openrouter:web_search"),
      expected
    );
    assert.equal("tools" in requests[1], false);
  }
}

// Test 7a - reception guidance differs when OpenRouter web search is enabled.
{
  let offRequests = [];
  const off = await runAgent({
    config: { ...config, baseUrl: "https://openrouter.ai/api/v1", webSearch: false },
    prompts,
    tools,
    context: { youmd: "", history: null, mood: "" },
    query: "tell me about the reviews",
    conversation: [],
    onEvent: () => {},
    fetchImpl: async (url, init) => {
      offRequests.push(JSON.parse(init.body));
      return offRequests.length === 1
        ? ok({ choices: [{ message: { role: "assistant", content: "{}" } }] })
        : ok({ choices: [{ message: { role: "assistant", content: "Done." } }] });
    }
  });
  assert.equal(off.ok, true);
  assert.match(offRequests[0].messages[1].content, /does not include critic reviews/);

  let onRequests = [];
  const on = await runAgent({
    config: { ...config, baseUrl: "https://openrouter.ai/api/v1", webSearch: true },
    prompts,
    tools,
    context: { youmd: "", history: null, mood: "" },
    query: "tell me about the reviews",
    conversation: [],
    onEvent: () => {},
    fetchImpl: async (url, init) => {
      onRequests.push(JSON.parse(init.body));
      return onRequests.length === 1
        ? ok({ choices: [{ message: { role: "assistant", content: "{}" } }] })
        : ok({ choices: [{ message: { role: "assistant", content: "Done." } }] });
    }
  });
  assert.equal(on.ok, true);
  assert.match(onRequests[0].messages[1].content, /you may use web search during planning/);
  assert.match(onRequests[0].messages.at(-1).content, /you may use web search during this planning phase/);
}

// Test 8 - the internal deadline aborts asynchronous tool handlers.
{
  const events = [];
  const hangingTools = {
    schemas: tools.schemas,
    handlers: {
      run_catalog_js: async (args, signal) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("timed out"), { name: "AbortError" })));
      })
    },
    resolve: tools.resolve
  };
  const result = await runAgent({
    config,
    prompts,
    tools: hangingTools,
    context: { youmd: "", history: null, mood: "" },
    query: "q",
    conversation: [],
    onEvent: (event) => events.push(event),
    budget: { maxMs: 10 },
    fetchImpl: sequenceFetch([ok({
      choices: [{
        message: {
          role: "assistant",
          tool_calls: [{
            id: "timeout",
            type: "function",
            function: { name: "run_catalog_js", arguments: "{}" }
          }]
        }
      }]
    })])
  });
  assert.equal(result.ok, false);
  assert.equal(events.at(-1).code, "budget");
}

console.log("check_agent OK");
