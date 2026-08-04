import assert from "node:assert/strict";
import {
  callChatCompletion,
  createChatCompletionsUrl
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

console.log("check_llm_client: OK");
