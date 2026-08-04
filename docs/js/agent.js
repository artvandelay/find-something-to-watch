// Agent loop. No DOM or localStorage: fetch is injected so this module can run
// under Node for tests. Requests are never streamed.

import { callChatCompletion } from "./llm-client.js";

const DEFAULT_BUDGET = { maxSteps: 8, maxMs: 120000 };
const MAX_QUEUE_IDS = 20;
const MAX_QUERY_CHARACTERS = 6000;
const MAX_YOUMD_CONTEXT_CHARACTERS = 8000;
const MAX_CONVERSATION_CONTEXT_CHARACTERS = 18000;
const MAX_HISTORY_CONTEXT_CHARACTERS = 9600;

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
    const lines = [];
    let used = 0;
    const addLine = (line) => {
      const limited = String(line).slice(0, 240);
      if (used + limited.length + 1 > MAX_HISTORY_CONTEXT_CHARACTERS) return false;
      lines.push(limited);
      used += limited.length + 1;
      return true;
    };
    const sources = Array.isArray(ctx.history.sources) ? ctx.history.sources.slice(0, 4) : [];
    const series = Array.isArray(ctx.history.series) ? ctx.history.series.slice(0, 20) : [];
    const movies = Array.isArray(ctx.history.movies) ? ctx.history.movies.slice(0, 20) : [];
    const other = Array.isArray(ctx.history.other) ? ctx.history.other.slice(0, 20) : [];
    for (const source of sources) {
      const name = typeof source?.name === "string" ? source.name : "Unnamed source";
      const format = typeof source?.format === "string" ? source.format : "unknown";
      const records = Number.isInteger(source?.records) && source.records >= 0
        ? "; " + source.records + " records"
        : "";
      addLine("- Source: " + name + " (" + format + records + ")");
    }
    for (const s of series) {
      addLine("- Series: " + (s?.name || "") + " (" + (s?.episodes || 0) + " episodes)");
    }
    for (const m of movies) {
      addLine("- Movie: " + (typeof m === "string" ? m : m?.title || ""));
    }
    for (const item of other) {
      addLine("- Other: " + (typeof item === "string" ? item : item?.title || ""));
    }
    out += "\n\n## Recently watched\n" + lines.join("\n");
    out += "\n\nDo not recommend anything in the Recently watched list unless the viewer explicitly asks for a rewatch.";
  }
  return out;
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

export async function runAgent(opts) {
  const config = opts.config;
  const prompts = opts.prompts;
  const tools = opts.tools;
  const context = opts.context;
  const query = opts.query;
  const conversation = opts.conversation;
  const emit = typeof opts.onEvent === "function" ? opts.onEvent : function () {};
  const signal = opts.signal || null;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const budget = opts.budget || DEFAULT_BUDGET;

  let usage = null;
  const fail = () => ({ ok: false, reply: "", queue: null, usage });

  try {
    if (typeof config.apiKey !== "string" || config.apiKey.trim() === "") {
      emit({ type: "error", code: "auth", message: "Add an API key in Settings to use the agent." });
      return fail();
    }

    const deadline = Date.now() + budget.maxMs;
    const messages = [
      { role: "system", content: prompts.system },
      { role: "system", content: buildContextBlock(context) },
      ...priorTurnMessages(conversation),
      {
        role: "user",
        content: prompts.planner.replace("{{QUERY}}", String(query || "").slice(0, MAX_QUERY_CHARACTERS))
      }
    ];

    emit({ type: "status", text: "Planning search" });

    let finalText = null;
    for (let step = 0; step < budget.maxSteps; step++) {
      if (signal && signal.aborted) {
        emit({ type: "error", code: "aborted", message: "Stopped." });
        return fail();
      }
      if (Date.now() > deadline) {
        emit({ type: "error", code: "budget", message: "Search took too long and was stopped." });
        return fail();
      }

      const data = await callChatCompletion(
        config,
        { messages, tools: tools.schemas, tool_choice: "auto" },
        { fetchImpl, signal }
      );
      usage = addUsage(usage, data.usage);

      const msg = data.choices[0].message;
      messages.push(msg);

      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        for (const call of msg.tool_calls) {
          const name = call.function.name;
          let args = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch (err) {
            args = {};
          }
          emit({ type: "tool_call", name, args });

          const handler = tools.handlers[name];
          let result;
          if (!handler) {
            result = { error: "unknown tool" };
          } else {
            try {
              result = await handler(args);
            } catch (err) {
              result = { error: String(err.message) };
            }
          }
          emit({ type: "tool_result", name, count: result.count ?? 0 });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
        continue;
      }

      finalText = msg.content || "";
      break;
    }

    if (finalText === null) {
      emit({ type: "error", code: "budget", message: "The model kept searching without answering." });
      return fail();
    }

    emit({ type: "status", text: "Writing a reply" });

    messages.push({ role: "user", content: prompts.rerank });
    const finalData = await callChatCompletion(
      config,
      { messages },
      { fetchImpl, signal }
    );
    usage = addUsage(usage, finalData.usage);

    let parsed;
    try {
      parsed = JSON.parse(stripFence(finalData.choices[0].message.content));
    } catch (err) {
      emit({ type: "error", code: "parse", message: "The model did not return valid JSON." });
      return fail();
    }

    const reply = typeof parsed.reply === "string" ? parsed.reply : "";

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
        const resolved = await tools.handlers.get_titles({ ids: rawIds });
        const foundIds = new Set(((resolved && resolved.results) || []).map((r) => r.id));
        queue = rawIds.filter((id) => foundIds.has(id));
      } else {
        queue = [];
      }
    }

    emit({ type: "done", reply, queue, usage });
    return { ok: true, reply, queue, usage };
  } catch (err) {
    if (err && err.name === "AbortError") {
      emit({ type: "error", code: "aborted", message: "Stopped." });
    } else {
      emit({ type: "error", code: (err && err.code) || "network", message: err && err.message });
    }
    return fail();
  }
}
