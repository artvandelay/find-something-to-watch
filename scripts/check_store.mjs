import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { createStore, KEYS, DEFAULT_LLM, YOUMD_TEMPLATE } from "../docs/js/store.js";

const mem = new Map();
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); }
};

const s = createStore(storage);

deepStrictEqual(s.getLlm(), DEFAULT_LLM);
strictEqual(s.hasKey(), false);

s.setLlm({ baseUrl: "https://x/v1", apiKey: "sk-1", model: "m", junk: 1 });
deepStrictEqual(s.getLlm(), { baseUrl: "https://x/v1", apiKey: "sk-1", model: "m" });
strictEqual(s.hasKey(), true);

strictEqual(s.getYouMd(), YOUMD_TEMPLATE);
s.setYouMd("hello");
strictEqual(s.getYouMd(), "hello");

strictEqual(s.getHistory(), null);
s.setHistory({ seen: ["a"] });
deepStrictEqual(s.getHistory(), { seen: ["a"] });
s.setHistory(null);
strictEqual(s.getHistory(), null);

storage.setItem(KEYS.llm, "{not json");
deepStrictEqual(s.getLlm(), DEFAULT_LLM);

s.clearAll();
strictEqual(mem.size, 0);
deepStrictEqual(s.getLlm(), DEFAULT_LLM);

console.log("check_store OK");
