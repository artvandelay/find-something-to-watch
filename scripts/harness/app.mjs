import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, "..", "..", "docs");

/**
 * Boot the real application against the real index.html.
 *
 * The catalog is replaced with a small deterministic fixture so a run stays
 * fast and never depends on the shipped 31k-title snapshot, and storage is
 * recreated per boot so every test starts from a genuine first visit.
 */
/**
 * Storage that outlives a single boot, so a test can simulate a reload or a
 * returning visitor instead of always starting from a blank browser.
 */
export function createStorage() {
  return { indexedDB: new IDBFactory(), local: new Map() };
}

export async function bootApp({
  records,
  url = "http://localhost/",
  now,
  mobile = false,
  storage = null,
  quiet = true
} = {}) {
  const html = await readFile(join(docsDir, "index.html"), "utf8");
  const prompts = JSON.parse(await readFile(join(docsDir, "assets", "prompts.json"), "utf8"));

  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;

  // jsdom has no IndexedDB and no dialog implementation; both are load-bearing here.
  window.indexedDB = storage ? storage.indexedDB : new IDBFactory();
  window.IDBKeyRange = IDBKeyRange;
  if (storage) restoreLocalStorage(window, storage.local);
  installDialogShim(window);
  const media = installMatchMediaShim(window, mobile);
  const downloads = installDownloadCapture(window);

  const catalog = {
    schema: 1,
    meta: {
      region: "IN",
      built_at: "2026-08-04",
      count: (records || defaultRecords()).length,
      provider_order: ["netflix", "prime", "hotstar"],
      providers: { netflix: 2, prime: 2, hotstar: 1 }
    },
    records: records || defaultRecords()
  };

  const requested = [];
  window.fetch = async (input) => {
    const href = String(input);
    requested.push(href);
    if (href.includes("prompts.json")) return jsonResponse(prompts);
    if (href.includes("catalog.json")) return jsonResponse(catalog);
    // The synopsis sidecar is optional by design; prove the app tolerates its absence.
    return { ok: false, status: 404, async json() { throw new Error("404"); }, async text() { return "not found"; } };
  };

  function jsonResponse(value) {
    const body = JSON.stringify(value);
    return { ok: true, status: 200, async json() { return JSON.parse(body); }, async text() { return body; } };
  }

  const globals = swapGlobals(window);
  if (now) window.Date.now = () => now;

  // The missing synopsis sidecar is expected here and warns on every boot.
  const warn = console.warn;
  if (quiet) console.warn = () => {};

  try {
    // Importing ui.js runs init(); it reads `document` from the global scope.
    const uiUrl = new URL("../../docs/js/ui.js", import.meta.url).href + "?boot=" + Math.random();
    await import(uiUrl);
    await settle(window);
  } finally {
    console.warn = warn;
  }

  return {
    window,
    document: window.document,
    requested,
    downloads,
    catalog,
    setMobile: async (value) => { media.set(value); await settle(window); },
    settle: () => settle(window),
    $: (selector) => window.document.querySelector(selector),
    $$: (selector) => [...window.document.querySelectorAll(selector)],
    text: (selector) => window.document.querySelector(selector)?.textContent?.trim() ?? null,
    visibleSteps: () => [...window.document.querySelectorAll("[data-onboarding-step]")]
      .filter((node) => !node.hidden)
      .map((node) => node.dataset.onboardingStep),
    click: async (selector) => {
      const node = window.document.querySelector(selector);
      if (!node) throw new Error("No element for selector " + selector);
      node.click();
      await settle(window);
    },
    setFile: async (selector, { name, content, type = "application/octet-stream" }) => {
      const input = window.document.querySelector(selector);
      if (!input) throw new Error("No file input for selector " + selector);
      const file = new window.File([content], name, { type });
      Object.defineProperty(input, "files", {
        value: [file],
        configurable: true
      });
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
      await settle(window, 24);
    },
    readDownload: async (index = -1) => {
      const download = downloads.at(index);
      if (!download) return null;
      return {
        filename: download.filename,
        mime: download.blob.type,
        text: await readBlob(window, download.blob)
      };
    },
    restore: () => {
      if (storage) saveLocalStorage(window, storage.local);
      restoreGlobals(globals);
      window.close();
    }
  };
}

/** Let queued microtasks, promise chains and IndexedDB callbacks drain. */
async function settle(window, rounds = 12) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

/**
 * jsdom does not implement <dialog>. Track open state and fire the events the
 * views rely on, so dialog-driven flows are testable without a real browser.
 */
function installDialogShim(window) {
  const proto = window.HTMLDialogElement?.prototype;
  if (!proto) return;
  const setOpen = (dialog, open) => {
    if (open) dialog.setAttribute("open", "");
    else dialog.removeAttribute("open");
  };
  proto.showModal = function showModal() { setOpen(this, true); };
  proto.show = function show() { setOpen(this, true); };
  proto.close = function close(value) {
    if (!this.hasAttribute("open")) return;
    setOpen(this, false);
    if (value !== undefined) this.returnValue = String(value);
    this.dispatchEvent(new window.Event("close"));
  };
}

/**
 * Capture downloads in memory. This makes export flows assertable without
 * writing files or relying on jsdom's unimplemented navigation behaviour.
 */
function installDownloadCapture(window) {
  const downloads = [];
  const blobs = new Map();
  let nextId = 0;
  window.URL.createObjectURL = (blob) => {
    const url = "blob:harness/" + (++nextId);
    blobs.set(url, blob);
    return url;
  };
  window.URL.revokeObjectURL = (url) => blobs.delete(String(url));

  const click = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function capturedClick() {
    if (this.download && blobs.has(this.href)) {
      downloads.push({
        filename: this.download,
        blob: blobs.get(this.href)
      });
      return;
    }
    return click.call(this);
  };
  return downloads;
}

function readBlob(window, blob) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function restoreLocalStorage(window, entries) {
  for (const [key, value] of entries) window.localStorage.setItem(key, value);
}

function saveLocalStorage(window, entries) {
  entries.clear();
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    entries.set(key, window.localStorage.getItem(key));
  }
}

/**
 * jsdom has no matchMedia. Back it with a flag the tests can flip so the
 * mobile drawer behaviour is reachable without resizing a real browser.
 */
function installMatchMediaShim(window, mobile) {
  let matches = Boolean(mobile);
  const lists = new Set();
  window.matchMedia = (query) => {
    const listeners = new Set();
    const list = {
      media: String(query),
      get matches() { return matches; },
      addEventListener: (_type, fn) => listeners.add(fn),
      removeEventListener: (_type, fn) => listeners.delete(fn),
      addListener: (fn) => listeners.add(fn),
      removeListener: (fn) => listeners.delete(fn),
      dispatch() {
        for (const fn of listeners) fn({ matches, media: list.media });
      }
    };
    lists.add(list);
    return list;
  };
  return {
    set(value) {
      matches = Boolean(value);
      for (const list of lists) list.dispatch();
    }
  };
}

const GLOBAL_KEYS = [
  "window", "document", "navigator", "location", "fetch", "Event", "CustomEvent",
  "KeyboardEvent", "MouseEvent", "Blob", "URL", "HTMLElement", "Node", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame", "localStorage", "indexedDB", "IDBKeyRange",
  "requestIdleCallback", "Response", "Headers", "AbortController", "FileReader", "File", "Worker"
];

function swapGlobals(window) {
  const saved = new Map();
  for (const key of GLOBAL_KEYS) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "requestIdleCallback"
      ? (cb) => window.setTimeout(() => cb({ timeRemaining: () => 8, didTimeout: false }), 0)
      : window[key];
    if (value === undefined) continue;
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  return saved;
}

function restoreGlobals(saved) {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

export function defaultRecords() {
  return [
    rec("tmdb:m1", "Sharp Comedy", 2021, "movie", ["netflix"], 8.1, "A tight, funny heist caper."),
    rec("tmdb:m2", "Prime Thriller", 2019, "movie", ["prime"], 7.7, "A slow-burn thriller."),
    rec("tmdb:t3", "Netflix Series", 2020, "series", ["netflix"], 8.6, "An ensemble drama."),
    rec("tmdb:m4", "Hotstar Only", 2018, "movie", ["hotstar"], 7.2, "Only on Hotstar."),
    rec("tmdb:m5", "Dual Listed", 2022, "movie", ["netflix", "prime"], 8.0, "Available in two places.")
  ];
}

function rec(id, t, y, k, p, r, s) {
  const u = {};
  for (const slug of p) u[slug] = "https://example.test/" + slug + "/" + id;
  return { id, t, y, k, rt: 100, s, im: null, r, p, u, img: null, l: "en", g: ["Comedy"], v: 4 };
}
