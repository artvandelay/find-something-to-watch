import { createModelApiUrl } from "./llm-client.js";

export const RECOMMENDED_OPENROUTER_MODELS = Object.freeze([
  { id: "openai/gpt-5.6-terra-pro", name: "GPT-5.6 Terra Pro", note: "app default" },
  { id: "openai/gpt-5.6-terra", name: "GPT-5.6 Terra" },
  { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
  { id: "google/gemini-3.6-flash", name: "Gemini 3.6 Flash" },
  { id: "google/gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { id: "moonshotai/kimi-k3", name: "Kimi K3" },
  { id: "openai/gpt-4o-mini", name: "GPT-4o mini", note: "low cost" },
  { id: "openai/gpt-4o", name: "GPT-4o" }
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

export async function fetchPopularOpenRouterModels({
  baseUrl,
  limit = 20,
  catalogLimit = 100,
  fetchImpl = globalThis.fetch,
  signal = null
} = {}) {
  if (!isOpenRouterBaseUrl(baseUrl)) return { popular: [], catalogById: new Map() };
  try {
    const endpoint = new URL(createModelApiUrl(baseUrl, "models"));
    endpoint.searchParams.set("sort", "most-popular");
    endpoint.searchParams.set("limit", String(Math.max(1, Math.min(catalogLimit, 1000))));
    endpoint.searchParams.set("output_modalities", "text");
    endpoint.searchParams.set("supported_parameters", "tools");
    const response = await fetchImpl(endpoint, { signal });
    const payload = response.ok ? await response.json() : null;
    if (!Array.isArray(payload?.data)) return { popular: [], catalogById: new Map() };

    const models = payload.data.map(normalizeOpenRouterModel).filter(Boolean);
    const catalogById = new Map(models.map((model) => [model.id, model]));
    return { popular: models.slice(0, limit), catalogById };
  } catch {
    return { popular: [], catalogById: new Map() };
  }
}
