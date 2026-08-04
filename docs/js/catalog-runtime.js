const PROTOCOL_VERSION = 1;
const READY_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const CODE_TIMEOUT_MS = 15_000;

export class CatalogRuntimeError extends Error {
  constructor(code, message, { retryable = false, phase = "runtime" } = {}) {
    super(message);
    this.name = "CatalogRuntimeError";
    this.code = code;
    this.retryable = retryable;
    this.phase = phase;
  }
}

function asRuntimeError(error, fallbackCode = "WORKER_ERROR") {
  if (error instanceof CatalogRuntimeError) return error;
  const source = error && typeof error === "object" ? error : {};
  return new CatalogRuntimeError(
    source.code || fallbackCode,
    source.message || "The catalog worker failed.",
    { retryable: Boolean(source.retryable), phase: source.phase || "worker" }
  );
}

function defaultWorkerFactory() {
  return new Worker(new URL("./catalog-worker.js", import.meta.url), { type: "module" });
}

/**
 * Correlates requests to the isolated catalog host. The host remains the
 * authority for catalog data; this class deliberately has no catalog cache.
 */
export function createCatalogRuntime({
  workerFactory = defaultWorkerFactory,
  onState = null,
  requestTimeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  let disposed = false;
  let worker = null;
  let epoch = 0;
  let nextId = 1;
  let state = "BOOTING";
  let initializePromise = null;
  const pending = new Map();
  const readyWaiters = new Set();

  function emitState(nextState) {
    state = nextState;
    if (typeof onState === "function") {
      try {
        onState(nextState);
      } catch {
        // UI observers must not compromise catalog isolation.
      }
    }
    if (nextState === "READY_BASIC" || nextState === "READY_RICH") {
      for (const waiter of readyWaiters) waiter.resolve();
      readyWaiters.clear();
    }
  }

  function rejectPending(error, onlyEpoch = null) {
    for (const [id, entry] of pending) {
      if (onlyEpoch !== null && entry.epoch !== onlyEpoch) continue;
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(error);
    }
  }

  function terminateCurrent() {
    if (!worker) return;
    const current = worker;
    worker = null;
    current.onmessage = null;
    current.onerror = null;
    current.onmessageerror = null;
    if (typeof current.terminate === "function") current.terminate();
  }

  function handleFatal(error) {
    const oldEpoch = epoch;
    terminateCurrent();
    const failure = asRuntimeError(error, "WORKER_RESTARTED");
    rejectPending(
      new CatalogRuntimeError("WORKER_RESTARTED", "The catalog worker restarted.", {
        retryable: true,
        phase: failure.phase || "worker"
      }),
      oldEpoch
    );
    initializePromise = null;
    for (const waiter of readyWaiters) waiter.reject(
      new CatalogRuntimeError("WORKER_RESTARTED", "The catalog worker restarted.", {
        retryable: true,
        phase: failure.phase || "worker"
      })
    );
    readyWaiters.clear();
    if (disposed) return;
    emitState("RESTARTING");
    startWorker();
  }

  function handleMessage(event) {
    const message = event && event.data;
    if (!message || message.v !== PROTOCOL_VERSION || message.epoch !== epoch) return;

    if ((message.type === "state" || message.type === "event") && typeof message.state === "string") {
      emitState(message.state);
      return;
    }
    if (message.type !== "response" || !Number.isInteger(message.id)) return;
    const entry = pending.get(message.id);
    if (!entry || entry.epoch !== message.epoch) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.ok === true) entry.resolve(message.value);
    else entry.reject(asRuntimeError(message.error, "REQUEST_FAILED"));
  }

  function startWorker() {
    if (disposed || worker) return;
    epoch += 1;
    emitState("BOOTING");
    try {
      worker = workerFactory();
    } catch (error) {
      emitState("RESTARTING");
      return;
    }
    worker.onmessage = handleMessage;
    worker.onerror = (event) => handleFatal(event && (event.error || event));
    worker.onmessageerror = () => handleFatal(
      new CatalogRuntimeError("WORKER_MESSAGE_ERROR", "The catalog worker sent an invalid message.", {
        retryable: true,
        phase: "worker"
      })
    );
  }

  function request(op, payload, timeoutMs = requestTimeoutMs) {
    if (disposed) {
      return Promise.reject(new CatalogRuntimeError("DISPOSED", "Catalog runtime has been disposed."));
    }
    startWorker();
    if (!worker) {
      return Promise.reject(new CatalogRuntimeError("WORKER_UNAVAILABLE", "Catalog worker is unavailable.", {
        retryable: true,
        phase: "worker"
      }));
    }
    const id = nextId++;
    const requestEpoch = epoch;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new CatalogRuntimeError("TIMEOUT", "Catalog request timed out.", {
          retryable: true,
          phase: op === "tool.execute" ? "execute" : "request"
        }));
      }, Math.max(0, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
      pending.set(id, { epoch: requestEpoch, timer, resolve, reject });
      try {
        worker.postMessage({ v: PROTOCOL_VERSION, type: "request", epoch: requestEpoch, id, op, payload });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(asRuntimeError(error, "POST_FAILED"));
      }
    });
  }

  async function withReady(op, payload, timeoutMs) {
    await initialize();
    return request(op, payload, timeoutMs);
  }

  function initialize(payload = {}) {
    if (disposed) {
      return Promise.reject(new CatalogRuntimeError("DISPOSED", "Catalog runtime has been disposed."));
    }
    if (state === "READY_BASIC" || state === "READY_RICH") return Promise.resolve();
    if (initializePromise) return initializePromise;
    initializePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        readyWaiters.delete(waiter);
        initializePromise = null;
        reject(new CatalogRuntimeError("READY_TIMEOUT", "Catalog did not become ready in time.", {
          retryable: true,
          phase: "initialize"
        }));
      }, READY_TIMEOUT_MS);
      const waiter = {
        resolve: () => {
          clearTimeout(timeout);
          initializePromise = null;
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          initializePromise = null;
          reject(error);
        }
      };
      readyWaiters.add(waiter);
      request("initialize", payload, READY_TIMEOUT_MS).catch((error) => {
        if (!readyWaiters.delete(waiter)) return;
        waiter.reject(error);
      });
    });
    return initializePromise;
  }

  startWorker();

  return Object.freeze({
    getState() { return state; },
    get state() { return state; },
    get epoch() { return epoch; },
    initialize,
    describe(payload = {}) { return withReady("describe", payload, requestTimeoutMs); },
    runCode(payload = {}) { return withReady("tool.execute", payload, CODE_TIMEOUT_MS); },
    async keywordSearch(payload = {}) {
      const value = await withReady("keywordSearch", payload, requestTimeoutMs);
      return Array.isArray(value?.results) ? value.results : [];
    },
    async resolve(payload = {}) {
      const value = await withReady("resolve", payload, requestTimeoutMs);
      return Array.isArray(value?.results) ? value.results : [];
    },
    async seedQueue(payload = {}) {
      const value = await withReady("seedQueue", payload, requestTimeoutMs);
      return Array.isArray(value?.results) ? value.results : [];
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      initializePromise = null;
      terminateCurrent();
      rejectPending(new CatalogRuntimeError("DISPOSED", "Catalog runtime has been disposed."));
      for (const waiter of readyWaiters) waiter.reject(new CatalogRuntimeError("DISPOSED", "Catalog runtime has been disposed."));
      readyWaiters.clear();
    }
  });
}
