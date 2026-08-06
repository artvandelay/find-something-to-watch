// Agent loop. No DOM or localStorage: fetch is injected so this module can run
// under Node for tests. Only final presentation text reaches streaming consumers.

import { streamChatCompletion } from "./llm-client.js";
import { isOpenRouterBaseUrl } from "./openrouter-models.js";
import { sanitizeRecommendationQueue } from "./recommendations.js";
import { validatePreferenceCandidates } from "./preferences.js";

const TURN_CLASS_BUDGETS = Object.freeze({
  direct: { maxSteps: 0, maxMs: 90000 },
  // Empirically, three planner steps is the floor for a tool call + repair +
  // decision; four keeps normal recommendations reliable without restoring eight.
  normal: { maxSteps: 4, maxMs: 120000 },
  complex: { maxSteps: 8, maxMs: 120000 }
});
const MAX_QUEUE_IDS = 20;
const MAX_QUERY_CHARACTERS = 6000;
const MAX_YOUMD_CONTEXT_CHARACTERS = 8000;
const MAX_CONVERSATION_CONTEXT_CHARACTERS = 18000;
const MAX_RECENT_FULL_TURNS = 2;
const MAX_OLDER_ASSISTANT_CHARACTERS = 320;
const MAX_HISTORY_CONTEXT_CHARACTERS = 9600;
const MAX_CATALOG_MANIFEST_CHARACTERS = 8000;
const MAX_QUEUE_CONTEXT_ITEMS = 20;
const MAX_QUEUE_CONTEXT_CHARACTERS = 4000;
const MAX_TIMING_PHASES = 24;

const DIRECT_FOLLOW_UP_RE = /\b(why (would|do) i (like|enjoy)|tell me more|more about|what(?:'s| is) it about|how long|runtime|who (directed|stars|wrote|is in)|reviews?|reception|that one|the (last|top) (pick|one)|explain (that|this|it))\b/i;
const COMPLEX_REQUEST_RE = /\b(compare|versus|vs\.?|research|deep dive|comprehensive|everything|across (all|my)|several|multiple (services|providers|platforms)|and also)\b/i;

function createLatencyTracker(prefix) {
  const perf = globalThis.performance;
  const origin = typeof perf?.now === "function" ? perf.now() : Date.now();
  let sequence = 0;
  let dropped = 0;
  const phases = [];
  const now = () => typeof perf?.now === "function" ? perf.now() : Date.now();
  const mark = (name) => {
    const id = `${prefix}:${sequence++}:${name}`;
    try {
      perf?.mark?.(id);
    } catch {
      // Timing must never affect a turn when Performance APIs are unavailable.
    }
    return id;
  };
  const record = (name, atMs = now() - origin, durationMs = 0) => {
    if (phases.length >= MAX_TIMING_PHASES) {
      dropped += 1;
      return;
    }
    phases.push({
      name,
      atMs: Math.max(0, Math.round(atMs)),
      durationMs: Math.max(0, Math.round(durationMs))
    });
  };
  record("agent_start", 0);
  return {
    elapsed: () => Math.max(0, now() - origin),
    start(name) {
      return { name, atMs: now() - origin, mark: mark(name + ":start") };
    },
    end(entry) {
      const endMark = mark(entry.name + ":end");
      let duration = Math.max(0, now() - origin - entry.atMs);
      try {
        const measureName = `${prefix}:${sequence++}:${entry.name}:duration`;
        perf?.measure?.(measureName, entry.mark, endMark);
        const measured = perf?.getEntriesByName?.(measureName).at(-1)?.duration;
        if (Number.isFinite(measured)) duration = measured;
        perf?.clearMeasures?.(measureName);
      } catch {
        // Keep the fallback duration when measure() cannot run.
      } finally {
        try {
          perf?.clearMarks?.(entry.mark);
          perf?.clearMarks?.(endMark);
        } catch {
          // Performance buffers are best effort only.
        }
      }
      record(entry.name, entry.atMs, duration);
    },
    point(name) {
      const atMs = now() - origin;
      const pointMark = mark(name);
      try {
        perf?.clearMarks?.(pointMark);
      } catch {
        // Performance buffers are best effort only.
      }
      record(name, atMs);
      return atMs;
    },
    snapshot() {
      return {
        phases: phases
          .slice()
          .sort((left, right) => left.atMs - right.atMs)
          .map((phase) => ({ ...phase })),
        droppedPhases: dropped
      };
    }
  };
}

function buildReceptionGuidance(webSearchEnabled) {
  if (webSearchEnabled) {
    return "## Reception and reviews\n"
      + "The local catalog exposes synopsis text and TMDB vote signals (r, v), not critic reviews.\n"
      + "When the viewer asks about critical reception or reviews on a factual follow-up, you may use web search during planning to find external reception or articles.\n"
      + "Use only information returned by web search or catalog fields. Never invent quotes, awards, or reception.\n"
      + "Recommendations and queue IDs still must come only from run_catalog_js.";
  }
  return "## Reception and reviews\n"
    + "The local catalog exposes synopsis text and TMDB vote signals (r, v). It does not include critic reviews, newspaper quotes, or external articles.\n"
    + "When the viewer asks about critical reception or reviews, say clearly that this catalog snapshot does not carry that data and use only the bounded catalog fields you have.\n"
    + "Never invent quotes, awards, or reception.";
}

function buildPlannerPrompt(prompts, query, webSearchEnabled) {
  let text = prompts.planner.replace("{{QUERY}}", String(query || "").slice(0, MAX_QUERY_CHARACTERS));
  if (webSearchEnabled) {
    text += "\n\nWhen the viewer asks about critical reception or reviews on an existing pick, you may use web search during this planning phase before returning decision JSON. Omit \"queue\" unless they explicitly ask for new picks or alternatives.";
  }
  return text;
}

function buildRerankPrompt(prompts, webSearchEnabled) {
  let text = prompts.rerank;
  if (webSearchEnabled) {
    text += "\n\nYou may rely on web search results already present in the message history above. If none were retrieved, say the catalog only has synopsis text and TMDB vote signals and do not invent reception.";
  } else {
    text += "\n\nThe catalog only has synopsis text and TMDB vote signals (r, v); it does not include critic reviews or external articles. Say clearly when that limits what you can report.";
  }
  return text;
}

function buildDirectPrompt(prompts, query, webSearchEnabled) {
  return "Viewer's latest message: " + String(query || "").slice(0, MAX_QUERY_CHARACTERS)
    + "\n\n"
    + buildRerankPrompt(prompts, webSearchEnabled)
    + "\n\nAnswer this follow-up directly from Current recommendations and recent chat. Do not invent catalog IDs or titles.";
}

export function classifyTurn(query, context = {}, options = {}) {
  const text = String(query || "").trim();
  const queueItems = Array.isArray(context?.recommendationQueue?.items)
    ? context.recommendationQueue.items
    : [];
  const hasQueue = queueItems.length > 0;
  if (COMPLEX_REQUEST_RE.test(text) || text.length > 280) return "complex";
  if (hasQueue && DIRECT_FOLLOW_UP_RE.test(text) && text.length <= 220) {
    // Review follow-ups may need the OpenRouter web tool during planning.
    if (options.webSearchEnabled && /\b(reviews?|reception)\b/i.test(text)) return "normal";
    return "direct";
  }
  return "normal";
}

function budgetForTurnClass(turnClass, override = null) {
  const base = TURN_CLASS_BUDGETS[turnClass] || TURN_CLASS_BUDGETS.normal;
  if (!override || typeof override !== "object") return { ...base };
  return {
    maxSteps: Number.isFinite(override.maxSteps) ? Math.max(0, override.maxSteps) : base.maxSteps,
    maxMs: Number.isFinite(override.maxMs) ? Math.max(0, override.maxMs) : base.maxMs
  };
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

function buildQueueContextBlock(context) {
  const queue = context && context.recommendationQueue;
  const items = Array.isArray(queue?.items) ? queue.items : [];
  const instruction = "Resolve pronouns such as \"it\", \"that one\", and \"the last pick\" against this list. Factual follow-ups about an existing pick do not require new recommendations unless the viewer asks for alternatives.";
  if (items.length === 0) {
    const content = "## Current recommendations\nNone active yet.\n\n" + instruction;
    return {
      content,
      diagnostics: { suppliedItems: 0, includedItems: 0, characters: content.length, truncated: false }
    };
  }
  const lines = [];
  const header = "## Current recommendations\n";
  const sourceQuery = typeof queue?.source?.query === "string" ? queue.source.query.trim().slice(0, 120) : "";
  const source = sourceQuery ? `\n\nLatest decision query: "${sourceQuery}"` : "";
  let used = header.length + source.length + instruction.length + 2;
  for (let i = 0; i < items.length && i < MAX_QUEUE_CONTEXT_ITEMS; i++) {
    const item = items[i] || {};
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) continue;
    const title = typeof item.t === "string" && item.t.trim() ? item.t.trim() : id;
    const rank = i === 0 ? "Top pick" : i < 3 ? "Alternative" : "More";
    const reason = typeof item.reason === "string" && item.reason.trim() ? item.reason.trim() : "";
    const line = `${i + 1}. [${rank}] ${title} (${id})${reason ? ": " + reason : ""}`;
    if (used + line.length + 1 > MAX_QUEUE_CONTEXT_CHARACTERS) break;
    lines.push(line);
    used += line.length + 1;
  }
  const content = header + (lines.length ? lines.join("\n") : "None active yet.")
    + source + "\n\n" + instruction;
  return {
    content,
    diagnostics: {
      suppliedItems: items.length,
      includedItems: lines.length,
      characters: content.length,
      truncated: lines.length < Math.min(items.length, MAX_QUEUE_CONTEXT_ITEMS)
        || items.length > MAX_QUEUE_CONTEXT_ITEMS
    }
  };
}

function conversationTurns(conversation) {
  if (!Array.isArray(conversation)) return [];
  const turns = [];
  let current = null;
  for (const message of conversation) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
    if (typeof message.content !== "string" || message.content === "") continue;
    if (message.role === "user") {
      if (current?.assistant) turns.push(current);
      current = {
        user: message.content.slice(0, MAX_QUERY_CHARACTERS),
        assistant: null
      };
    } else if (current && current.assistant === null) {
      current.assistant = message.content.slice(0, MAX_QUERY_CHARACTERS);
    }
  }
  if (current?.assistant) turns.push(current);
  return turns;
}

function addUsage(total, chunk) {
  const next = total || { promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0 };
  const number = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  next.promptTokens += number(chunk?.prompt_tokens ?? chunk?.promptTokens);
  next.completionTokens += number(chunk?.completion_tokens ?? chunk?.completionTokens);
  next.totalTokens += number(chunk?.total_tokens ?? chunk?.totalTokens)
    || number(chunk?.prompt_tokens ?? chunk?.promptTokens) + number(chunk?.completion_tokens ?? chunk?.completionTokens);
  next.requestCount += 1;
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

function compactAssistantProse(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= MAX_OLDER_ASSISTANT_CHARACTERS) return value;
  return value.slice(0, MAX_OLDER_ASSISTANT_CHARACTERS - 1).trimEnd() + "…";
}

// Prior turns from the bounded conversation, converted into real chat
// messages so the model can follow a multi-turn thread instead of treating
// every call as a fresh one-shot query. Drops oldest complete turns first.
// Older assistant prose is compacted because You.md / learned / history already
// carry durable preference summaries; recent turns and the current queue stay full.
function priorTurnMessages(conversation) {
  const turns = conversationTurns(conversation);
  const validMessages = Array.isArray(conversation)
    ? conversation.filter((message) => message
      && (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string" && message.content !== "").length
    : 0;
  const selected = [];
  let used = 0;
  let droppedTurns = 0;
  let droppedCharacters = 0;
  let compactedAssistantTurns = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    const recent = (turns.length - 1 - i) < MAX_RECENT_FULL_TURNS;
    const assistant = turn.assistant
      ? (recent ? turn.assistant : compactAssistantProse(turn.assistant))
      : null;
    if (turn.assistant && assistant && assistant.length < turn.assistant.length) {
      compactedAssistantTurns += 1;
    }
    const messages = [{ role: "user", content: turn.user }];
    if (assistant) messages.push({ role: "assistant", content: assistant });
    const turnLength = messages.reduce((sum, message) => sum + message.content.length, 0);
    if (used + turnLength > MAX_CONVERSATION_CONTEXT_CHARACTERS) {
      droppedTurns = i + 1;
      for (let j = 0; j <= i; j++) {
        droppedCharacters += turns[j].user.length + (turns[j].assistant ? turns[j].assistant.length : 0);
      }
      break;
    }
    selected.unshift(...messages);
    used += turnLength;
  }
  return {
    messages: selected,
    diagnostics: {
      budgetCharacters: MAX_CONVERSATION_CONTEXT_CHARACTERS,
      includedCharacters: used,
      totalTurns: turns.length,
      includedTurns: Math.max(0, turns.length - droppedTurns),
      droppedTurns,
      droppedCharacters,
      compactedAssistantTurns,
      droppedIncompleteMessages: Math.max(0, validMessages - turns.length * 2)
    }
  };
}

function buildContextDiagnostics(context, prior, viewerContext, queueContext, catalogContext, extras = {}) {
  const youmd = typeof context?.youmd === "string" ? context.youmd : "";
  return {
    conversation: prior.diagnostics,
    viewerContextCharacters: viewerContext.length,
    youmdCharacters: Math.min(youmd.length, MAX_YOUMD_CONTEXT_CHARACTERS),
    youmdTruncated: youmd.length > MAX_YOUMD_CONTEXT_CHARACTERS,
    queue: queueContext.diagnostics,
    catalogManifestCharacters: catalogContext.length,
    totalCharacters: viewerContext.length + queueContext.content.length
      + catalogContext.length + prior.diagnostics.includedCharacters,
    turnClass: extras.turnClass || "normal",
    plannerBudget: Number.isFinite(extras.plannerBudget) ? extras.plannerBudget : null,
    requestCountExpected: extras.requestCountExpected || null
  };
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

function turnIdFor(value) {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "turn-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function parseDecision(text) {
  let value;
  try {
    value = JSON.parse(stripFence(text));
  } catch {
    throw Object.assign(new Error("The model did not return valid decision JSON."), { code: "parse" });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("The model did not return a decision object."), { code: "parse" });
  }
  const allowed = new Set(["queue", "memoryCandidates"]);
  if (Object.keys(value).some((key) => !allowed.has(key)) ||
    ("queue" in value && !Array.isArray(value.queue)) ||
    ("memoryCandidates" in value && !Array.isArray(value.memoryCandidates))) {
    throw Object.assign(new Error("The model returned an invalid decision shape."), { code: "parse" });
  }
  return value;
}

function retryable(code) {
  return code === "network" || code === "rate" || code === "budget" || code === "TIMEOUT";
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
  const webSearchEnabled = opts.config?.webSearch === true && isOpenRouterBaseUrl(opts.config?.baseUrl);
  const turnClass = typeof opts.turnClass === "string" && TURN_CLASS_BUDGETS[opts.turnClass]
    ? opts.turnClass
    : classifyTurn(query, context, { webSearchEnabled });
  const budget = budgetForTurnClass(turnClass, opts.budget);
  const maxMs = budget.maxMs;
  const maxSteps = budget.maxSteps;
  const externalSignal = opts.signal || null;
  const turnId = turnIdFor(opts.turnId);
  const controller = new AbortController();
  const startedAt = Date.now();
  const latency = createLatencyTracker("agent:" + turnId);
  let externallyAborted = false;
  let timedOut = false;
  let usage = null;
  let successfulRequests = 0;
  let pricedRequests = 0;
  let reportedCost = 0;
  let costComplete = true;
  let firstTokenMs = null;
  let partialReply = "";
  let currentPhase = "Checking your services";
  const timing = () => ({
    totalMs: Math.max(0, Date.now() - startedAt),
    firstTokenMs,
    ...latency.snapshot()
  });
  const billing = () => ({
    basis: successfulRequests > 0 && costComplete ? "provider_reported" : "unavailable",
    amountUsd: successfulRequests > 0 && costComplete ? reportedCost : null,
    complete: successfulRequests > 0 && costComplete,
    requestCount: successfulRequests,
    pricedRequestCount: pricedRequests
  });
  const emitEvent = (event) => emit({ turnId, ...event });
  const status = (phase, text, step) => {
    currentPhase = phase;
    emitEvent({ type: "status", phase, text: text || phase, step });
  };
  const addRequestUsage = (rawUsage) => {
    usage = addUsage(usage, rawUsage);
    successfulRequests += 1;
    const cost = Number(rawUsage?.cost);
    if (Number.isFinite(cost) && cost >= 0) {
      reportedCost += cost;
      pricedRequests += 1;
    } else {
      costComplete = false;
    }
  };
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

  const fail = (contextDiagnostics = null) => ({
    ok: false,
    reply: "",
    queue: null,
    memoryCandidates: [],
    usage,
    billing: billing(),
    timing: timing(),
    contextDiagnostics
  });
  const abortFailure = () => {
    if (externallyAborted || externalSignal?.aborted) {
      emitEvent({ type: "error", code: "aborted", message: "Stopped.", retryable: false, partialReply, timing: timing() });
    } else {
      emitEvent({ type: "error", code: "budget", message: "Search took too long and was stopped.", retryable: true, partialReply, timing: timing() });
    }
    return fail();
  };
  const ensureActive = () => {
    if (controller.signal.aborted) throw makeAbortError();
  };

  try {
    if (typeof config.apiKey !== "string" || config.apiKey.trim() === "") {
      emitEvent({ type: "error", code: "auth", message: "Add an API key in Settings to use the agent.", retryable: false, partialReply: "", timing: timing() });
      return fail();
    }

    const requestTools = localToolSchemas(tools);
    if (webSearchEnabled) {
      requestTools.push({ type: "openrouter:web_search" });
    }
    const prior = priorTurnMessages(conversation);
    const viewerContext = buildContextBlock(context);
    const queueContext = buildQueueContextBlock(context);
    const catalogContext = buildCatalogManifestBlock(context);
    const contextDiagnostics = buildContextDiagnostics(
      context,
      prior,
      viewerContext,
      queueContext,
      catalogContext,
      {
        turnClass,
        plannerBudget: maxSteps,
        requestCountExpected: turnClass === "direct" ? 1 : null
      }
    );
    emitEvent({ type: "context", diagnostics: contextDiagnostics });
    const baseMessages = [
      { role: "system", content: prompts.system },
      { role: "system", content: buildReceptionGuidance(webSearchEnabled) },
      { role: "system", content: viewerContext },
      { role: "system", content: queueContext.content },
      { role: "system", content: catalogContext },
      ...prior.messages
    ];

    let queue = null;
    let memoryCandidates = [];
    let messages = baseMessages.slice();

    if (turnClass === "direct") {
      status("Answering about your pick", "Answering about your pick", 1);
      messages.push({
        role: "user",
        content: buildDirectPrompt(prompts, query, webSearchEnabled)
      });
    } else {
      messages.push({
        role: "user",
        content: buildPlannerPrompt(prompts, query, webSearchEnabled)
      });
      status("Checking your services", "Checking your services", 1);

      let decisionText = null;
      for (let step = 0; step < maxSteps; step++) {
        ensureActive();
        const requestTiming = latency.start("model_request");
        let data;
        try {
          data = await streamChatCompletion(
            config,
            { messages, tools: requestTools, tool_choice: "auto" },
            { fetchImpl, signal: controller.signal }
          );
        } finally {
          latency.end(requestTiming);
        }
        addRequestUsage(data.usage);
        const msg = data.message;
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
              if (!args || typeof args !== "object" || Array.isArray(args)) {
                throw new Error("tool arguments must be a JSON object");
              }
            } catch {
              args = {};
              result = { error: "tool arguments must be valid JSON object" };
            }
            status("Searching the catalog", "Searching the catalog", step + 1);
            const startedToolAt = Date.now();
            const toolTiming = latency.start("catalog_tool");
            emitEvent({ type: "tool_call", id: toolCallId, name, args, step: step + 1 });

            try {
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
            } finally {
              latency.end(toolTiming);
            }
            emitEvent({
              type: "tool_result",
              id: toolCallId,
              name,
              count: resultCount(result),
              ok: !result?.error,
              durationMs: Math.max(0, Date.now() - startedToolAt),
              step: step + 1
            });
            messages.push({ role: "tool", tool_call_id: toolCallId, content: toolResultContent(result) });
          }
          status("Comparing matches", "Comparing matches", step + 1);
          continue;
        }

        decisionText = msg.content || "";
        break;
      }

      if (decisionText === null) {
        emitEvent({ type: "error", code: "budget", message: "The model kept searching without answering.", retryable: true, partialReply, timing: timing() });
        return fail(contextDiagnostics);
      }

      const decision = parseDecision(decisionText);
      if (Array.isArray(decision.queue)) {
        const draft = sanitizeRecommendationQueue({ items: decision.queue });
        const rawItems = draft?.items || [];
        if (rawItems.length === 0) {
          queue = [];
        } else {
          const resolved = await abortable(Promise.resolve(
            tools.resolve(rawItems.map((item) => item.id), controller.signal)
          ), controller.signal);
          const found = resolvedIds(resolved);
          queue = rawItems.filter((item) => found.has(item.id));
        }
      }
      memoryCandidates = validatePreferenceCandidates(decision.memoryCandidates, String(query || ""));

      status("Writing your picks", "Writing your picks", maxSteps + 1);
      messages.push({ role: "user", content: buildRerankPrompt(prompts, webSearchEnabled) });
    }

    const requestTiming = latency.start("model_request");
    let finalData;
    try {
      finalData = await streamChatCompletion(
        config,
        { messages },
        {
          fetchImpl,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type !== "content") return;
            if (firstTokenMs === null) {
              firstTokenMs = Math.max(0, Date.now() - startedAt);
              latency.point("first_token");
            }
            partialReply += event.text;
            emitEvent({ type: "delta", text: event.text });
          }
        }
      );
    } finally {
      latency.end(requestTiming);
    }
    addRequestUsage(finalData.usage);

    const reply = finalData.message.content || "";
    if (reply.trim() === "") {
      emitEvent({ type: "error", code: "parse", message: "The model response needs a non-empty reply.", retryable: false, partialReply, timing: timing() });
      return fail(contextDiagnostics);
    }
    latency.point("complete_turn");
    const result = {
      ok: true,
      reply,
      queue,
      memoryCandidates,
      usage,
      billing: billing(),
      timing: timing(),
      contextDiagnostics,
      turnClass
    };
    emitEvent({
      type: "done",
      turnId,
      reply,
      queue,
      memoryCandidates,
      usage,
      billing: result.billing,
      timing: result.timing,
      contextDiagnostics,
      turnClass
    });
    return result;
  } catch (err) {
    if (externallyAborted || externalSignal?.aborted) {
      return abortFailure();
    } else if (timedOut) {
      return abortFailure();
    } else if (err && err.name === "AbortError") {
      emitEvent({ type: "error", code: "aborted", message: "Stopped.", retryable: false, partialReply, timing: timing() });
    } else {
      const code = (err && err.code) || "network";
      emitEvent({
        type: "error",
        code,
        message: err?.message || "The request failed.",
        retryable: retryable(code),
        partialReply,
        timing: timing()
      });
    }
    return fail();
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", abortFromUser);
  }
}
