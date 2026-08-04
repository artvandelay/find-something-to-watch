// Agent loop. No DOM, no localStorage, no imports: fetch is injected so this
// module can run under Node for tests. Requests are never streamed.

const DEFAULT_BUDGET = { maxSteps: 8, maxMs: 120000 };

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
  const res = await fetchImpl(config.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
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

function buildContextBlock(context) {
  const ctx = context || {};
  let out = "## Mood\n" + (ctx.mood || "no preference");
  if (typeof ctx.youmd === "string" && ctx.youmd.trim() !== "") {
    out += "\n\n## About the viewer (You.md)\n" + ctx.youmd;
  }
  if (ctx.history !== null && ctx.history !== undefined) {
    out += "\n\n## Recently watched\n";
    const series = Array.isArray(ctx.history.series) ? ctx.history.series.slice(0, 20) : [];
    const movies = Array.isArray(ctx.history.movies) ? ctx.history.movies.slice(0, 20) : [];
    const lines = [];
    for (const s of series) lines.push("- " + s.name + " (" + s.episodes + " episodes)");
    for (const m of movies) lines.push("- " + (typeof m === "string" ? m : m.title));
    out += lines.join("\n");
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

export async function runAgent(opts) {
  const config = opts.config;
  const prompts = opts.prompts;
  const tools = opts.tools;
  const context = opts.context;
  const query = opts.query;
  const emit = typeof opts.onEvent === "function" ? opts.onEvent : function () {};
  const signal = opts.signal || null;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const budget = opts.budget || DEFAULT_BUDGET;

  let usage = null;

  try {
    if (typeof config.apiKey !== "string" || config.apiKey.trim() === "") {
      emit({ type: "error", code: "auth", message: "Add an API key in Settings to use the agent." });
      return { picks: [], usage: null };
    }

    const deadline = Date.now() + budget.maxMs;
    const messages = [
      { role: "system", content: prompts.system },
      { role: "system", content: buildContextBlock(context) },
      { role: "user", content: prompts.planner.replace("{{QUERY}}", query) }
    ];

    emit({ type: "status", text: "Planning search" });

    let finalText = null;
    for (let step = 0; step < budget.maxSteps; step++) {
      if (signal && signal.aborted) {
        emit({ type: "error", code: "aborted", message: "Stopped." });
        return { picks: [], usage };
      }
      if (Date.now() > deadline) {
        emit({ type: "error", code: "budget", message: "Search took too long and was stopped." });
        return { picks: [], usage };
      }

      const data = await callLlm(
        config,
        { messages, tools: tools.schemas, tool_choice: "auto" },
        fetchImpl,
        signal
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
      return { picks: [], usage };
    }

    emit({ type: "status", text: "Writing recommendations" });

    messages.push({ role: "user", content: prompts.rerank });
    const finalData = await callLlm(
      config,
      { messages, response_format: { type: "json_object" } },
      fetchImpl,
      signal
    );
    usage = addUsage(usage, finalData.usage);

    let parsed;
    try {
      parsed = JSON.parse(stripFence(finalData.choices[0].message.content));
    } catch (err) {
      emit({ type: "error", code: "parse", message: "The model did not return valid JSON." });
      return { picks: [], usage };
    }

    const rawPicks = Array.isArray(parsed.picks) ? parsed.picks : [];
    const ids = rawPicks.map((p) => p.id);
    const resolved = ids.length > 0 ? await tools.handlers.get_titles({ ids }) : { results: [] };
    const byId = new Map();
    for (const row of resolved.results || []) byId.set(row.id, row);

    const picks = [];
    for (const pick of rawPicks) {
      const row = byId.get(pick.id);
      if (!row) continue;
      picks.push({
        id: row.id,
        t: row.t,
        y: row.y,
        k: row.k,
        rt: row.rt,
        r: row.r,
        p: row.p,
        u: row.u,
        img: row.img,
        reason: pick.reason
      });
    }

    emit({ type: "delta", text: parsed.note || "" });
    emit({ type: "done", picks, usage });
    return { picks, usage };
  } catch (err) {
    if (err && err.name === "AbortError") {
      emit({ type: "error", code: "aborted", message: "Stopped." });
    } else {
      emit({ type: "error", code: (err && err.code) || "network", message: err && err.message });
    }
    return { picks: [], usage };
  }
}
