import { LEGACY_CONTEXT_KEYS, YOUMD_TEMPLATE } from "./store.js";
import { PROVIDER_SLUGS } from "./providers.js";
import { defaultPlaylists, sanitizePlaylists } from "./playlists.js";
import {
  defaultRecommendationQueue,
  sanitizeRecommendationQueue
} from "./recommendations.js";
import {
  defaultLearnedPreferences,
  sanitizeLearnedPreferences
} from "./preferences.js";

export const MEMORY_DB_NAME = "ottbyok.memory";
export const MEMORY_DB_VERSION = 1;
export const MEMORY_SCHEMA_VERSION = 3;
export const MEMORY_STORE = "memory";

export const MEMORY_KEYS = Object.freeze({
  profile: "profile",
  conversation: "conversation",
  queue: "queue",
  threads: "threads",
  learned: "learned",
  youmd: "youmd",
  history: "history",
  playlists: "playlists"
});

export const MEMORY_LIMITS = Object.freeze({
  profileProviders: 26,
  conversationMessages: 24,
  messageCharacters: 6000,
  queueItems: 20,
  inactiveConversations: 20,
  learnedFacts: 100,
  youmdCharacters: 50000,
  historyBytes: 1024 * 1024,
  issues: 20
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const PROVIDER_SET = new Set(PROVIDER_SLUGS);

export class BrowserMemoryError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "BrowserMemoryError";
    this.code = code;
    this.cause = cause;
  }
}

function nowIso(now) {
  return now().toISOString();
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === "string" && ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function boundedString(value, max) {
  if (typeof value !== "string") return null;
  return value.slice(0, max);
}

function collapsedString(value, max) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function newConversationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "conversation-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function safeStorageRead(storage, key) {
  try {
    return storage && typeof storage.getItem === "function" ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeStorageRemove(storage, key) {
  try {
    storage?.removeItem?.(key);
    return true;
  } catch {
    return false;
  }
}

function errorCode(error) {
  if (error?.name === "QuotaExceededError") return "quota";
  if (error?.name === "AbortError") return "aborted";
  if (error?.name === "InvalidStateError" || error?.name === "VersionError") return "unavailable";
  return "storage";
}

function asMemoryError(error, operation) {
  if (error instanceof BrowserMemoryError) return error;
  return new BrowserMemoryError(errorCode(error), `Browser memory ${operation} failed.`, error);
}

function profileDefault() {
  return {
    schema: MEMORY_SCHEMA_VERSION,
    updatedAt: null,
    onboardingComplete: false,
    providers: [],
    memoryEnabled: true
  };
}

function conversationDefault(now) {
  const timestamp = nowIso(now);
  return {
    schema: MEMORY_SCHEMA_VERSION,
    id: newConversationId(),
    title: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: []
  };
}

function queueDefault() {
  return defaultRecommendationQueue();
}

function threadsDefault() {
  return { schema: MEMORY_SCHEMA_VERSION, updatedAt: null, items: [] };
}

function learnedDefault() {
  return defaultLearnedPreferences();
}

function sanitizeProfile(value, now) {
  if (!isPlainObject(value)) return null;
  const providers = Array.isArray(value.providers) ? value.providers : [];
  const uniqueProviders = [];
  for (const provider of providers) {
    const slug = typeof provider === "string" ? provider.trim().toLowerCase() : "";
    if (PROVIDER_SET.has(slug) && !uniqueProviders.includes(slug)) uniqueProviders.push(slug);
    if (uniqueProviders.length === MEMORY_LIMITS.profileProviders) break;
  }
  return {
    schema: MEMORY_SCHEMA_VERSION,
    updatedAt: isIsoDate(value.updatedAt) ? value.updatedAt : nowIso(now),
    onboardingComplete: value.onboardingComplete === true,
    providers: uniqueProviders,
    memoryEnabled: value.memoryEnabled !== false
  };
}

function sanitizeConversation(value, now) {
  if (!isPlainObject(value) || !Array.isArray(value.messages)) return null;
  const messages = [];
  for (const message of value.messages) {
    if (!isPlainObject(message) || (message.role !== "user" && message.role !== "assistant")) continue;
    const content = boundedString(message.content, MEMORY_LIMITS.messageCharacters);
    if (!content || !content.trim()) continue;
    const safe = {
      role: message.role,
      content,
      createdAt: isIsoDate(message.createdAt) ? message.createdAt : nowIso(now)
    };
    if (message.role === "assistant" && isPlainObject(message.meta) && message.meta.status === "complete") {
      const timing = isPlainObject(message.meta.timing) ? message.meta.timing : {};
      const usage = isPlainObject(message.meta.usage) ? message.meta.usage : {};
      const billing = isPlainObject(message.meta.billing) ? message.meta.billing : {};
      safe.meta = {
        status: "complete",
        timing: {
          totalMs: Number.isFinite(timing.totalMs) && timing.totalMs >= 0 ? timing.totalMs : 0,
          firstTokenMs: Number.isFinite(timing.firstTokenMs) && timing.firstTokenMs >= 0 ? timing.firstTokenMs : null
        },
        usage: {
          promptTokens: Number.isFinite(usage.promptTokens) && usage.promptTokens >= 0 ? usage.promptTokens : 0,
          completionTokens: Number.isFinite(usage.completionTokens) && usage.completionTokens >= 0 ? usage.completionTokens : 0,
          totalTokens: Number.isFinite(usage.totalTokens) && usage.totalTokens >= 0 ? usage.totalTokens : 0,
          requestCount: Number.isFinite(usage.requestCount) && usage.requestCount >= 0 ? usage.requestCount : 0
        },
        billing: {
          basis: billing.basis === "provider_reported" ? "provider_reported" : "unavailable",
          amountUsd: Number.isFinite(billing.amountUsd) && billing.amountUsd >= 0 ? billing.amountUsd : null,
          complete: billing.complete === true,
          requestCount: Number.isFinite(billing.requestCount) && billing.requestCount >= 0 ? billing.requestCount : 0,
          pricedRequestCount: Number.isFinite(billing.pricedRequestCount) && billing.pricedRequestCount >= 0 ? billing.pricedRequestCount : 0
        }
      };
    }
    messages.push(safe);
  }
  const trimmed = messages.slice(-MEMORY_LIMITS.conversationMessages);
  const firstUser = trimmed.find((message) => message.role === "user");
  const createdAt = isIsoDate(value.createdAt) ? value.createdAt : (trimmed[0]?.createdAt || nowIso(now));
  return {
    schema: MEMORY_SCHEMA_VERSION,
    id: collapsedString(value.id, 160) || newConversationId(),
    title: collapsedString(value.title || firstUser?.content, 72),
    createdAt,
    updatedAt: isIsoDate(value.updatedAt) ? value.updatedAt : nowIso(now),
    messages: trimmed
  };
}

function sanitizeQueue(value, now) {
  return sanitizeRecommendationQueue(value, {
    updatedAt: isIsoDate(value?.updatedAt) ? value.updatedAt : nowIso(now)
  });
}

function sanitizeThreads(value, now) {
  if (!isPlainObject(value)) return null;
  const ids = new Set();
  const items = [];
  for (const raw of Array.isArray(value.items) ? value.items : []) {
    const conversation = sanitizeConversation(raw, now);
    const queue = sanitizeQueue(raw?.queue, now);
    if (!conversation || !queue || conversation.messages.length === 0 || ids.has(conversation.id)) continue;
    ids.add(conversation.id);
    items.push({ ...conversation, queue });
    if (items.length === MEMORY_LIMITS.inactiveConversations) break;
  }
  items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return {
    schema: MEMORY_SCHEMA_VERSION,
    updatedAt: isIsoDate(value.updatedAt) ? value.updatedAt : nowIso(now),
    items
  };
}

function sanitizeLearned(value, now) {
  return sanitizeLearnedPreferences(value, { now: nowIso(now) });
}

function sanitizeYouMd(value) {
  return typeof value === "string" ? value.slice(0, MEMORY_LIMITS.youmdCharacters) : null;
}

function sanitizeHistory(value) {
  if (!isPlainObject(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= MEMORY_LIMITS.historyBytes ? JSON.parse(serialized) : null;
  } catch {
    return null;
  }
}

function stampRecord(key, value, now) {
  if (key !== MEMORY_KEYS.profile && key !== MEMORY_KEYS.conversation && key !== MEMORY_KEYS.queue &&
    key !== MEMORY_KEYS.threads && key !== MEMORY_KEYS.learned) {
    return value;
  }
  return { ...value, updatedAt: nowIso(now) };
}

function defaultFor(key, now) {
  if (key === MEMORY_KEYS.profile) return profileDefault();
  if (key === MEMORY_KEYS.conversation) return conversationDefault(now);
  if (key === MEMORY_KEYS.queue) return queueDefault();
  if (key === MEMORY_KEYS.threads) return threadsDefault();
  if (key === MEMORY_KEYS.learned) return learnedDefault();
  if (key === MEMORY_KEYS.youmd) return YOUMD_TEMPLATE;
  if (key === MEMORY_KEYS.history) return null;
  if (key === MEMORY_KEYS.playlists) return defaultPlaylists(now);
  return null;
}

function sanitizeFor(key, value, now) {
  if (key === MEMORY_KEYS.profile) return sanitizeProfile(value, now);
  if (key === MEMORY_KEYS.conversation) return sanitizeConversation(value, now);
  if (key === MEMORY_KEYS.queue) return sanitizeQueue(value, now);
  if (key === MEMORY_KEYS.threads) return sanitizeThreads(value, now);
  if (key === MEMORY_KEYS.learned) return sanitizeLearned(value, now);
  if (key === MEMORY_KEYS.youmd) return sanitizeYouMd(value);
  if (key === MEMORY_KEYS.history) return sanitizeHistory(value);
  if (key === MEMORY_KEYS.playlists) return sanitizePlaylists(value, now);
  return null;
}

function requestResult(request, operation) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(asMemoryError(request.error, operation));
  });
}

function transactionDone(transaction, operation) {
  if (transaction?.completed === true) return Promise.resolve();
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(asMemoryError(transaction.error, operation));
    transaction.onerror = () => reject(asMemoryError(transaction.error, operation));
  });
}

function openDatabase(indexedDB) {
  if (!indexedDB || typeof indexedDB.open !== "function") {
    return Promise.reject(new BrowserMemoryError("unavailable", "IndexedDB is unavailable in this browser."));
  }
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(MEMORY_DB_NAME, MEMORY_DB_VERSION);
    } catch (error) {
      reject(asMemoryError(error, "open"));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEMORY_STORE)) db.createObjectStore(MEMORY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(asMemoryError(request.error, "open"));
    request.onblocked = () => reject(new BrowserMemoryError("blocked", "Browser memory is blocked by another open tab."));
  });
}

/**
 * Local, versioned IndexedDB memory. It never stores LLM configuration or API keys;
 * those remain in the localStorage store for compatibility with existing users.
 */
export function createBrowserMemory({
  indexedDB = globalThis.indexedDB,
  localStorage = globalThis.localStorage,
  now = () => new Date(),
  onIssue = null
} = {}) {
  let databasePromise = null;
  let writeTail = Promise.resolve();
  const issues = [];

  function reportIssue(issue) {
    const entry = { at: nowIso(now), ...issue };
    issues.push(entry);
    if (issues.length > MEMORY_LIMITS.issues) issues.shift();
    if (typeof onIssue === "function") onIssue(clone(entry));
  }

  function database() {
    if (!databasePromise) databasePromise = openDatabase(indexedDB);
    return databasePromise;
  }

  async function readRaw(key) {
    try {
      const db = await database();
      const transaction = db.transaction(MEMORY_STORE, "readonly");
      const result = await requestResult(transaction.objectStore(MEMORY_STORE).get(key), "read");
      await transactionDone(transaction, "read");
      return result;
    } catch (error) {
      throw asMemoryError(error, "read");
    }
  }

  async function readRawMany(keys) {
    try {
      const db = await database();
      const transaction = db.transaction(MEMORY_STORE, "readonly");
      const store = transaction.objectStore(MEMORY_STORE);
      const values = await Promise.all(keys.map((key) => requestResult(store.get(key), "read")));
      await transactionDone(transaction, "read");
      return values;
    } catch (error) {
      throw asMemoryError(error, "read");
    }
  }

  async function writeRaw(entries) {
    try {
      const db = await database();
      const transaction = db.transaction(MEMORY_STORE, "readwrite");
      const store = transaction.objectStore(MEMORY_STORE);
      for (const [key, value] of entries) store.put(clone(value), key);
      await transactionDone(transaction, "write");
    } catch (error) {
      throw asMemoryError(error, "write");
    }
  }

  function serializeWrite(work) {
    const next = writeTail.then(work, work);
    writeTail = next.catch(() => {});
    return next;
  }

  async function get(key) {
    const value = await readRaw(key);
    if (value === undefined) return defaultFor(key, now);
    if (key === MEMORY_KEYS.history && value === null) return null;
    const sanitized = sanitizeFor(key, value, now);
    if (sanitized === null) {
      reportIssue({ code: "corrupt", key, message: `Ignored corrupt ${key} browser-memory data.` });
      return defaultFor(key, now);
    }
    return sanitized;
  }

  async function set(key, value) {
    const sanitized = sanitizeFor(key, value, now);
    const isEmptyHistory = key === MEMORY_KEYS.history && value === null;
    if (sanitized === null && !isEmptyHistory) {
      throw new BrowserMemoryError("invalid", `Invalid ${key} browser-memory data.`);
    }
    const saved = isEmptyHistory ? null : stampRecord(key, sanitized, now);
    await writeRaw([[key, saved]]);
    return clone(saved);
  }

  async function migrateLegacy() {
    const migrated = [];
    const legacyYouMd = safeStorageRead(localStorage, LEGACY_CONTEXT_KEYS.youmd);
    if (legacyYouMd !== null && (await readRaw(MEMORY_KEYS.youmd)) === undefined) {
      const saved = await set(MEMORY_KEYS.youmd, legacyYouMd);
      const verified = await readRaw(MEMORY_KEYS.youmd);
      if (JSON.stringify(verified) === JSON.stringify(saved)) {
        if (!safeStorageRemove(localStorage, LEGACY_CONTEXT_KEYS.youmd)) {
          reportIssue({ code: "legacy_remove", key: LEGACY_CONTEXT_KEYS.youmd, message: "Copied legacy You.md but could not remove it." });
        }
        migrated.push(MEMORY_KEYS.youmd);
      }
    }

    const legacyHistory = safeStorageRead(localStorage, LEGACY_CONTEXT_KEYS.history);
    if (legacyHistory !== null && (await readRaw(MEMORY_KEYS.history)) === undefined) {
      let parsed;
      try {
        parsed = JSON.parse(legacyHistory);
      } catch {
        reportIssue({ code: "corrupt", key: LEGACY_CONTEXT_KEYS.history, message: "Ignored corrupt legacy watch-history data." });
        return migrated;
      }
      const sanitized = sanitizeHistory(parsed);
      if (sanitized === null) {
        reportIssue({ code: "corrupt", key: LEGACY_CONTEXT_KEYS.history, message: "Ignored invalid legacy watch-history data." });
        return migrated;
      }
      const saved = await set(MEMORY_KEYS.history, sanitized);
      const verified = await readRaw(MEMORY_KEYS.history);
      if (JSON.stringify(verified) === JSON.stringify(saved)) {
        if (!safeStorageRemove(localStorage, LEGACY_CONTEXT_KEYS.history)) {
          reportIssue({ code: "legacy_remove", key: LEGACY_CONTEXT_KEYS.history, message: "Copied legacy watch history but could not remove it." });
        }
        migrated.push(MEMORY_KEYS.history);
      }
    }
    return migrated;
  }

  async function initialize() {
    await database();
    const migrated = await migrateLegacy();
    const initialKeys = [MEMORY_KEYS.playlists, MEMORY_KEYS.threads, MEMORY_KEYS.learned];
    const initialValues = await readRawMany(initialKeys);
    const missing = initialKeys
      .filter((_, index) => initialValues[index] === undefined)
      .map((key) => [key, defaultFor(key, now)]);
    if (missing.length > 0) await writeRaw(missing);
    return { migrated, issues: clone(issues) };
  }

  async function getSnapshot() {
    const keys = Object.values(MEMORY_KEYS);
    const values = await readRawMany(keys);
    const snapshot = {};
    for (const [index, key] of keys.entries()) {
      const value = values[index];
      if (value === undefined) snapshot[key] = defaultFor(key, now);
      else if (key === MEMORY_KEYS.history && value === null) snapshot[key] = null;
      else {
        const sanitized = sanitizeFor(key, value, now);
        snapshot[key] = sanitized === null ? defaultFor(key, now) : sanitized;
      }
    }
    return { ...snapshot, issues: clone(issues) };
  }

  async function saveConversationAndQueue(conversation, queue) {
    let safeConversation = sanitizeFor(MEMORY_KEYS.conversation, conversation, now);
    let safeQueue = sanitizeFor(MEMORY_KEYS.queue, queue, now);
    if (safeConversation === null || safeQueue === null) {
      throw new BrowserMemoryError("invalid", "Invalid conversation or recommendation queue data.");
    }
    safeConversation = stampRecord(MEMORY_KEYS.conversation, safeConversation, now);
    safeQueue = stampRecord(MEMORY_KEYS.queue, safeQueue, now);
    await writeRaw([
      [MEMORY_KEYS.conversation, safeConversation],
      [MEMORY_KEYS.queue, safeQueue]
    ]);
    return { conversation: clone(safeConversation), queue: clone(safeQueue) };
  }

  async function currentConversationAndQueue() {
    const [rawConversation, rawQueue] = await readRawMany([MEMORY_KEYS.conversation, MEMORY_KEYS.queue]);
    const safeConversation = rawConversation === undefined
      ? defaultFor(MEMORY_KEYS.conversation, now) : sanitizeConversation(rawConversation, now);
    const safeQueue = rawQueue === undefined ? defaultFor(MEMORY_KEYS.queue, now) : sanitizeQueue(rawQueue, now);
    if (!safeConversation || !safeQueue) throw new BrowserMemoryError("invalid", "Invalid current conversation data.");
    return { conversation: safeConversation, queue: safeQueue };
  }

  async function appendUserMessage(conversationId, content) {
    return serializeWrite(async () => {
      const { conversation, queue } = await currentConversationAndQueue();
      if (conversation.id !== conversationId) throw new BrowserMemoryError("invalid", "That conversation is no longer active.");
      const text = boundedString(content, MEMORY_LIMITS.messageCharacters);
      if (!text || !text.trim()) throw new BrowserMemoryError("invalid", "A conversation message cannot be empty.");
      const timestamp = nowIso(now);
      const messages = conversation.messages.concat({ role: "user", content: text, createdAt: timestamp })
        .slice(-MEMORY_LIMITS.conversationMessages);
      const nextConversation = {
        ...conversation,
        title: conversation.title || collapsedString(text, 72),
        updatedAt: timestamp,
        messages
      };
      await writeRaw([[MEMORY_KEYS.conversation, nextConversation]]);
      return { conversation: clone(nextConversation), queue: clone(queue) };
    });
  }

  async function removeLastPendingUserMessage(conversationId, expected = null) {
    return serializeWrite(async () => {
      const { conversation, queue } = await currentConversationAndQueue();
      if (conversation.id !== conversationId) {
        throw new BrowserMemoryError("invalid", "That conversation is no longer active.");
      }
      const messages = conversation.messages.slice();
      const last = messages[messages.length - 1];
      if (!last || last.role !== "user") {
        return { conversation: clone(conversation), queue: clone(queue) };
      }
      if (expected && (last.content !== expected.content || last.createdAt !== expected.createdAt)) {
        return { conversation: clone(conversation), queue: clone(queue) };
      }
      messages.pop();
      const firstUser = messages.find((message) => message.role === "user");
      const nextConversation = sanitizeConversation({
        ...conversation,
        title: firstUser ? collapsedString(firstUser.content, 72) : "",
        updatedAt: nowIso(now),
        messages
      }, now);
      if (!nextConversation) throw new BrowserMemoryError("invalid", "Invalid conversation data.");
      await writeRaw([[MEMORY_KEYS.conversation, nextConversation]]);
      return { conversation: clone(nextConversation), queue: clone(queue) };
    });
  }

  async function completeTurn(conversationId, { content, queue = null, meta = undefined, learned = undefined } = {}) {
    return serializeWrite(async () => {
      const current = await currentConversationAndQueue();
      if (current.conversation.id !== conversationId) {
        throw new BrowserMemoryError("invalid", "That conversation is no longer active.");
      }
      const text = boundedString(content, MEMORY_LIMITS.messageCharacters);
      if (!text || !text.trim()) throw new BrowserMemoryError("invalid", "A completed turn needs a reply.");
      const timestamp = nowIso(now);
      const assistant = { role: "assistant", content: text, createdAt: timestamp };
      if (meta !== undefined) assistant.meta = meta;
      const nextConversation = sanitizeConversation({
        ...current.conversation,
        updatedAt: timestamp,
        messages: current.conversation.messages.concat(assistant)
      }, now);
      const nextQueue = queue === null ? current.queue : sanitizeQueue(queue, now);
      if (!nextConversation || !nextQueue) throw new BrowserMemoryError("invalid", "Invalid completed turn data.");
      const nextLearned = learned === undefined ? undefined : sanitizeLearned(learned, now);
      if (learned !== undefined && nextLearned === null) {
        throw new BrowserMemoryError("invalid", "Invalid learned-preferences browser-memory data.");
      }
      const entries = [
        [MEMORY_KEYS.conversation, nextConversation],
        [MEMORY_KEYS.queue, { ...nextQueue, updatedAt: timestamp }]
      ];
      if (nextLearned !== undefined) {
        entries.push([MEMORY_KEYS.learned, stampRecord(MEMORY_KEYS.learned, nextLearned, now)]);
      }
      await writeRaw(entries);
      return {
        conversation: clone(nextConversation),
        queue: clone({ ...nextQueue, updatedAt: timestamp }),
        ...(nextLearned === undefined ? {} : { learned: clone(nextLearned) })
      };
    });
  }

  function archiveConversation(threads, conversation, queue, timestamp) {
    if (conversation.messages.length === 0) return threads;
    const withoutCurrent = threads.items.filter((item) => item.id !== conversation.id);
    const archived = { ...conversation, updatedAt: timestamp, queue };
    return {
      schema: MEMORY_SCHEMA_VERSION,
      updatedAt: timestamp,
      items: [archived, ...withoutCurrent]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, MEMORY_LIMITS.inactiveConversations)
    };
  }

  async function startNewConversation() {
    return serializeWrite(async () => {
      const [current, rawThreads] = await Promise.all([
        currentConversationAndQueue(),
        get(MEMORY_KEYS.threads)
      ]);
      const timestamp = nowIso(now);
      const threads = archiveConversation(rawThreads, current.conversation, current.queue, timestamp);
      const conversation = conversationDefault(now);
      const queue = queueDefault();
      await writeRaw([
        [MEMORY_KEYS.conversation, conversation],
        [MEMORY_KEYS.queue, queue],
        [MEMORY_KEYS.threads, threads]
      ]);
      return { conversation: clone(conversation), queue: clone(queue), threads: clone(threads) };
    });
  }

  async function activateArchivedConversation(conversationId) {
    return serializeWrite(async () => {
      const [current, threads] = await Promise.all([
        currentConversationAndQueue(),
        get(MEMORY_KEYS.threads)
      ]);
      const target = threads.items.find((item) => item.id === conversationId);
      if (!target) throw new BrowserMemoryError("invalid", "That archived conversation is unavailable.");
      const timestamp = nowIso(now);
      const nextThreads = archiveConversation(
        { ...threads, items: threads.items.filter((item) => item.id !== conversationId) },
        current.conversation,
        current.queue,
        timestamp
      );
      const conversation = { ...target, updatedAt: timestamp };
      delete conversation.queue;
      const queue = target.queue;
      await writeRaw([
        [MEMORY_KEYS.conversation, conversation],
        [MEMORY_KEYS.queue, queue],
        [MEMORY_KEYS.threads, nextThreads]
      ]);
      return { conversation: clone(conversation), queue: clone(queue), threads: clone(nextThreads) };
    });
  }

  async function getConversationList() {
    const [current, threads] = await Promise.all([get(MEMORY_KEYS.conversation), get(MEMORY_KEYS.threads)]);
    return {
      active: clone(current),
      items: [clone(current), ...threads.items.filter((item) => item.id !== current.id).map((item) => clone(item))]
    };
  }

  async function saveContextMemory({ youmd, history, profile, learned } = {}) {
    return serializeWrite(async () => {
      const entries = [];
      if (youmd !== undefined) {
        const safe = sanitizeYouMd(youmd);
        if (safe === null) throw new BrowserMemoryError("invalid", "Invalid You.md browser-memory data.");
        entries.push([MEMORY_KEYS.youmd, safe]);
      }
      if (history !== undefined) {
        const safe = sanitizeHistory(history);
        if (safe === null && history !== null) throw new BrowserMemoryError("invalid", "Invalid watch-history browser-memory data.");
        entries.push([MEMORY_KEYS.history, safe]);
      }
      if (profile !== undefined) {
        const safe = sanitizeProfile(profile, now);
        if (safe === null) throw new BrowserMemoryError("invalid", "Invalid profile browser-memory data.");
        entries.push([MEMORY_KEYS.profile, stampRecord(MEMORY_KEYS.profile, safe, now)]);
      }
      if (learned !== undefined) {
        const safe = sanitizeLearned(learned, now);
        if (safe === null) throw new BrowserMemoryError("invalid", "Invalid learned-preferences browser-memory data.");
        entries.push([MEMORY_KEYS.learned, stampRecord(MEMORY_KEYS.learned, safe, now)]);
      }
      if (entries.length) await writeRaw(entries);
      return {
        youmd: youmd === undefined ? await get(MEMORY_KEYS.youmd) : clone(entries.find(([key]) => key === MEMORY_KEYS.youmd)?.[1]),
        history: history === undefined ? await get(MEMORY_KEYS.history) : clone(entries.find(([key]) => key === MEMORY_KEYS.history)?.[1]),
        profile: profile === undefined ? await get(MEMORY_KEYS.profile) : clone(entries.find(([key]) => key === MEMORY_KEYS.profile)?.[1]),
        learned: learned === undefined ? await get(MEMORY_KEYS.learned) : clone(entries.find(([key]) => key === MEMORY_KEYS.learned)?.[1])
      };
    });
  }

  async function exportBackup() {
    const { issues, ...backup } = await getSnapshot();
    return {
      schema: MEMORY_SCHEMA_VERSION,
      exportedAt: nowIso(now),
      ...backup
    };
  }

  async function clear() {
    try {
      const db = await database();
      const transaction = db.transaction(MEMORY_STORE, "readwrite");
      transaction.objectStore(MEMORY_STORE).clear();
      await transactionDone(transaction, "clear");
    } catch (error) {
      throw asMemoryError(error, "clear");
    }
  }

  return {
    initialize,
    getProfile: () => get(MEMORY_KEYS.profile),
    setProfile: (profile) => set(MEMORY_KEYS.profile, profile),
    getConversation: () => get(MEMORY_KEYS.conversation),
    setConversation: (conversation) => set(MEMORY_KEYS.conversation, conversation),
    getQueue: () => get(MEMORY_KEYS.queue),
    setQueue: (queue) => set(MEMORY_KEYS.queue, queue),
    getThreads: () => get(MEMORY_KEYS.threads),
    getLearned: () => get(MEMORY_KEYS.learned),
    setLearned: (learned) => set(MEMORY_KEYS.learned, learned),
    getYouMd: () => get(MEMORY_KEYS.youmd),
    setYouMd: (youmd) => set(MEMORY_KEYS.youmd, youmd),
    getHistory: () => get(MEMORY_KEYS.history),
    setHistory: (history) => set(MEMORY_KEYS.history, history),
    getPlaylists: () => get(MEMORY_KEYS.playlists),
    setPlaylists: (playlists) => set(MEMORY_KEYS.playlists, playlists),
    saveConversationAndQueue,
    appendUserMessage,
    removeLastPendingUserMessage,
    completeTurn,
    startNewConversation,
    activateArchivedConversation,
    getConversationList,
    saveContextMemory,
    getSnapshot,
    exportBackup,
    clear,
    getIssues: () => clone(issues)
  };
}
