import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 8916;
const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(here, "..", "docs");
const requestBodies = [];

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp"
};

const browserFixtureRecords = [
  "Fixture Comedy", "Fixture Thriller", "Fixture Series", "Fixture Drama", "Fixture Adventure"
].map((t, index) => ({
  id: "tmdb:fixture-" + (index + 1),
  t,
  y: 2020 + index,
  k: index === 2 ? "series" : "movie",
  rt: 90 + index,
  s: "Deterministic browser fixture.",
  im: null,
  r: 8 - (index / 10),
  p: ["netflix"],
  u: { netflix: "https://example.test/netflix/fixture-" + (index + 1) },
  img: null,
  l: "en",
  g: ["Comedy"],
  v: 20
}));

const browserFixtureCatalog = {
  schema: 2,
  meta: {
    region: "IN",
    source: "deterministic-browser-fixture",
    built_at: "2026-08-05T00:00:00Z",
    count: browserFixtureRecords.length,
    provider_order: ["netflix"],
    providers: { netflix: browserFixtureRecords.length },
    text_file: "catalog.text.json"
  },
  records: browserFixtureRecords
};

function send(response, status, body = "", headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(body);
}

function sendJson(response, status, value) {
  send(response, status, JSON.stringify(value), {
    "Content-Type": "application/json; charset=utf-8"
  });
}

function chatCompletion(message) {
  return {
    id: "e2e-catalog-completion",
    object: "chat.completion",
    created: 0,
    model: "e2e/mock",
    choices: [{ index: 0, message, finish_reason: "stop" }]
  };
}

function stream(response, events, { delayMs = 0 } = {}) {
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/event-stream; charset=utf-8",
    "Connection": "keep-alive"
  });
  let closed = false;
  response.once("close", () => { closed = true; });
  const write = (value) => {
    if (!closed) response.write("data: " + JSON.stringify(value) + "\n\n");
  };
  const finish = () => {
    if (closed) return;
    response.write("data: [DONE]\n\n");
    response.end();
  };
  if (delayMs > 0) {
    setTimeout(() => {
      for (const event of events) write(event);
      finish();
    }, delayMs);
    return;
  }
  for (const event of events) write(event);
  finish();
}

function streamMessage(message, usage = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20, cost: 0.0042 }) {
  const delta = { role: "assistant" };
  if (message.content !== null && message.content !== undefined) delta.content = message.content;
  if (message.tool_calls) delta.tool_calls = message.tool_calls;
  return [
    { id: "e2e-stream", model: "e2e/mock", choices: [{ index: 0, delta }] },
    { choices: [], usage }
  ];
}

function toolCall(code) {
  return chatCompletion({
    role: "assistant",
    content: null,
    tool_calls: [{
      id: "e2e-run-catalog-js",
      type: "function",
      function: {
        name: "run_catalog_js",
        arguments: JSON.stringify({ code })
      }
    }]
  });
}

function messagesFrom(body) {
  return Array.isArray(body?.messages) ? body.messages : [];
}

function hasToolResult(messages) {
  return messages.some((message) => message?.role === "tool");
}

function hasForceTimeout(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    return String(message.content || "").toLowerCase().includes("force worker timeout");
  }
  return false;
}

function observedIds(messages) {
  const ids = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "tool" || typeof message.content !== "string") continue;
    try {
      const parsed = JSON.parse(message.content);
      const candidates = [
        parsed?.observedIds,
        parsed?.value?.observedIds,
        parsed?.result?.observedIds
      ];
      for (const candidateIds of candidates) {
        if (!Array.isArray(candidateIds)) continue;
        for (const id of candidateIds) {
          if (typeof id === "string" && id.trim() && !ids.includes(id)) ids.push(id);
        }
      }
      if (Array.isArray(parsed?.result)) {
        for (const item of parsed.result) {
          if (typeof item?.id === "string" && item.id.trim() && !ids.includes(item.id)) ids.push(item.id);
        }
      }
    } catch {
      // A failed tool result contributes no observed IDs.
    }
  }
  return ids;
}

function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return String(messages[index].content || "").toLowerCase();
  }
  return "";
}

function handleChatCompletion(response, body) {
  const messages = messagesFrom(body);
  const toolsPresent = Array.isArray(body?.tools) && body.tools.length > 0;
  const forceTimeout = hasForceTimeout(messages);
  const requestText = messages.map((message) => String(message?.content || "")).join("\n").toLowerCase();
  const wantsFailure = requestText.includes("fixture failure");
  const wantsSlow = requestText.includes("fixture slow");

  if (toolsPresent && !hasToolResult(messages)) {
    if (forceTimeout) {
      stream(response, streamMessage(toolCall("while (true) {}").choices[0].message));
      return;
    }
    stream(response, streamMessage(toolCall(
      'const rows = helpers.search("fixture", { limit: 5 }); return rows.slice(0, 5).map(({id,t,y,r,s}) => ({id,t,y,r,s}));'
    ).choices[0].message));
    return;
  }

  if (toolsPresent) {
    const ids = observedIds(messages);
    stream(response, streamMessage(chatCompletion({
      role: "assistant",
      content: JSON.stringify({
        queue: ids.map((id, index) => ({
          id,
          reason: "Catalog-grounded fixture match " + (index + 1) + "."
        })),
        memoryCandidates: []
      })
    }).choices[0].message));
    return;
  }

  if (wantsFailure) {
    sendJson(response, 503, { error: { message: "Fixture failure." } });
    return;
  }
  const observedId = forceTimeout ? null : observedIds(messages)[0];
  const responseMessage = chatCompletion({
    role: "assistant",
    content: observedId
      ? "**A funny comedy is ready to watch.**"
      : "**Catalog analysis timed out.** Try another search."
  }).choices[0].message;
  stream(response, streamMessage(responseMessage), { delayMs: wantsSlow ? 21000 : 0 });
}

function staticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = resolve(docsRoot, "." + decoded);
  if (candidate !== docsRoot && !candidate.startsWith(docsRoot + sep)) return null;
  return candidate;
}

async function serveStatic(request, response, pathname) {
  if (pathname === "/assets/catalog.json") {
    sendJson(response, 200, browserFixtureCatalog);
    return;
  }
  if (pathname === "/assets/catalog.text.json") {
    sendJson(response, 200, { schema: 2, count: browserFixtureRecords.length, s: {} });
    return;
  }
  let filePath = staticPath(pathname);
  if (!filePath) {
    send(response, 403, "Forbidden");
    return;
  }
  try {
    if ((await stat(filePath)).isDirectory()) filePath = resolve(filePath, "index.html");
    const body = await readFile(filePath);
    send(response, 200, request.method === "HEAD" ? "" : body, {
      "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream"
    });
  } catch {
    send(response, 404, "Not found");
  }
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://" + host);

  if (request.method === "GET" && url.pathname === "/__e2e__/requests") {
    sendJson(response, 200, requestBodies);
    return;
  }

  if (request.method === "POST" && url.pathname === "/mock/v1/chat/completions") {
    const raw = await readRequestBody(request);
    requestBodies.push(raw);
    try {
      handleChatCompletion(response, JSON.parse(raw));
    } catch {
      sendJson(response, 400, { error: "Malformed request body." });
    }
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    await serveStatic(request, response, url.pathname);
    return;
  }

  send(response, 404, "Not found");
});

server.listen(port, host, () => {
  console.log("E2E_SERVER_READY http://127.0.0.1:8916");
});
