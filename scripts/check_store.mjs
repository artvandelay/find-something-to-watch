import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { createStore, KEYS, DEFAULT_LLM } from "../docs/js/store.js";

const mem = new Map();
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); }
};

const s = createStore(storage);

deepStrictEqual(s.getLlm(), DEFAULT_LLM);
strictEqual(s.hasKey(), false);
strictEqual(DEFAULT_LLM.webSearch, false);

s.setLlm({ baseUrl: "https://x/v1", apiKey: "sk-1", model: "m", webSearch: true, junk: 1 });
deepStrictEqual(s.getLlm(), {
  baseUrl: "https://x/v1",
  apiKey: "sk-1",
  model: "m",
  webSearch: true
});
strictEqual(s.hasKey(), true);

storage.setItem(KEYS.llm, JSON.stringify({
  baseUrl: "https://x/v1",
  apiKey: "sk-1",
  model: "m",
  webSearch: "true"
}));
strictEqual(s.getLlm().webSearch, false);

storage.setItem(KEYS.llm, "{not json");
deepStrictEqual(s.getLlm(), DEFAULT_LLM);

s.setLlm({ baseUrl: "https://x/v1", apiKey: "sk-1", model: "m" });
strictEqual(s.getLlm().webSearch, false);

deepStrictEqual(s.getPaneLayout(), { railWidth: null, railCollapsed: false });
s.setPaneLayout({ railWidth: 420.6, railCollapsed: true, junk: 1 });
deepStrictEqual(s.getPaneLayout(), { railWidth: 421, railCollapsed: true });
deepStrictEqual(JSON.parse(mem.get(KEYS.pane)), { railWidth: 421, railCollapsed: true });
s.setPaneLayout({ railWidth: null, railCollapsed: false });
deepStrictEqual(s.getPaneLayout(), { railWidth: null, railCollapsed: false });
storage.setItem(KEYS.pane, "{not json");
deepStrictEqual(s.getPaneLayout(), { railWidth: null, railCollapsed: false });
storage.setItem(KEYS.pane, JSON.stringify({ railWidth: "wide", railCollapsed: "yes" }));
deepStrictEqual(s.getPaneLayout(), { railWidth: null, railCollapsed: false });
storage.setItem(KEYS.pane, JSON.stringify([1, 2, 3]));
deepStrictEqual(s.getPaneLayout(), { railWidth: null, railCollapsed: false });
storage.setItem(KEYS.pane, JSON.stringify({ railWidth: -40 }));
deepStrictEqual(s.getPaneLayout(), { railWidth: null, railCollapsed: false });

s.clearAll();
strictEqual(mem.size, 0);
deepStrictEqual(s.getLlm(), DEFAULT_LLM);
deepStrictEqual(s.getPaneLayout(), { railWidth: null, railCollapsed: false });

console.log("check_store OK");
