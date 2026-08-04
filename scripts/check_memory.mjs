import assert from "node:assert/strict";
import {
  BrowserMemoryError,
  createBrowserMemory,
  MEMORY_KEYS,
  MEMORY_LIMITS
} from "../docs/js/memory.js";
import { KEYS } from "../docs/js/store.js";

class FakeTransaction {
  constructor(records, writable, failWrites) {
    this.records = records;
    this.writable = writable;
    this.failWrites = failWrites;
    this.completed = false;
    this.oncomplete = null;
    this.onabort = null;
    this.onerror = null;
  }

  completeSoon() {
    if (this.completed) return;
    this.completed = true;
    queueMicrotask(() => this.oncomplete?.());
  }

  objectStore() {
    return {
      get: (key) => {
        const request = {};
        queueMicrotask(() => {
          request.result = this.records.get(key);
          request.onsuccess?.();
          this.completeSoon();
        });
        return request;
      },
      put: (value, key) => {
        if (!this.writable) throw new Error("readonly");
        if (this.failWrites) {
          const error = new Error("quota");
          error.name = "QuotaExceededError";
          throw error;
        }
        this.records.set(key, JSON.parse(JSON.stringify(value)));
        this.completeSoon();
      },
      clear: () => {
        if (!this.writable) throw new Error("readonly");
        this.records.clear();
        this.completeSoon();
      }
    };
  }
}

class FakeDatabase {
  constructor(records, idb) {
    this.records = records;
    this.idb = idb;
    this.objectStoreNames = { contains: () => true };
  }

  createObjectStore() {}

  transaction(_store, mode) {
    return new FakeTransaction(this.records, mode === "readwrite", this.idb.failWrites);
  }
}

class FakeIndexedDB {
  constructor() {
    this.records = new Map();
    this.failWrites = false;
  }

  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = new FakeDatabase(this.records, this);
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
}

function storageFrom(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values
  };
}

const idb = new FakeIndexedDB();
const storage = storageFrom({
  [KEYS.llm]: JSON.stringify({ apiKey: "sk-test" }),
  [KEYS.youmd]: "# Legacy taste",
  [KEYS.history]: JSON.stringify({ importedAt: "2026-08-04T00:00:00.000Z", seen: ["a"] })
});
const memory = createBrowserMemory({
  indexedDB: idb,
  localStorage: storage,
  now: () => new Date("2026-08-05T00:00:00.000Z")
});

const initialized = await memory.initialize();
assert.deepEqual(initialized.migrated.sort(), [MEMORY_KEYS.history, MEMORY_KEYS.youmd]);
assert.equal(storage.getItem(KEYS.llm), JSON.stringify({ apiKey: "sk-test" }));
assert.equal(storage.getItem(KEYS.youmd), null);
assert.equal(storage.getItem(KEYS.history), null);
assert.equal(await memory.getYouMd(), "# Legacy taste");
assert.deepEqual(await memory.getHistory(), { importedAt: "2026-08-04T00:00:00.000Z", seen: ["a"] });

const profile = await memory.setProfile({
  onboardingComplete: true,
  providers: ["Netflix", "netflix", "unknown-provider", "prime", ...Array(30).fill("hotstar")]
});
assert.deepEqual(profile.providers, ["netflix", "prime", "hotstar"]);
assert.equal(profile.onboardingComplete, true);

const conversation = await memory.setConversation({
  messages: Array.from({ length: MEMORY_LIMITS.conversationMessages + 3 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: "x".repeat(MEMORY_LIMITS.messageCharacters + 1),
    createdAt: "2026-08-04T00:00:00.000Z"
  }))
});
assert.equal(conversation.messages.length, MEMORY_LIMITS.conversationMessages);
assert.equal(conversation.messages[0].content.length, MEMORY_LIMITS.messageCharacters);

const queue = await memory.setQueue({
  ids: ["tmdb:one", "tmdb:one", ...Array.from({ length: 25 }, (_, index) => `tmdb:${index}`)]
});
assert.equal(queue.ids.length, MEMORY_LIMITS.queueItems);
assert.equal(new Set(queue.ids).size, MEMORY_LIMITS.queueItems);

await memory.saveConversationAndQueue(
  { messages: [{ role: "user", content: "new turn" }] },
  { ids: ["tmdb:atomic"] }
);
assert.equal((await memory.getConversation()).messages[0].content, "new turn");
assert.deepEqual((await memory.getQueue()).ids, ["tmdb:atomic"]);

const backup = await memory.exportBackup();
assert.equal(backup.schema, 1);
assert.equal("llm" in backup, false);
await memory.importBackup(backup);
assert.deepEqual((await memory.getQueue()).ids, ["tmdb:atomic"]);
await assert.rejects(
  memory.importBackup({ schema: 1, profile: {} }),
  (error) => error instanceof BrowserMemoryError && error.code === "invalid"
);
assert.deepEqual((await memory.getQueue()).ids, ["tmdb:atomic"]);

idb.records.set(MEMORY_KEYS.queue, { ids: "not an array" });
assert.deepEqual((await memory.getQueue()).ids, []);
assert.equal(memory.getIssues().at(-1).code, "corrupt");

idb.failWrites = true;
await assert.rejects(
  memory.setYouMd("will not fit"),
  (error) => error instanceof BrowserMemoryError && error.code === "quota"
);
idb.failWrites = false;

await memory.clear();
assert.equal((await memory.getConversation()).messages.length, 0);
assert.equal((await memory.getQueue()).ids.length, 0);

console.log("check_memory OK");
