import { executeHistoryExtractor } from "./history-extract.js";

const send = postMessage.bind(globalThis);
const CAPABILITIES = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "importScripts",
  "indexedDB"
];

let ran = false;

function harden() {
  for (const name of CAPABILITIES) {
    try {
      Object.defineProperty(globalThis, name, {
        value: undefined,
        writable: false,
        configurable: false
      });
    } catch {
      // Some host globals are non-configurable. The source allowlist still rejects them.
    }
  }
}

addEventListener("message", (event) => {
  const data = event.data;
  if (ran || !data || data.type !== "run" || typeof data.code !== "string") {
    send({ type: "error", message: "The generated history reader was rejected." });
    return;
  }
  ran = true;
  try {
    harden();
    const entries = executeHistoryExtractor(data.code, data.files, data.limits);
    send({ type: "result", entries });
  } catch (error) {
    send({ type: "error", message: error?.message || "The generated history reader failed." });
  }
});
