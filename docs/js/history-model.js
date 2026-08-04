import { callChatCompletion } from "./llm-client.js";

const MAX_OUTPUT_CHARACTERS = 4000;

function historyModelError(message, cause = null) {
  const error = new Error(message);
  error.name = "HistoryImportError";
  error.code = "plan";
  if (cause) error.cause = cause;
  return error;
}

function oneJsonObject(content) {
  if (typeof content !== "string" || content.length === 0 || content.length > MAX_OUTPUT_CHARACTERS) {
    throw historyModelError("The history schema response was missing or too large.");
  }
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw historyModelError("The history schema response must be one JSON object.");
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw historyModelError("The history schema response must be one JSON object.");
    }
    return parsed;
  } catch (cause) {
    if (cause?.name === "HistoryImportError") throw cause;
    throw historyModelError("The history schema response was not valid JSON.", cause);
  }
}

export function createHistoryPlanInferer({ config, prompt, fetchImpl } = {}) {
  if (!config || typeof prompt !== "string" || !prompt.trim()) {
    throw historyModelError("History schema inference requires model configuration and a prompt.");
  }

  return async function inferHistoryPlan(input, { signal = null } = {}) {
    if (signal?.aborted) {
      const error = new Error("The history import was cancelled.");
      error.name = "AbortError";
      throw error;
    }
    const sample = typeof input === "string" ? input : JSON.stringify(input);
    if (sample.length > 12000) {
      throw historyModelError("The bounded history sample exceeds the inference-input limit.");
    }
    const response = await callChatCompletion(
      config,
      {
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: sample }
        ],
        temperature: 0
      },
      { fetchImpl, signal }
    );
    const content = response?.choices?.[0]?.message?.content;
    return oneJsonObject(content);
  };
}
