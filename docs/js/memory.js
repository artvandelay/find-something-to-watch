import { LEGACY_CONTEXT_KEYS, YOUMD_TEMPLATE } from "./store.js";
import { PROVIDER_SLUGS } from "./providers.js";

export const MEMORY_DB_NAME = "ottbyok.memory";
export const MEMORY_DB_VERSION = 1;
export const MEMORY_SCHEMA_VERSION = 1;
export const MEMORY_STORE = "memory";

export const MEMORY_KEYS = Object.freeze({
  profile: "profile",
  conversation: "conversation",
  queue: "queue",
  youmd: "youmd",
  history: "history"
});

export const MEMORY_LIMITS = Object.freeze({
  profileProviders: 26,
  conversationMessages: 24,
  messageCharacters: 6000,
  queueItems: 20,
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
    providers: []
  };
}

function conversationDefault() {
  return {
    schema: MEMORY_SCHEMA_VERSION,
    updatedAt: null,
    messages: []
  };
}

function queueDefault() {
  return {
    schema: MEMORY_SCHEMA_VERSION,
    updatedAt: null,
    ids: []
  };
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
    providers: uniqueProviders
  };
}

function sanitizeConversation(value, now) {
  if (!isPlainObject(value) || !Array.isArray(value.messages)) return null;
  const messages = [];
  for (const message of value.messages) {
    if (!isPlainObject(message) || (message.role !== "user" && message.role !== "assistant")) continue;
    const content = boundedString(message.content, MEMORY_LIMITS.messageCharacters);
    if (!content || !content.trim()) continue;
    messages.push({
      role: message.role,
      content,
      createdAt: isIsoDate(message.createdAt) ? message.createdAt : nowIso(now)
    });
  }
  return {
    schema: MEMORY_SCHEMA_VERSION,
    updatedAt: isIsoDate(value.updatedAt) ? value.updatedAt : nowIso(now),
    messages: messages.slice(-MEMORY_LIMITS.conversationMessages)
  };
}

function sanitizeQueue(value, now) {
  if (!isPlainObject(value) || !Array.isArray(value.ids)) return null;
  const ids = [];
  for (const id of value.ids) {
    const cleanId = typeof id === "string" ? id.trim() : "";
    if (cleanId && !ids.includes(cleanId)) ids.push(cleanId);
    if (ids.length === MEMORY_LIMITS.queueItems) break;
  }
  return {
    schema: MEMORY_SCHEMA_VERSION,
    updatedAt: isIsoDate(value.updatedAt) ? value.updatedAt : nowIso(now),
    ids
  };
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
  if (key !== MEMORY_KEYS.profile && key !== MEMORY_KEYS.conversation && key !== MEMORY_KEYS.queue) {
    return value;
  }
  return { ...value, updatedAt: nowIso(now) };
}

function defaultFor(key) {
  if (key === MEMORY_KEYS.profile) return profileDefault();
  if (key === MEMORY_KEYS.conversation) return conversationDefault();
  if (key === MEMORY_KEYS.queue) return queueDefault();
  if (key === MEMORY_KEYS.youmd) return YOUMD_TEMPLATE;
  if (key === MEMORY_KEYS.history) return null;
  return null;
}

function sanitizeFor(key, value, now) {
  if (key === MEMORY_KEYS.profile) return sanitizeProfile(value, now);
  if (key === MEMORY_KEYS.conversation) return sanitizeConversation(value, now);
  if (key === MEMORY_KEYS.queue) return sanitizeQueue(value, now);
  if (key === MEMORY_KEYS.youmd) return sanitizeYouMd(value);
  if (key === MEMORY_KEYS.history) return sanitizeHistory(value);
  return null;
}

function requestResult(request, operation) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(asMemoryError(request.error, operation));
  });
}

function transactionDone(transaction, operation) {
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

  async function get(key) {
    const value = await readRaw(key);
    if (value === undefined) return defaultFor(key);
    if (key === MEMORY_KEYS.history && value === null) return null;
    const sanitized = sanitizeFor(key, value, now);
    if (sanitized === null) {
      reportIssue({ code: "corrupt", key, message: `Ignored corrupt ${key} browser-memory data.` });
      return defaultFor(key);
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
    return { migrated, issues: clone(issues) };
  }

  async function getSnapshot() {
    const [profile, conversation, queue, youmd, history] = await Promise.all([
      get(MEMORY_KEYS.profile),
      get(MEMORY_KEYS.conversation),
      get(MEMORY_KEYS.queue),
      get(MEMORY_KEYS.youmd),
      get(MEMORY_KEYS.history)
    ]);
    return { profile, conversation, queue, youmd, history, issues: clone(issues) };
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

  async function exportBackup() {
    const { issues: snapshotIssues, ...backup } = await getSnapshot();
    return {
      schema: MEMORY_SCHEMA_VERSION,
      exportedAt: nowIso(now),
      ...backup,
      issues: snapshotIssues
    };
  }

  async function importBackup(backup) {
    if (!isPlainObject(backup) || backup.schema !== MEMORY_SCHEMA_VERSION) {
      throw new BrowserMemoryError("invalid", "Unsupported browser-memory backup.");
    }
    const entries = Object.values(MEMORY_KEYS).map((key) => {
      const sanitized = sanitizeFor(key, backup[key], now);
      const isEmptyHistory = key === MEMORY_KEYS.history && backup[key] === null;
      if (sanitized === null && !isEmptyHistory) {
        throw new BrowserMemoryError("invalid", `Invalid ${key} in browser-memory backup.`);
      }
      return [key, isEmptyHistory ? null : sanitized];
    });
    await writeRaw(entries);
    return getSnapshot();
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
    getYouMd: () => get(MEMORY_KEYS.youmd),
    setYouMd: (youmd) => set(MEMORY_KEYS.youmd, youmd),
    getHistory: () => get(MEMORY_KEYS.history),
    setHistory: (history) => set(MEMORY_KEYS.history, history),
    saveConversationAndQueue,
    getSnapshot,
    exportBackup,
    importBackup,
    clear,
    getIssues: () => clone(issues)
  };
}
