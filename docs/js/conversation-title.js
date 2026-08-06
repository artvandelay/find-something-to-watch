import { callChatCompletion } from "./llm-client.js";
import { isOpenRouterBaseUrl } from "./openrouter-models.js";

export const CONVERSATION_TITLE_MODEL = "openai/gpt-5-nano";
export const MAX_CONVERSATION_TITLE_WORDS = 7;
export const MAX_CONVERSATION_TITLE_CHARACTERS = 72;

function compact(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function sanitizeConversationTitle(value) {
  const plain = compact(String(value || "")
    .replace(/^["'`*_#\s]+|["'`*_#\s]+$/g, "")
    .replace(/^(?:title|conversation title)\s*:\s*/i, ""));
  return plain.split(/\s+/).slice(0, MAX_CONVERSATION_TITLE_WORDS)
    .join(" ").slice(0, MAX_CONVERSATION_TITLE_CHARACTERS);
}

function titleModelConfig(config) {
  return {
    ...config,
    // OpenRouter has a stable low-cost model for this one-line classification.
    // Compatible custom endpoints receive their configured model instead.
    model: isOpenRouterBaseUrl(config?.baseUrl) ? CONVERSATION_TITLE_MODEL : config?.model
  };
}

export async function generateConversationTitle(config, query, { fetchImpl, signal } = {}) {
  const response = await callChatCompletion(
    titleModelConfig(config),
    {
      temperature: 0.2,
      max_tokens: 18,
      messages: [
        {
          role: "system",
          content: "Create a concise title for a movie or TV recommendation chat. "
            + "Return only the title: no quotes, no emoji, no punctuation, and no explanation. "
            + "Use at most seven words."
        },
        { role: "user", content: String(query || "").slice(0, 6000) }
      ]
    },
    { fetchImpl, signal }
  );
  return sanitizeConversationTitle(response?.choices?.[0]?.message?.content);
}
