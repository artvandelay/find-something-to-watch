import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CatalogRuntimeError, createCatalogRuntime } from "../docs/js/catalog-runtime.js";

class FakeWorker {
  constructor({ autoInitialize = true } = {}) {
    this.autoInitialize = autoInitialize;
    this.sent = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
  }

  postMessage(message) {
    this.sent.push(message);
    if (this.autoInitialize && message.op === "initialize") {
      this.emit({ v: 1, type: "state", epoch: message.epoch, state: "READY_BASIC" });
      this.emit({ v: 1, type: "response", epoch: message.epoch, id: message.id, ok: true, value: {} });
    }
  }

  terminate() {
    this.terminated = true;
  }

  emit(data) {
    this.onmessage?.({ data });
  }

  crash(error = new Error("boom")) {
    this.onerror?.({ error });
  }
}

function factory(workers, options) {
  return () => {
    const worker = new FakeWorker(options);
    workers.push(worker);
    return worker;
  };
}

async function expectError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof CatalogRuntimeError);
    assert.equal(error.code, code);
    return true;
  });
}

{
  const workers = [];
  const states = [];
  const runtime = createCatalogRuntime({ workerFactory: factory(workers), onState: (state) => states.push(state) });
  await Promise.all([runtime.initialize(), runtime.initialize()]);
  const worker = workers[0];
  assert.equal(worker.sent.filter((message) => message.op === "initialize").length, 1);

  const pending = runtime.keywordSearch({ query: "comedy" });
  await Promise.resolve();
  const request = worker.sent.at(-1);
  worker.emit({ v: 1, type: "response", epoch: request.epoch - 1, id: request.id, ok: true, value: { results: ["stale"] } });
  worker.emit({ v: 1, type: "response", epoch: request.epoch, id: request.id, ok: true, value: { results: ["matched"] } });
  assert.deepEqual(await pending, ["matched"]);
  assert.ok(states.includes("READY_BASIC"));
  runtime.dispose();
}

{
  const workers = [];
  const runtime = createCatalogRuntime({ workerFactory: factory(workers), requestTimeoutMs: 5 });
  await runtime.initialize();
  const pending = runtime.resolve({ ids: ["tmdb:m1"] });
  await Promise.resolve();
  await expectError(pending, "TIMEOUT");
  runtime.dispose();
}

{
  const workers = [];
  const runtime = createCatalogRuntime({ workerFactory: factory(workers) });
  await runtime.initialize();
  const pending = runtime.seedQueue({});
  await Promise.resolve();
  workers[0].crash();
  await expectError(pending, "WORKER_RESTARTED");
  assert.equal(workers.length, 2);
  runtime.dispose();
}

{
  const workers = [];
  const runtime = createCatalogRuntime({ workerFactory: factory(workers) });
  await runtime.initialize();
  const pending = runtime.describe({});
  await Promise.resolve();
  runtime.dispose();
  await expectError(pending, "DISPOSED");
  assert.equal(workers[0].terminated, true);
}

{
  const workerSource = readFileSync(
    fileURLToPath(new URL("../docs/js/catalog-worker.js", import.meta.url)),
    "utf8"
  );
  assert.match(workerSource, /s: record\.s \|\| "",\s+l: record\.l \|\| null,\s+g: Array\.isArray\(record\.g\) \? record\.g : \[\],/);
  const settled = workerSource.indexOf("let settled = false;");
  const guard = workerSource.indexOf("if (settled) return;", settled);
  const set = workerSource.indexOf("settled = true;", guard);
  const clear = workerSource.indexOf("clearTimeout(timer);", set);
  assert.ok(settled >= 0 && guard > settled && set > guard && clear > set);
}

console.log("check_catalog_runtime: ok");
