const RUN_TIMEOUT_MS = 15000;

function abortError() {
  const error = new Error("The history import was cancelled.");
  error.name = "AbortError";
  return error;
}

function readerError(message) {
  const error = new Error(message || "The generated history reader failed.");
  error.code = "plan";
  return error;
}

function adaptNodeWorker(node) {
  return {
    postMessage(data) {
      node.postMessage(data);
    },
    set onmessage(fn) {
      node.on("message", (data) => fn({ data }));
    },
    set onerror(fn) {
      node.on("error", (error) => fn({ error }));
    },
    terminate() {
      return node.terminate();
    }
  };
}

async function openWorker() {
  if (typeof Worker === "function") {
    return new Worker(new URL("./history-executor.js", import.meta.url), { type: "module" });
  }
  const { Worker: NodeWorker } = await import("node:worker_threads");
  return adaptNodeWorker(new NodeWorker(new URL("./history-node-worker.js", import.meta.url), { type: "module" }));
}

function runOnce(worker, payload, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(readerError("The generated history reader timed out.")), RUN_TIMEOUT_MS);
    const onAbort = () => finish(abortError());

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value);
    }

    worker.onmessage = (event) => {
      const data = event?.data;
      if (data?.type === "result" && Array.isArray(data.entries)) finish(null, data.entries);
      else finish(readerError(data?.message));
    };
    worker.onerror = () => finish(readerError("The generated history reader failed."));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      worker.postMessage(payload);
    } catch {
      finish(readerError("The generated history reader failed."));
    }
  });
}

export function createHistoryRuntime() {
  return {
    async run({ code, files, limits, signal = null } = {}) {
      if (signal?.aborted) throw abortError();
      const worker = await openWorker();
      try {
        return await runOnce(worker, {
          type: "run",
          code,
          files,
          limits: limits
            ? {
              records: limits.records,
              fields: limits.fields,
              fieldCharacters: limits.fieldCharacters
            }
            : null
        }, signal);
      } finally {
        try {
          worker.terminate();
        } catch {
          // The worker already stopped.
        }
      }
    }
  };
}
