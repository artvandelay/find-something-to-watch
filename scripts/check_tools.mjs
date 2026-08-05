import { strictEqual, deepStrictEqual, ok, rejects } from "node:assert/strict";
import { createTools } from "../docs/js/tools.js";

function fakeRuntime({ result = { summary: "ok" }, observedIds = [], error = null } = {}) {
  const calls = { runCode: [], resolve: [] };
  return {
    calls,
    async runCode(request) {
      calls.runCode.push(request);
      if (error) throw error;
      return { result: JSON.stringify(result), observedIds };
    },
    async resolve(request) {
      calls.resolve.push(request);
      return request.ids.map((id) => ({ id }));
    }
  };
}

const scope = { subscriptions: ["netflix"] };
const runtime = fakeRuntime({
  result: { titles: ["tmdb:1", "tmdb:2"] },
  observedIds: ["tmdb:1", "tmdb:2", "tmdb:1"]
});
const tools = createTools({
  runtime,
  scope,
  currentQueueIds: ["queue:1", "queue:1", "", 42],
  seenKeys: ["watched:1", " watched:1 ", "", 42, "watched:2"]
});

strictEqual(tools.schemas.length, 1);
strictEqual(Object.keys(tools.handlers).length, 1);
strictEqual(tools.schemas[0].type, "function");
strictEqual(tools.schemas[0].function.name, "run_catalog_js");
strictEqual(tools.schemas[0].function.parameters.properties.code.maxLength, 12000);
strictEqual(tools.schemas[0].function.parameters.additionalProperties, false);
ok(tools.schemas[0].function.description.includes("catalog"));
ok(tools.schemas[0].function.description.includes("return"));
ok(!("search_titles" in tools.handlers));
ok(!("filter_titles" in tools.handlers));
ok(!("get_titles" in tools.handlers));
ok(!("sample_titles" in tools.handlers));

const success = await tools.handlers.run_catalog_js({ code: "return catalog.search('quiet');" });
deepStrictEqual(success, { result: { titles: ["tmdb:1", "tmdb:2"] }, count: 2 });
deepStrictEqual(runtime.calls.runCode, [{
  code: "return catalog.search('quiet');",
  scope,
  excludeKeys: ["watched:1", "watched:2"]
}]);

const malformed = await tools.handlers.run_catalog_js({ code: 42 });
strictEqual(malformed.code, "invalid_args");
strictEqual(malformed.count, 0);
strictEqual(runtime.calls.runCode.length, 1);

const oversized = await tools.handlers.run_catalog_js({ code: "x".repeat(12001) });
strictEqual(oversized.code, "invalid_args");
strictEqual(oversized.count, 0);

const runtimeError = fakeRuntime({ error: Object.assign(new Error("execution stopped"), { code: "limit" }) });
const failingTools = createTools({ runtime: runtimeError, scope });
deepStrictEqual(
  await failingTools.handlers.run_catalog_js({ code: "return 1;" }),
  { error: "execution stopped", code: "limit", count: 0 }
);

const resolved = await tools.resolve(["queue:1", "tmdb:2", "blocked:1", "tmdb:1", "tmdb:2"]);
deepStrictEqual(resolved, [{ id: "queue:1" }, { id: "tmdb:2" }, { id: "tmdb:1" }]);
deepStrictEqual(runtime.calls.resolve, [{
  ids: ["queue:1", "tmdb:2", "tmdb:1"],
  scope
}]);

const manyObserved = Array.from({ length: 30 }, (_, i) => "tmdb:" + i);
const cappedRuntime = fakeRuntime({ observedIds: manyObserved });
const cappedTools = createTools({ runtime: cappedRuntime, scope });
await cappedTools.handlers.run_catalog_js({ code: "return [];" });
await cappedTools.resolve([...manyObserved, ...manyObserved]);
strictEqual(cappedRuntime.calls.resolve.length, 1);
strictEqual(cappedRuntime.calls.resolve[0].ids.length, 20);
deepStrictEqual(cappedRuntime.calls.resolve[0].scope, scope);

const isolatedRuntime = fakeRuntime({ observedIds: ["isolated:1"] });
const isolatedTools = createTools({ runtime: isolatedRuntime, scope });
deepStrictEqual(await isolatedTools.resolve(["tmdb:1", "queue:1"]), []);
await isolatedTools.handlers.run_catalog_js({ code: "return null;" });
deepStrictEqual(await isolatedTools.resolve(["tmdb:1", "isolated:1"]), [{ id: "isolated:1" }]);

const abortedRuntime = fakeRuntime();
const abortedTools = createTools({
  runtime: abortedRuntime,
  scope,
  currentQueueIds: ["queue:1"]
});
const controller = new AbortController();
controller.abort();
await rejects(
  abortedTools.handlers.run_catalog_js({ code: "return [];" }, controller.signal),
  { name: "AbortError" }
);
await rejects(abortedTools.resolve(["queue:1"], controller.signal), { name: "AbortError" });
strictEqual(abortedRuntime.calls.runCode.length, 0);
strictEqual(abortedRuntime.calls.resolve.length, 0);

{
  const seen = [];
  const runtime = {
    runCode(_request, signal) {
      seen.push(signal);
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      });
    },
    resolve(_request, signal) {
      seen.push(signal);
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      });
    }
  };
  const signalTools = createTools({ runtime, scope, currentQueueIds: ["queue:1"] });
  const runController = new AbortController();
  const pendingRun = signalTools.handlers.run_catalog_js({ code: "return [];" }, runController.signal);
  runController.abort();
  await rejects(pendingRun, { name: "AbortError" });
  const resolveController = new AbortController();
  const pendingResolve = signalTools.resolve(["queue:1"], resolveController.signal);
  resolveController.abort();
  await rejects(pendingResolve, { name: "AbortError" });
  strictEqual(seen.length, 2);
  strictEqual(seen[0], runController.signal);
  strictEqual(seen[1], resolveController.signal);
}

console.log("check_tools OK");
