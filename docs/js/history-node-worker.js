import { parentPort } from "node:worker_threads";
import { executeHistoryExtractor } from "./history-extract.js";

parentPort.on("message", (data) => {
  if (!data || data.type !== "run" || typeof data.code !== "string") {
    parentPort.postMessage({ type: "error", message: "The generated history reader was rejected." });
    return;
  }
  try {
    const entries = executeHistoryExtractor(data.code, data.files, data.limits);
    parentPort.postMessage({ type: "result", entries });
  } catch (error) {
    parentPort.postMessage({ type: "error", message: error?.message || "The generated history reader failed." });
  }
});
