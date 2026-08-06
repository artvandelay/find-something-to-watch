import assert from "node:assert/strict";
import {
  RECOMMENDED_OPENROUTER_MODELS,
  buildModelSelectOptions,
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
assert.equal(RECOMMENDED_OPENROUTER_MODELS[0].id, "openai/gpt-5.6-terra-pro");

console.log("check_openrouter_models OK");
