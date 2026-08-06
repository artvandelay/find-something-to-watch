import assert from "node:assert/strict";
import {
  BrowserMemoryError,
  createBrowserMemory,
  MEMORY_KEYS,
  MEMORY_LIMITS,
  MEMORY_SCHEMA_VERSION
} from "../docs/js/memory.js";
import { KEYS } from "../docs/js/store.js";
import { addToPlaylist, defaultPlaylists } from "../docs/js/playlists.js";

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
assert.deepEqual(await memory.getPlaylists(), defaultPlaylists(() => new Date("2026-08-05T00:00:00.000Z")));
assert.equal(idb.records.has(MEMORY_KEYS.playlists), true);

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
assert.equal(queue.items.length, MEMORY_LIMITS.queueItems);
assert.equal(new Set(queue.items.map((item) => item.id)).size, MEMORY_LIMITS.queueItems);

await memory.saveConversationAndQueue(
  { messages: [{ role: "user", content: "new turn" }] },
  { ids: ["tmdb:atomic"] }
);
assert.equal((await memory.getConversation()).messages[0].content, "new turn");
assert.deepEqual((await memory.getQueue()).items.map((item) => item.id), ["tmdb:atomic"]);

const savedPlaylists = await memory.setPlaylists(addToPlaylist(
  await memory.getPlaylists(),
  "watch-later",
  "tmdb:playlist",
  { now: () => new Date("2026-08-05T00:00:00.000Z") }
));
assert.deepEqual(savedPlaylists.playlists[0].titleIds, ["tmdb:playlist"]);
await memory.saveConversationAndQueue(
  { messages: [{ role: "assistant", content: "replacement turn" }] },
  { ids: ["tmdb:replacement"] }
);
assert.deepEqual((await memory.getPlaylists()).playlists[0].titleIds, ["tmdb:playlist"]);

const backup = await memory.exportBackup();
assert.equal(backup.schema, MEMORY_SCHEMA_VERSION);
assert.equal("llm" in backup, false);
assert.equal("issues" in backup, false);
assert.deepEqual(backup.threads.items, []);
assert.deepEqual(backup.learned.items, []);
assert.deepEqual(backup.playlists.playlists[0].titleIds, ["tmdb:playlist"]);
assert.deepEqual((await memory.getQueue()).items.map((item) => item.id), ["tmdb:replacement"]);
assert.deepEqual((await memory.getPlaylists()).playlists[0].titleIds, ["tmdb:playlist"]);

const active = await memory.getConversation();
await memory.appendUserMessage(active.id, "I always avoid horror.");
const completed = await memory.completeTurn(active.id, {
  content: "Try a comedy.",
  queue: {
    source: { conversationId: active.id, turnId: "turn-1", query: "I always avoid horror." },
    items: [{ id: "tmdb:comedy", reason: "No horror." }]
  }
});
assert.equal(completed.conversation.messages.length, 3);
assert.equal(completed.queue.items[0].reason, "No horror.");
await assert.rejects(
  memory.appendUserMessage("stale-id", "Nope"),
  (error) => error instanceof BrowserMemoryError && error.code === "invalid"
);
const archived = await memory.startNewConversation();
assert.equal(archived.conversation.messages.length, 0);
assert.equal(archived.threads.items.length, 1);
assert.deepEqual(archived.threads.items[0].queue.items.map((item) => item.id), ["tmdb:comedy"]);
const restored = await memory.activateArchivedConversation(active.id);
assert.equal(restored.conversation.id, active.id);
assert.deepEqual(restored.queue.items.map((item) => item.id), ["tmdb:comedy"]);
const list = await memory.getConversationList();
assert.equal(list.active.id, active.id);

const renamed = await memory.renameConversation(active.id, "  Friday picks  ");
assert.equal(renamed.conversation.title, "Friday picks");
assert.equal((await memory.getConversation()).title, "Friday picks");
await memory.startNewConversation();
const archivedRename = await memory.renameConversation(active.id, "Archive label");
assert.equal(archivedRename.threads.items.find((item) => item.id === active.id)?.title, "Archive label");
const deletedArchive = await memory.deleteConversation(active.id);
assert.equal(deletedArchive.threads.items.some((item) => item.id === active.id), false);
const currentId = (await memory.getConversation()).id;
await memory.appendUserMessage(currentId, "Keep this one");
await memory.completeTurn(currentId, { content: "Okay.", queue: { items: [{ id: "tmdb:keep" }] } });
const newer = await memory.startNewConversation();
assert.equal(newer.threads.items.some((item) => item.id === currentId), true);
const deletedActive = await memory.deleteConversation(newer.conversation.id);
assert.equal(deletedActive.conversation.id, currentId);
assert.deepEqual(deletedActive.queue.items.map((item) => item.id), ["tmdb:keep"]);

await memory.saveContextMemory({
  profile: { ...(await memory.getProfile()), memoryEnabled: false },
  learned: {
    schema: 1,
    revision: 1,
    items: [{ id: "fact-1", kind: "genre", polarity: "avoid", value: "horror" }]
  }
});
assert.equal((await memory.getProfile()).memoryEnabled, false);
assert.equal((await memory.getLearned()).items[0].value, "horror");

const concurrentConversation = await memory.getConversation();
await Promise.all([
  memory.appendUserMessage(concurrentConversation.id, "First concurrent message"),
  memory.appendUserMessage(concurrentConversation.id, "Second concurrent message")
]);
assert.deepEqual(
  (await memory.getConversation()).messages.slice(-2).map((message) => message.content),
  ["First concurrent message", "Second concurrent message"]
);

const pending = await memory.appendUserMessage(concurrentConversation.id, "Pending rollback.");
const pendingMarker = pending.conversation.messages.at(-1);
const unchanged = await memory.removeLastPendingUserMessage(concurrentConversation.id, {
  content: "A newer message",
  createdAt: pendingMarker.createdAt
});
assert.equal(unchanged.conversation.messages.at(-1)?.content, "Pending rollback.");
const rolledBack = await memory.removeLastPendingUserMessage(concurrentConversation.id, {
  content: pendingMarker.content,
  createdAt: pendingMarker.createdAt
});
assert.equal(rolledBack.conversation.messages.at(-1)?.content, "Second concurrent message");

idb.records.set(MEMORY_KEYS.queue, { ids: "not an array" });
assert.deepEqual((await memory.getQueue()).items, []);
assert.equal(memory.getIssues().at(-1).code, "corrupt");

idb.records.set(MEMORY_KEYS.playlists, { playlists: "not an array" });
assert.deepEqual((await memory.getPlaylists()).playlists, defaultPlaylists(() => new Date("2026-08-05T00:00:00.000Z")).playlists);
assert.equal(memory.getIssues().at(-1).code, "corrupt");

const cappedPlaylists = await memory.setPlaylists({
  playlists: Array.from({ length: 60 }, (_, index) => ({
    id: `playlist-${index}`,
    name: `Playlist ${index}`,
    titleIds: Array.from({ length: 510 }, (_, titleIndex) => `tmdb:${index}-${titleIndex}`)
  }))
});
assert.equal(cappedPlaylists.playlists.length, 50);
assert.equal(cappedPlaylists.playlists[0].id, "watch-later");
assert.equal(cappedPlaylists.playlists[0].titleIds.length, 0);
assert.equal(cappedPlaylists.playlists[1].titleIds.length, 500);

idb.failWrites = true;
await assert.rejects(
  memory.setYouMd("will not fit"),
  (error) => error instanceof BrowserMemoryError && error.code === "quota"
);
idb.failWrites = false;

await memory.clear();
assert.equal((await memory.getConversation()).messages.length, 0);
assert.equal((await memory.getQueue()).items.length, 0);
assert.equal(idb.records.has(MEMORY_KEYS.playlists), false);
assert.deepEqual((await memory.getPlaylists()).playlists, defaultPlaylists(() => new Date("2026-08-05T00:00:00.000Z")).playlists);

console.log("check_memory OK");
