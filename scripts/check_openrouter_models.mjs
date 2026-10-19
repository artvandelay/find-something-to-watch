import assert from "node:assert/strict";
import {
  RECOMMENDED_OPENROUTER_MODELS,
  buildModelSelectOptions,
  fetchPopularOpenRouterModels,
  filterModelGroups,
  formatContextLength,
  formatPricePerMillion,
  formatReasoningBadge,
  isOpenRouterBaseUrl,
  normalizeOpenRouterModel
} from "../docs/js/openrouter-models.js";

assert.equal(formatPricePerMillion("0.000003"), "$3");
assert.equal(formatPricePerMillion("0"), "free");
assert.equal(formatContextLength(272000), "272k context");
assert.equal(formatContextLength(1048576), "1M context");
assert.equal(isOpenRouterBaseUrl("https://openrouter.ai/api/v1"), true);
assert.equal(isOpenRouterBaseUrl("https://example.test/api/v1"), false);

const model = normalizeOpenRouterModel({
  id: "vendor/demo",
  name: "Vendor: Demo",
  description: "A short description.",
  context_length: 128000,
  pricing: { prompt: "0.000001", completion: "0.000002" },
  supported_parameters: ["tools", "reasoning"],
  reasoning: { default_effort: "high" }
});
assert.equal(model.name, "Demo");
assert.equal(model.contextLength, 128000);
assert.equal(formatReasoningBadge(model), "high");

const groups = buildModelSelectOptions(
  [{ id: "vendor/demo", name: "Recommended Demo" }],
  [model],
  { catalogById: new Map([[model.id, model]]) }
);
assert.equal(groups.recommended[0].description, "A short description.");
assert.equal(groups.popular.length, 0);
assert.equal(filterModelGroups(groups, "demo").recommended.length, 1);
assert.deepEqual(RECOMMENDED_OPENROUTER_MODELS.map((item) => item.id), [
  "~deepseek/deepseek-flash-latest",
  "openai/gpt-6.1-sol-pro",
  "~anthropic/claude-haiku-latest",
  "~google/gemini-pro-latest",
  "~moonshotai/kimi-latest",
  "~x-ai/grok-latest",
  "z-ai/glm-5.3-flash",
  "minimax/minimax-m3.1-flash:free",
  "stepfun/step-5-preview"
]);
assert.equal(RECOMMENDED_OPENROUTER_MODELS[0].name, "DeepSeek V4.1 Flash");
assert.equal(RECOMMENDED_OPENROUTER_MODELS[0].note, "app default");

const lookupCalls = [];
const fetched = await fetchPopularOpenRouterModels({
  baseUrl: "https://openrouter.ai/api/v1",
  fetchImpl: async (url) => {
    const href = String(url);
    lookupCalls.push(href);
    const parsed = new URL(href);
    const body = parsed.searchParams.get("sort") === "most-popular"
      ? { data: [{ id: "other/popular", name: "Other", pricing: { prompt: "0.000001", completion: "0.000002" }, supported_parameters: ["tools"] }] }
      : parsed.searchParams.get("q") === "~deepseek/deepseek-flash-latest"
        ? { data: [{ id: "~deepseek/deepseek-flash-latest", name: "DeepSeek: DeepSeek Flash Latest", pricing: { prompt: "0.00000004", completion: "0.0000006" }, supported_parameters: ["tools"], context_length: 128000 }] }
        : { data: [] };
    return { ok: true, async json() { return body; } };
  }
});
const lookedUp = fetched.catalogById.get("~deepseek/deepseek-flash-latest");
assert.equal(lookedUp.pricing.prompt, "0.00000004");
assert.equal(lookedUp.pricing.completion, "0.0000006");
assert.equal(fetched.popular.some((item) => item.id.startsWith("~")), false);
const slugLookup = lookupCalls.find((href) => new URL(href).searchParams.get("q") === "~deepseek/deepseek-flash-latest");
assert.ok(slugLookup);
assert.equal(new URL(slugLookup).searchParams.has("supported_parameters"), false);

console.log("check_openrouter_models OK");
