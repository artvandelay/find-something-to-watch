function clientError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause !== null) error.cause = cause;
  return error;
}

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

const MAX_SSE_BUFFER_CHARACTERS = 1_048_576;
const MAX_SSE_EVENT_CHARACTERS = 262_144;
const MAX_TOOL_ARGUMENT_CHARACTERS = 65_536;

function abortError() {
  const error = new Error("The model stream was aborted.");
  error.name = "AbortError";
  return error;
}

function safeEvent(onEvent, event) {
  if (typeof onEvent !== "function") return;
  onEvent(event);
}

function createStreamAccumulator(onEvent) {
  const message = { role: "assistant", content: "" };
  const tools = new Map();
  let id = null;
  let model = null;
  let usage = null;

  function toolAt(index) {
    const key = Number.isInteger(index) && index >= 0 ? index : 0;
    if (!tools.has(key)) {
      tools.set(key, { id: "", type: "function", function: { name: "", arguments: "" } });
    }
    return tools.get(key);
  }

  return {
    consume(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw clientError("network", "The model stream contained malformed JSON.");
      }
      if (payload.error) {
        throw clientError("network", String(payload.error.message || "The model stream returned an error."));
      }
      if (typeof payload.id === "string") id = payload.id;
      if (typeof payload.model === "string") model = payload.model;
      if (payload.usage && typeof payload.usage === "object") usage = payload.usage;
      const choices = Array.isArray(payload.choices) ? payload.choices : [];
      for (const choice of choices) {
        if (choice?.index !== undefined && choice.index !== 0) continue;
        const delta = choice?.delta;
        if (!delta || typeof delta !== "object") continue;
        if (typeof delta.role === "string") message.role = delta.role;
        if (typeof delta.content === "string" && delta.content) {
          message.content += delta.content;
          safeEvent(onEvent, { type: "content", text: delta.content });
        }
        for (const fragment of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
          const tool = toolAt(fragment?.index);
          if (typeof fragment?.id === "string") tool.id += fragment.id;
          if (typeof fragment?.type === "string") tool.type = fragment.type;
          if (typeof fragment?.function?.name === "string") tool.function.name += fragment.function.name;
          if (typeof fragment?.function?.arguments === "string") {
            tool.function.arguments += fragment.function.arguments;
            if (tool.function.arguments.length > MAX_TOOL_ARGUMENT_CHARACTERS) {
              throw clientError("network", "The model stream returned oversized tool arguments.");
            }
          }
        }
      }
    },
    result() {
      const toolCalls = [...tools.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
      if (toolCalls.length) message.tool_calls = toolCalls;
      return { id, model, message, usage };
    }
  };
}

export function createChatCompletionsUrl(baseUrl) {
  let base;
  try {
    base = new URL(String(baseUrl || "").trim());
  } catch (cause) {
    throw clientError("config", "Enter an absolute HTTP(S) model base URL in Settings.", cause);
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw clientError("config", "The model base URL must use HTTP or HTTPS.");
  }
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL("chat/completions", base.href).href;
}

export async function callChatCompletion(
  config,
  body,
  { fetchImpl = globalThis.fetch, signal = null } = {}
) {
  const endpoint = createChatCompletionsUrl(config?.baseUrl);
  if (typeof fetchImpl !== "function") {
    throw clientError("config", "No fetch implementation is available.");
  }

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + config?.apiKey
      },
      body: JSON.stringify({ ...body, model: config?.model, stream: false }),
      signal
    });
  } catch (cause) {
    if (cause?.name === "AbortError" || signal?.aborted) throw cause;
    throw clientError("network", "The model request could not be completed.", cause);
  }

  if (!response?.ok) {
    try {
      await response?.text?.();
    } catch {
      // The status code remains authoritative when an error body cannot be read.
    }
    const status = Number(response?.status) || 0;
    const code = mapError(status);
    throw clientError(code, errorMessage(code, status));
  }

  try {
    return await response.json();
  } catch (cause) {
    const detail = cause?.message ? " " + cause.message : "";
    throw clientError("network", "The model returned malformed JSON." + detail, cause);
  }
}

/**
 * Sends a streaming chat-completions request and assembles OpenAI-compatible
 * SSE deltas. The final usage object is retained from the terminal chunk.
 */
export async function streamChatCompletion(
  config,
  body,
  { fetchImpl = globalThis.fetch, signal = null, onEvent = null } = {}
) {
  const endpoint = createChatCompletionsUrl(config?.baseUrl);
  if (typeof fetchImpl !== "function") {
    throw clientError("config", "No fetch implementation is available.");
  }
  if (signal?.aborted) throw abortError();

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + config?.apiKey
      },
      body: JSON.stringify({ ...body, model: config?.model, stream: true }),
      signal
    });
  } catch (cause) {
    if (cause?.name === "AbortError" || signal?.aborted) throw cause?.name === "AbortError" ? cause : abortError();
    throw clientError("network", "The model request could not be completed.", cause);
  }

  if (!response?.ok) {
    try {
      await response?.text?.();
    } catch {
      // The status code remains authoritative when an error body cannot be read.
    }
    const status = Number(response?.status) || 0;
    const code = mapError(status);
    throw clientError(code, errorMessage(code, status));
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw clientError("network", "The model did not return a readable event stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const accumulator = createStreamAccumulator(onEvent);
  let buffer = "";
  let eventLines = [];
  let done = false;
  let cancelled = false;
  const cancelReader = () => {
    if (cancelled) return;
    cancelled = true;
    Promise.resolve(reader.cancel()).catch(() => {});
  };
  const onAbort = () => cancelReader();
  signal?.addEventListener("abort", onAbort, { once: true });

  function consumeEvent() {
    if (eventLines.length === 0) return;
    const lines = eventLines;
    eventLines = [];
    const data = [];
    let sawComment = false;
    for (const line of lines) {
      if (line.startsWith(":")) {
        sawComment = true;
      } else if (line === "data" || line.startsWith("data:")) {
        data.push(line === "data" ? "" : line.slice(5).replace(/^ /, ""));
      }
    }
    if (sawComment) safeEvent(onEvent, { type: "heartbeat" });
    if (data.length === 0) return;
    const payload = data.join("\n");
    if (payload === "[DONE]") {
      done = true;
      return;
    }
    accumulator.consume(JSON.parse(payload));
  }

  try {
    while (!done) {
      if (signal?.aborted) throw abortError();
      const { value, done: readerDone } = await reader.read();
      if (readerDone) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_SSE_BUFFER_CHARACTERS) {
        throw clientError("network", "The model stream exceeded the retained-buffer limit.");
      }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          consumeEvent();
          if (done) break;
        } else {
          eventLines.push(line);
          if (eventLines.join("\n").length > MAX_SSE_EVENT_CHARACTERS) {
            throw clientError("network", "The model stream contained an oversized event.");
          }
        }
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      const tail = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
      if (tail) eventLines.push(tail);
    }
    consumeEvent();
    if (signal?.aborted) throw abortError();
    if (!done) throw clientError("network", "The model stream ended before [DONE].");
    return accumulator.result();
  } catch (cause) {
    cancelReader();
    if (cause?.name === "AbortError" || signal?.aborted) throw cause?.name === "AbortError" ? cause : abortError();
    if (cause?.code) throw cause;
    throw clientError("network", "The model stream could not be processed.", cause);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (signal?.aborted) cancelReader();
  }
}
