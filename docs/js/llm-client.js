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
