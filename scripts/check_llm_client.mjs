import assert from "node:assert/strict";
import {
  callChatCompletion,
  createChatCompletionsUrl,
  createModelApiUrl,
  streamChatCompletion
} from "../docs/js/llm-client.js";

assert.equal(
  createChatCompletionsUrl("https://openrouter.ai/api/v1"),
  "https://openrouter.ai/api/v1/chat/completions"
);
assert.equal(
  createChatCompletionsUrl("http://localhost:8787/v1/?ignored=1#fragment"),
  "http://localhost:8787/v1/chat/completions"
);
assert.equal(
  createChatCompletionsUrl("https://example.test"),
  "https://example.test/chat/completions"
);
assert.equal(
  createModelApiUrl("https://openrouter.ai/api/v1/?ignored=1#fragment", "models"),
  "https://openrouter.ai/api/v1/models"
);

for (const value of ["", "/api/v1", "//example.test/api", "ftp://example.test/v1", "data:text/plain,x"]) {
  assert.throws(
    () => createChatCompletionsUrl(value),
    (error) => error.code === "config"
  );
}

{
  let calls = 0;
  await assert.rejects(
    callChatCompletion(
      { baseUrl: "/relative", apiKey: "secret", model: "test-model" },
      {},
      { fetchImpl: async () => { calls += 1; } }
    ),
    (error) => error.code === "config"
  );
  assert.equal(calls, 0, "invalid URLs must fail before fetch");
}

{
  const signal = new AbortController().signal;
  let request;
  const payload = { choices: [{ message: { content: "ok" } }] };
  const result = await callChatCompletion(
    { baseUrl: "https://example.test/api/v1", apiKey: "sk-test", model: "chosen-model" },
    { messages: [{ role: "user", content: "hello" }], model: "ignored", stream: true },
    {
      signal,
      fetchImpl: async (url, init) => {
        request = { url, init };
        return { ok: true, status: 200, json: async () => payload };
      }
    }
  );

  assert.strictEqual(result, payload);
  assert.equal(request.url, "https://example.test/api/v1/chat/completions");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(request.init.headers, {
    "Content-Type": "application/json",
    "Authorization": "Bearer sk-test"
  });
  assert.strictEqual(request.init.signal, signal);
  assert.deepEqual(JSON.parse(request.init.body), {
    messages: [{ role: "user", content: "hello" }],
    model: "chosen-model",
    stream: false
  });
}

for (const [status, code] of [
  [400, "context"],
  [401, "auth"],
  [402, "credit"],
  [403, "auth"],
  [413, "context"],
  [429, "rate"],
  [500, "network"]
]) {
  let bodyRead = false;
  await assert.rejects(
    callChatCompletion(
      { baseUrl: "https://example.test/v1", apiKey: "x", model: "m" },
      {},
      {
        fetchImpl: async () => ({
          ok: false,
          status,
          text: async () => { bodyRead = true; }
        })
      }
    ),
    (error) => error.code === code
  );
  assert.equal(bodyRead, true, `status ${status} response body should be consumed`);
}

await assert.rejects(
  callChatCompletion(
    { baseUrl: "https://example.test/v1", apiKey: "x", model: "m" },
    {},
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError("bad json"); }
      })
    }
  ),
  (error) => error.code === "network" && error.cause instanceof SyntaxError
);

{
  const abort = new DOMException("Stopped", "AbortError");
  let caught;
  try {
    await callChatCompletion(
      { baseUrl: "https://example.test/v1", apiKey: "x", model: "m" },
      {},
      { fetchImpl: async () => { throw abort; } }
    );
  } catch (error) {
    caught = error;
  }
  assert.strictEqual(caught, abort, "abort errors must propagate unchanged");
}

function streamFrom(chunks, { onCancel = null } = {}) {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index++]));
    },
    cancel() {
      onCancel?.();
    }
  });
}

{
  const events = [];
  let request;
  const result = await streamChatCompletion(
    { baseUrl: "https://example.test/v1", apiKey: "x", model: "m" },
    { messages: [] },
    {
      onEvent: (event) => events.push(event),
      fetchImpl: async (url, init) => {
        request = { url, init };
        return {
          ok: true,
          status: 200,
          body: streamFrom([
            ": keepalive\r\n\r\n",
            "data: {\"id\":\"stream-1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Hel",
            "lo\"}}]}\r\n\r\n",
            "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_\",\"type\":\"function\",\"function\":{\"name\":\"run_\",\"arguments\":\"{\\\"code\\\":\\\"ret\"}},{\"index\":1,\"id\":\"other\",\"type\":\"function\",\"function\":{\"name\":\"second\",\"arguments\":\"{}\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"1\",\"function\":{\"name\":\"catalog_js\",\"arguments\":\"urn 1\\\"}\"}}]}}]}\n\n",
            "data: {\"choices\":[],\n",
            "data: \"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5,\"cost\":0.004}}\n\n",
            "data: [DONE]\n\n"
          ])
        };
      }
    }
  );
  assert.equal(request.url, "https://example.test/v1/chat/completions");
  assert.equal(JSON.parse(request.init.body).stream, true);
  assert.equal(result.id, "stream-1");
  assert.equal(result.message.content, "Hello");
  assert.equal(result.message.tool_calls.length, 2);
  assert.deepEqual(result.message.tool_calls[0], {
    id: "call_1",
    type: "function",
    function: { name: "run_catalog_js", arguments: "{\"code\":\"return 1\"}" }
  });
  assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0.004 });
  assert.ok(events.some((event) => event.type === "heartbeat"));
  assert.deepEqual(events.filter((event) => event.type === "content"), [{ type: "content", text: "Hello" }]);
}

for (const body of [
  ["data: {\"choices\":[]}\n\n"],
  ["data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"function\":{\"arguments\":\"", "x".repeat(65_537), "\"}}]}}]}\n\n"]
]) {
  await assert.rejects(
    streamChatCompletion(
      { baseUrl: "https://example.test/v1", apiKey: "x", model: "m" },
      {},
      { fetchImpl: async () => ({ ok: true, status: 200, body: streamFrom(body) }) }
    ),
    (error) => error.code === "network"
  );
}

{
  const controller = new AbortController();
  let cancelled = false;
  const pending = streamChatCompletion(
    { baseUrl: "https://example.test/v1", apiKey: "x", model: "m" },
    {},
    {
      signal: controller.signal,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        body: new ReadableStream({
          start() {},
          cancel() { cancelled = true; }
        })
      })
    }
  );
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, true);
}

console.log("check_llm_client: OK");
