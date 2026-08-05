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

function firstObservedId(messages) {
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
      for (const ids of candidates) {
        if (Array.isArray(ids) && typeof ids[0] === "string" && ids[0].trim()) return ids[0];
      }
      if (Array.isArray(parsed?.result)) {
        const first = parsed.result.find((item) => typeof item?.id === "string" && item.id.trim());
        if (first) return first.id;
      }
    } catch {
      // A failed tool result has no observed ID and produces an empty queue.
    }
  }
  return null;
}

function handleChatCompletion(response, body) {
  const messages = messagesFrom(body);
  const toolsPresent = Array.isArray(body?.tools) && body.tools.length > 0;
  const forceTimeout = hasForceTimeout(messages);

  if (toolsPresent && !hasToolResult(messages)) {
    if (forceTimeout) {
      sendJson(response, 200, toolCall("while (true) {}"));
      return;
    }
    sendJson(response, 200, toolCall(
      'const rows = helpers.search("funny comedy", { limit: 5 }); return rows.slice(0, 5).map(({id,t,y,r,s}) => ({id,t,y,r,s}));'
    ));
    return;
  }

  if (toolsPresent) {
    sendJson(response, 200, chatCompletion({
      role: "assistant",
      content: "Catalog analysis complete."
    }));
    return;
  }

  const observedId = forceTimeout ? null : firstObservedId(messages);
  sendJson(response, 200, chatCompletion({
    role: "assistant",
    content: JSON.stringify({
      reply: observedId
        ? "**A funny comedy is ready to watch.**"
        : "**Catalog analysis timed out.** Try another search.",
      queue: observedId ? [observedId] : []
    })
  }));
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
