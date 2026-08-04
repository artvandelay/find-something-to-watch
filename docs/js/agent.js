// Agent loop. No DOM, no localStorage, no imports: fetch is injected so this
// module can run under Node for tests. Requests are never streamed.

const DEFAULT_BUDGET = { maxSteps: 8, maxMs: 120000 };
const MAX_QUEUE_IDS = 20;
const MAX_QUERY_CHARACTERS = 6000;
const MAX_YOUMD_CONTEXT_CHARACTERS = 8000;
const MAX_CONVERSATION_CONTEXT_CHARACTERS = 18000;
const MAX_CATALOG_MANIFEST_CHARACTERS = 8000;

function mapError(status) {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "credit";
  if (status === 429) return "rate";
  if (status === 400 || status === 413) return "context";
  return "network";
}

function errorMessage(code, status) {
  if (code === "auth") return "Your API key was rejected. Check it in Settings.";
  if (code === "credit") return "Your account is out of credit.";
  if (code === "rate") return "Rate limited by the provider. Wait a moment and retry.";
  if (code === "context") return "The request was too large or malformed.";
  return "Request failed with status " + status + ".";
}

async function callLlm(config, body, fetchImpl, signal) {
  let endpoint;
  try {
    endpoint = new URL("chat/completions", String(config.baseUrl || "").replace(/\/?$/, "/"));
  } catch {
    const err = new Error("Enter an absolute HTTP(S) model base URL in Settings.");
    err.code = "config";
    throw err;
  }
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    const err = new Error("The model base URL must use HTTP or HTTPS.");
    err.code = "config";
    throw err;
  }
  const res = await fetchImpl(endpoint.href, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + config.apiKey
    },
    body: JSON.stringify({ ...body, model: config.model, stream: false }),
    signal
  });
  if (!res.ok) {
    await res.text();
    const code = mapError(res.status);
    const err = new Error(errorMessage(code, res.status));
    err.code = code;
    throw err;
  }
  return await res.json();
}

// Sent as its own system message. This directly reaches the configured LLM
// endpoint — see CONTRACT.md and the app's privacy copy for what "local-only"
// does and does not cover here.
function buildContextBlock(context) {
  const ctx = context || {};
  let out = "## Mood\n" + (ctx.mood || "no preference");
  if (typeof ctx.youmd === "string" && ctx.youmd.trim() !== "") {
    out += "\n\n## About the viewer (You.md)\n" + ctx.youmd.slice(0, MAX_YOUMD_CONTEXT_CHARACTERS);
  }
  if (ctx.history !== null && ctx.history !== undefined) {
    out += "\n\n## Recently watched\n";
    const series = Array.isArray(ctx.history.series) ? ctx.history.series.slice(0, 20) : [];
    const movies = Array.isArray(ctx.history.movies) ? ctx.history.movies.slice(0, 20) : [];
    const lines = [];
    for (const s of series) {
      lines.push(("- " + s.name + " (" + s.episodes + " episodes)").slice(0, 240));
    }
    for (const m of movies) {
      lines.push(("- " + (typeof m === "string" ? m : m.title)).slice(0, 240));
    }
    out += lines.join("\n");
    out += "\n\nDo not recommend anything in the Recently watched list unless the viewer explicitly asks for a rewatch.";
  }
  return out;
}

function buildCatalogManifestBlock(context) {
  const manifest = context && context.catalogManifest;
  if (manifest === null || manifest === undefined) return "## Catalog manifest\nNot supplied.";
  let text;
  try {
    text = typeof manifest === "string" ? manifest : JSON.stringify(manifest);
  } catch {
    text = "Unavailable.";
  }
  return "## Catalog manifest\n" + String(text || "Unavailable.").slice(0, MAX_CATALOG_MANIFEST_CHARACTERS);
}

function addUsage(total, chunk) {
  if (!chunk) return total;
  const next = total || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  next.prompt_tokens += chunk.prompt_tokens || 0;
  next.completion_tokens += chunk.completion_tokens || 0;
  next.total_tokens = next.prompt_tokens + next.completion_tokens;
  return next;
}

function stripFence(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
}

// Prior turns from the bounded conversation, converted into real chat
// messages so the model can follow a multi-turn thread instead of treating
// every call as a fresh one-shot query.
function priorTurnMessages(conversation) {
  if (!Array.isArray(conversation)) return [];
  const candidates = [];
  for (const m of conversation) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    if (typeof m.content !== "string" || m.content === "") continue;
    candidates.push({ role: m.role, content: m.content.slice(0, MAX_QUERY_CHARACTERS) });
  }
  const out = [];
  let used = 0;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const message = candidates[i];
    if (used + message.content.length > MAX_CONVERSATION_CONTEXT_CHARACTERS) break;
    out.unshift(message);
    used += message.content.length;
  }
  if (out[0]?.role === "assistant") out.shift();
  return out;
}

function makeAbortError() {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(makeAbortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(makeAbortError());
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", abort);
        reject(err);
      }
    );
  });
}

function isExactOpenRouter(baseUrl) {
  try {
    return new URL(String(baseUrl || "")).hostname === "openrouter.ai";
  } catch {
    return false;
  }
}

function localToolSchemas(tools) {
  const handlers = (tools && tools.handlers) || {};
  const schemas = Array.isArray(tools && tools.schemas) ? tools.schemas : [];
  return schemas.filter((schema) => {
    const name = schema && schema.function && schema.function.name;
    return typeof name === "string" && typeof handlers[name] === "function";
  });
}

function toolResultContent(value) {
  try {
    const content = JSON.stringify(value);
    return typeof content === "string"
      ? content
      : JSON.stringify({ error: "tool returned a non-serializable result" });
  } catch {
    return JSON.stringify({ error: "tool returned a non-serializable result" });
  }
}

function normalizeToolResult(value) {
  if (value === null || value === undefined) return { error: "tool returned no result" };
  try {
    if (typeof JSON.stringify(value) === "string") return value;
  } catch {
    // Replaced with a repairable result below.
  }
  return { error: "tool returned a non-serializable result" };
}

function resultCount(value) {
  return value && typeof value.count === "number" ? value.count : 0;
}

function resolvedIds(value) {
  const records = Array.isArray(value) ? value : Array.isArray(value && value.results) ? value.results : [];
  return new Set(records.map((record) => record && record.id).filter((id) => typeof id === "string"));
}

export async function runAgent(opts) {
  const config = opts.config;
  const prompts = opts.prompts;
  const tools = opts.tools;
  const context = opts.context;
  const query = opts.query;
  const conversation = opts.conversation;
  const emit = typeof opts.onEvent === "function" ? opts.onEvent : function () {};
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const budget = { ...DEFAULT_BUDGET, ...(opts.budget || {}) };
  const maxMs = Number.isFinite(budget.maxMs) ? Math.max(0, budget.maxMs) : DEFAULT_BUDGET.maxMs;
  const maxSteps = Number.isFinite(budget.maxSteps) ? Math.max(0, budget.maxSteps) : DEFAULT_BUDGET.maxSteps;
  const externalSignal = opts.signal || null;
  const controller = new AbortController();
  let externallyAborted = false;
  let timedOut = false;
  const abortFromUser = () => {
    externallyAborted = true;
    if (!controller.signal.aborted) controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) abortFromUser();
    else externalSignal.addEventListener("abort", abortFromUser, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    if (!controller.signal.aborted) controller.abort();
  }, maxMs);

  let usage = null;
  const fail = () => ({ ok: false, reply: "", queue: null, usage });
  const abortFailure = () => {
    if (externallyAborted || (externalSignal && externalSignal.aborted)) {
      emit({ type: "error", code: "aborted", message: "Stopped." });
    } else {
      emit({ type: "error", code: "budget", message: "Search took too long and was stopped." });
    }
    return fail();
  };
  const ensureActive = () => {
    if (controller.signal.aborted) throw makeAbortError();
  };

  try {
    if (typeof config.apiKey !== "string" || config.apiKey.trim() === "") {
      emit({ type: "error", code: "auth", message: "Add an API key in Settings to use the agent." });
      return fail();
    }

    const requestTools = localToolSchemas(tools);
    if (config.webSearch === true && isExactOpenRouter(config.baseUrl)) {
      requestTools.push({ type: "openrouter:web_search" });
    }
    const messages = [
      { role: "system", content: prompts.system },
      { role: "system", content: buildContextBlock(context) },
      { role: "system", content: buildCatalogManifestBlock(context) },
      { role: "system", content: prompts.output },
      ...priorTurnMessages(conversation),
      {
        role: "user",
        content: prompts.planner.replace("{{QUERY}}", String(query || "").slice(0, MAX_QUERY_CHARACTERS))
      }
    ];

    emit({ type: "status", text: "Planning search" });

    let finalText = null;
    for (let step = 0; step < maxSteps; step++) {
      ensureActive();

      const data = await abortable(
        callLlm(
          config,
          { messages, tools: requestTools, tool_choice: "auto" },
          fetchImpl,
          controller.signal
        ),
        controller.signal
      );
      usage = addUsage(usage, data.usage);

      const msg = data.choices[0].message;
      messages.push(msg);

      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        for (const call of msg.tool_calls) {
          ensureActive();
          const name = call && call.function && typeof call.function.name === "string"
            ? call.function.name
            : "unknown";
          const toolCallId = call && typeof call.id === "string" ? call.id : "";
          let args;
          let result = null;
          try {
            args = JSON.parse((call && call.function && call.function.arguments) || "{}");
            if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("tool arguments must be a JSON object");
          } catch {
            args = {};
            result = { error: "tool arguments must be valid JSON object" };
          }
          emit({ type: "tool_call", name, args });

          const handler = tools && tools.handlers && tools.handlers[name];
          if (result) {
            // The role:tool result gives the model a chance to repair its call.
          } else if (name === "openrouter:web_search" || typeof handler !== "function") {
            result = { error: "unknown tool" };
          } else {
            try {
              result = normalizeToolResult(
                await abortable(Promise.resolve(handler(args, controller.signal)), controller.signal)
              );
            } catch (err) {
              if (err && err.name === "AbortError") throw err;
              result = { error: String((err && err.message) || err) };
            }
          }
          const content = toolResultContent(result);
          emit({ type: "tool_result", name, count: resultCount(result) });
          messages.push({ role: "tool", tool_call_id: toolCallId, content });
        }
        continue;
      }

      finalText = typeof msg.content === "string" ? msg.content : "";
      break;
    }

    if (finalText === null) {
      emit({ type: "error", code: "budget", message: "The model kept searching without answering." });
      return fail();
    }

    let parsed;
    try {
      parsed = JSON.parse(stripFence(finalText));
    } catch (err) {
      emit({ type: "error", code: "parse", message: "The model did not return valid JSON." });
      return fail();
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      emit({ type: "error", code: "parse", message: "The model did not return a JSON object." });
      return fail();
    }

    const reply = typeof parsed.reply === "string" ? parsed.reply : "";
    if (reply.trim() === "") {
      emit({ type: "error", code: "parse", message: "The model response needs a non-empty reply." });
      return fail();
    }

    // queue stays null ("leave the display unchanged") unless the model
    // explicitly included a queue key, even an empty array ("clear it").
    let queue = null;
    if (Array.isArray(parsed.queue)) {
      const seen = new Set();
      const rawIds = [];
      for (const id of parsed.queue) {
        if (typeof id !== "string" || id.trim() === "" || seen.has(id)) continue;
        seen.add(id);
        rawIds.push(id);
        if (rawIds.length === MAX_QUEUE_IDS) break;
      }
      if (rawIds.length > 0) {
        const resolved = await abortable(Promise.resolve(tools.resolve(rawIds, controller.signal)), controller.signal);
        const foundIds = resolvedIds(resolved);
        queue = rawIds.filter((id) => foundIds.has(id));
      } else {
        queue = [];
      }
    }

    return { ok: true, reply, queue, usage };
  } catch (err) {
    if (externallyAborted || (externalSignal && externalSignal.aborted)) {
      return abortFailure();
    } else if (timedOut) {
      return abortFailure();
    } else if (err && err.name === "AbortError") {
      emit({ type: "error", code: "aborted", message: "Stopped." });
    } else {
      emit({ type: "error", code: (err && err.code) || "network", message: err && err.message });
    }
    return fail();
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", abortFromUser);
  }
}
