import { createModelApiUrl } from "./llm-client.js";

export const RECOMMENDED_OPENROUTER_MODELS = Object.freeze([
  { id: "~deepseek/deepseek-flash-latest", name: "DeepSeek V4.1 Flash", note: "app default" },
  { id: "openai/gpt-6.1-sol-pro", name: "GPT-6.1 Sol Pro" },
  { id: "~anthropic/claude-haiku-latest", name: "Claude Haiku" },
  { id: "~google/gemini-pro-latest", name: "Gemini Pro" },
  { id: "~moonshotai/kimi-latest", name: "Kimi" },
  { id: "~x-ai/grok-latest", name: "Grok" },
  { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash", note: "open" },
  { id: "minimax/minimax-m3.1-flash:free", name: "MiniMax M3.1 Flash", note: "open" },
  { id: "stepfun/step-5-preview", name: "Step 5", note: "open" }
]);

export function isOpenRouterBaseUrl(value) {
  try {
    return new URL(String(value || "")).hostname === "openrouter.ai";
  } catch {
    return false;
  }
}

export function formatPricePerMillion(perToken) {
  const n = Number(perToken);
  if (!Number.isFinite(n) || n < 0) return null;
  const perM = n * 1_000_000;
  if (perM === 0) return "free";
  if (perM < 0.01) return "$" + perM.toFixed(4);
  if (perM >= 100) return "$" + Math.round(perM);
  return "$" + perM.toFixed(2).replace(/\.?0+$/, "");
}

export function modelSupportsReasoning(model) {
  return model?.reasoning === true || Boolean(model?.reasoning)
    || (model?.supportedParameters || []).some((parameter) =>
      ["reasoning", "include_reasoning", "reasoning_effort"].includes(String(parameter).toLowerCase())
    );
}

export function formatPricingSuffix(pricing) {
  const prompt = formatPricePerMillion(pricing?.prompt);
  const completion = formatPricePerMillion(pricing?.completion);
  if (!prompt || !completion) return "";
  return prompt === "free" && completion === "free" ? "free" : prompt + "/" + completion;
}

export function formatContextLength(tokens) {
  const n = Number(tokens);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    return (Number.isInteger(millions) ? millions : millions.toFixed(1).replace(/\.0$/, "")) + "M context";
  }
  return n >= 1000 ? Math.round(n / 1000) + "k context" : n + " context";
}

export function formatReasoningBadge(model) {
  if (!modelSupportsReasoning(model)) return "";
  const effort = model?.reasoning?.defaultEffort || model?.reasoning?.default_effort;
  return typeof effort === "string" && effort && effort !== "none" ? effort : "reasoning";
}

function shortName(value) {
  return String(value || "").replace(/^[^:]+:\s*/, "").trim();
}

function clipDescription(value, max = 280) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

export function normalizeOpenRouterModel(item) {
  const id = String(item?.id || "").trim();
  if (!id) return null;
  const contextLength = Number(item.context_length ?? item.contextLength);
  return {
    id,
    name: shortName(item.name || id) || id,
    description: clipDescription(item.description),
    contextLength: Number.isFinite(contextLength) && contextLength > 0 ? contextLength : null,
    pricing: item.pricing ? { prompt: item.pricing.prompt, completion: item.pricing.completion } : null,
    supportedParameters: (item.supported_parameters || item.supportedParameters || []).map(String),
    reasoning: item.reasoning === true ? true : item.reasoning ? { ...item.reasoning } : null,
    note: typeof item.note === "string" ? item.note : ""
  };
}

export function buildModelSelectOptions(recommended, popular, { catalogById = new Map() } = {}) {
  const catalog = catalogById instanceof Map ? catalogById : new Map();
  const enrichedRecommended = (recommended || []).map((item) => {
    const live = catalog.get(item.id);
    return {
      id: item.id,
      name: item.name,
      note: item.note || "",
      description: live?.description || "",
      contextLength: live?.contextLength || null,
      pricing: live?.pricing || null,
      supportedParameters: live?.supportedParameters || [],
      reasoning: live?.reasoning || null
    };
  });
  const recommendedIds = new Set(enrichedRecommended.map((item) => item.id));
  return {
    recommended: enrichedRecommended,
    popular: (popular || []).filter((item) => !recommendedIds.has(item.id))
  };
}

export function filterModelGroups(groups, query) {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return groups;
  const matches = (model) => [model.id, model.name, model.note, model.description]
    .filter(Boolean).join(" ").toLowerCase().includes(term);
  return {
    recommended: (groups.recommended || []).filter(matches),
    popular: (groups.popular || []).filter(matches)
  };
}

export function findModelInGroups(groups, id) {
  return (groups.recommended || []).find((model) => model.id === id)
    || (groups.popular || []).find((model) => model.id === id)
    || null;
}

export function nextRecommendedOpenRouterModel(currentId) {
  const list = RECOMMENDED_OPENROUTER_MODELS;
  if (!Array.isArray(list) || list.length === 0) return null;
  const id = String(currentId || "").trim();
  const index = list.findIndex((item) => item.id === id);
  if (index >= 0) return list[(index + 1) % list.length];
  return list[0];
}

function modelSupportsTools(model) {
  return (model?.supportedParameters || []).some((parameter) => String(parameter).toLowerCase() === "tools");
}

async function fetchOpenRouterModelList(baseUrl, params, fetchImpl, signal) {
  const endpoint = new URL(createModelApiUrl(baseUrl, "models"));
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(key, value);
  const response = await fetchImpl(endpoint, { signal });
  const payload = response.ok ? await response.json() : null;
  if (!Array.isArray(payload?.data)) return [];
  return payload.data.map(normalizeOpenRouterModel).filter(Boolean);
}

export async function fetchPopularOpenRouterModels({
  baseUrl,
  limit = 20,
  catalogLimit = 100,
  fetchImpl = globalThis.fetch,
  signal = null
} = {}) {
  if (!isOpenRouterBaseUrl(baseUrl)) return { popular: [], catalogById: new Map() };
  try {
    const models = await fetchOpenRouterModelList(baseUrl, {
      sort: "most-popular",
      limit: String(Math.max(1, Math.min(catalogLimit, 1000))),
      output_modalities: "text",
      supported_parameters: "tools"
    }, fetchImpl, signal);
    if (models.length === 0 && signal?.aborted) return { popular: [], catalogById: new Map() };

    const catalogById = new Map(models.map((model) => [model.id, model]));
    const missing = RECOMMENDED_OPENROUTER_MODELS
      .map((item) => item.id)
      .filter((id) => !catalogById.has(id));
    // supported_parameters=tools omits ~latest aliases, so a slug search is the documented lookup.
    const found = await Promise.all(missing.map(async (id) => {
      try {
        const matches = await fetchOpenRouterModelList(baseUrl, {
          output_modalities: "text",
          q: id
        }, fetchImpl, signal);
        return matches.find((model) => model.id === id && modelSupportsTools(model)) || null;
      } catch {
        return null;
      }
    }));
    for (const model of found) {
      if (model) catalogById.set(model.id, model);
    }
    return { popular: models.slice(0, limit), catalogById };
  } catch {
    return { popular: [], catalogById: new Map() };
  }
}
