import { executeCatalogCode, prepareExecutionEnvironment } from "./catalog-execution.js";

const workerPostMessage = globalThis.postMessage.bind(globalThis);
const CAPABILITIES_TO_DISABLE = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "WebTransport",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "indexedDB",
  "caches",
  "importScripts",
  "postMessage"
];

let environment = null;
let hasExecuted = false;
let initialized = false;

function hardenWorker() {
  for (const capability of CAPABILITIES_TO_DISABLE) {
    try {
      Object.defineProperty(globalThis, capability, {
        value: undefined,
        writable: false,
        configurable: false
      });
    } catch {
      try {
        globalThis[capability] = undefined;
      } catch {
        // Some host globals are non-configurable. They are never passed in.
      }
    }
  }
}

function errorPayload(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "EXECUTION_ERROR",
    message: "Catalog code could not be executed."
  };
}

function send(message) {
  workerPostMessage(message);
}

globalThis.addEventListener("message", async (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;

  if (message.type === "init") {
    if (initialized) {
      send({ type: "error", error: { code: "INVALID_PROTOCOL", message: "Worker is already initialized." } });
      return;
    }
    try {
      environment = prepareExecutionEnvironment(message.projectionJson);
      initialized = true;
      hardenWorker();
      send({ type: "ready" });
    } catch (error) {
      send({ type: "error", error: errorPayload(error) });
    }
    return;
  }

  if (message.type !== "execute" || !initialized || hasExecuted) {
    send({ type: "error", error: { code: "INVALID_PROTOCOL", message: "Invalid worker request." } });
    return;
  }

  hasExecuted = true;
  try {
    const result = await executeCatalogCode(message.code, environment);
    send({ type: "result", result });
  } catch (error) {
    send({ type: "result", error: errorPayload(error) });
  }
});
