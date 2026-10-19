import { extractHistoryArchive } from "./archive.js";
import { generateHistoryExtractorSource } from "./history-codegen.js";
import { HistoryExtractError, readCsv, readHtml } from "./history-extract.js";
import { createHistoryRuntime } from "./history-runtime.js";

const SEASON_RE =
  /^(.+?): (?:Season \d+|Part \d+|Limited Series|Chapter \d+|Book \d+|Volume \d+|Series \d+|Collection \d+): (.+)$/;
const TEXT_ENCODER = new TextEncoder();

export const HISTORY_IMPORT_LIMITS = Object.freeze({
  uploadBytes: 10 * 1024 * 1024,
  extractedTextBytes: 25 * 1024 * 1024,
  archiveEntries: 100,
  candidateFileBytes: 5 * 1024 * 1024,
  records: 50000,
  fields: 64,
  fieldCharacters: 2000,
  inferenceInputCharacters: 12000,
  inferenceOutputCharacters: 4000,
  normalizedHistoryBytes: 1024 * 1024
});

export class HistoryImportError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "HistoryImportError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function fail(code, message, cause = null) {
  return new HistoryImportError(code, message, cause);
}

function checkAbort(signal) {
  if (signal?.aborted) {
    const error = new Error("The history import was cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

function normalizeTitle(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function extension(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function validName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 255 &&
    !name.includes("\0") && !name.startsWith("/") && !name.includes("\\") &&
    !name.split("/").some((part) => !part || part === "." || part === "..");
}

function textFromBytes(value, name) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(value);
    if (text.includes("\0") || /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
      throw fail("input", `"${name}" is binary, not a text export.`);
    }
    return text;
  } catch (cause) {
    if (cause instanceof HistoryImportError) throw cause;
    throw fail("input", `"${name}" is not valid UTF-8 text.`, cause);
  }
}

function asBytes(value) {
  if (!value || typeof value === "string") return null;
  try {
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
      return new Uint8Array(value);
    }
  } catch {
    return null;
  }
  return null;
}

function parseCsv(text, limits) {
  try {
    return readCsv(text, limits);
  } catch (cause) {
    if (cause instanceof HistoryExtractError) throw fail(cause.code, cause.message, cause);
    throw cause;
  }
}

function validateJsonValue(value, limits, depth = 0) {
  if (depth > 32) throw fail("input", "JSON history is nested too deeply.");
  if (typeof value === "string") {
    if (value.length > limits.fieldCharacters) {
      throw fail("limit", `JSON strings may contain at most ${limits.fieldCharacters} characters.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > limits.records) throw fail("limit", "JSON contains too many records.");
    for (const item of value) validateJsonValue(item, limits, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length > limits.fields) throw fail("limit", "JSON objects contain too many fields.");
    for (const key of keys) {
      if (key.length > limits.fieldCharacters) throw fail("limit", "A JSON field name is too long.");
      validateJsonValue(value[key], limits, depth + 1);
    }
  }
}

function sampleIndices(length, maximum = 8) {
  if (!length) return [];
  if (length <= maximum) return Array.from({ length }, (_, index) => index);
  const result = [];
  for (let index = 0; index < maximum; index += 1) {
    result.push(Math.round(index * (length - 1) / (maximum - 1)));
  }
  return result;
}

function boundSample(value, limits, depth = 0) {
  if (typeof value === "string") return value.slice(0, limits.fieldCharacters);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 3) return Array.isArray(value) ? [] : {};
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => boundSample(item, limits, depth + 1));
  }
  const result = {};
  for (const key of Object.keys(value).sort().slice(0, limits.fields)) {
    result[key.slice(0, limits.fieldCharacters)] = boundSample(value[key], limits, depth + 1);
  }
  return result;
}

function jsonPaths(value, path = [], result = []) {
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === "object" && !Array.isArray(item))) {
      result.push(path);
    }
    return result;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value).sort()) jsonPaths(value[key], [...path, key], result);
  }
  return result;
}

function observedPaths(records, limits) {
  const paths = new Set();
  function visit(value, prefix, depth) {
    if (depth > 3 || !value || typeof value !== "object" || Array.isArray(value)) return;
    for (const key of Object.keys(value).sort().slice(0, limits.fields)) {
      const next = [...prefix, key];
      paths.add(next.join("."));
      visit(value[key], next, depth + 1);
    }
  }
  for (const record of records.slice(0, 8)) visit(record, [], 0);
  return Array.from(paths).sort().map((path) => path.split("."));
}

function inspectHtml(name, text, limits) {
  const blocks = readHtml(text, limits);
  const classes = [];
  const seen = new Set();
  for (const block of blocks) {
    for (const className of block.classes) {
      if (seen.has(className)) continue;
      seen.add(className);
      classes.push(className);
      if (classes.length >= limits.fields) break;
    }
  }
  return {
    name,
    format: "html",
    text,
    structure: { characters: text.length, classes },
    sample: blocks.slice(0, 8).map((block) => ({
      classes: block.classes.slice(0, 8),
      text: block.text.slice(0, 500),
      links: block.links.slice(0, 4).map((link) => ({
        href: link.href.slice(0, 500),
        text: link.text.slice(0, 500)
      }))
    }))
  };
}

function inspectCsv(name, text, limits) {
  const rows = parseCsv(text, limits);
  const maxColumns = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  return {
    name,
    format: "csv",
    text,
    rows,
    structure: {
      rows: rows.length,
      columns: maxColumns,
      headers: (rows[0] || []).slice()
    },
    sample: sampleIndices(Math.max(0, rows.length - 1)).map((index) => rows[index + 1].slice())
  };
}

function inspectJson(name, text, limits) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw fail("input", `"${name}" is not valid JSON.`, cause);
  }
  validateJsonValue(value, limits);
  const recordsPaths = jsonPaths(value);
  const recordSets = new Map(recordsPaths.map((path) => {
    let records = value;
    for (const segment of path) records = records[segment];
    return [JSON.stringify(path), records];
  }));
  const firstRecords = recordSets.get(JSON.stringify(recordsPaths[0] || [])) || [];
  return {
    name,
    format: "json",
    text,
    value,
    recordsPaths,
    recordSets,
    structure: {
      recordsPathCandidates: recordsPaths,
      observedKeyPaths: observedPaths(firstRecords, limits)
    },
    sample: sampleIndices(firstRecords.length).map((index) => boundSample(firstRecords[index], limits))
  };
}

function normalizeFileInput(input, limits, signal) {
  function extractArchive(bytes) {
    try {
      return extractHistoryArchive(bytes, { limits, signal });
    } catch (cause) {
      if (cause?.name === "AbortError") throw cause;
      throw fail("archive", cause?.message || "The ZIP archive could not be read.", cause);
    }
  }

  const values = Array.isArray(input) ? input : [input];
  const files = [];
  for (const value of values) {
    checkAbort(signal);
    if (typeof value === "string") {
      files.push({ name: "watch-history.csv", text: value });
      continue;
    }
    const bytes = asBytes(value);
    if (bytes) {
      if (bytes.byteLength > limits.uploadBytes) throw fail("limit", "The upload exceeds the 10 MiB limit.");
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        files.push(...extractArchive(bytes));
        continue;
      }
      const first = textFromBytes(bytes, "watch-history");
      const trimmed = first.trimStart();
      const name = trimmed.startsWith("{") || trimmed.startsWith("[")
        ? "watch-history.json"
        : trimmed.startsWith("<") ? "watch-history.html" : "watch-history.csv";
      files.push({ name, text: first });
      continue;
    }
    if (!value || typeof value !== "object" || !validName(value.name)) {
      throw fail("input", "Each history file needs a safe filename.");
    }
    const suppliedBytes = asBytes(value.bytes || value.data);
    if (suppliedBytes) {
      if (suppliedBytes.byteLength > limits.uploadBytes) throw fail("limit", "The upload exceeds the 10 MiB limit.");
      if (extension(value.name) === "zip") {
        files.push(...extractArchive(suppliedBytes));
      } else {
        files.push({ name: value.name, text: textFromBytes(suppliedBytes, value.name) });
      }
    } else if (typeof value.text === "string") {
      files.push({ name: value.name, text: value.text });
    } else {
      throw fail("input", `"${value.name}" has no readable content.`);
    }
  }
  return files;
}

export function inspectWatchHistoryFiles(input, { limits = HISTORY_IMPORT_LIMITS, signal = null } = {}) {
  const rawFiles = normalizeFileInput(input, limits, signal);
  if (!rawFiles.length) throw fail("input", "Select a CSV, JSON, or ZIP watch-history export.");
  if (rawFiles.length > limits.archiveEntries) throw fail("limit", "The upload contains too many files.");
  const names = new Set();
  let textBytes = 0;
  const inspected = rawFiles.map(({ name, text }) => {
    checkAbort(signal);
    const ext = extension(name);
    if (!validName(name) || (ext !== "csv" && ext !== "json" && ext !== "html" && ext !== "htm")) {
      throw fail("input", "History imports accept only CSV, JSON, HTML, or ZIP files.");
    }
    const bytes = TEXT_ENCODER.encode(text);
    if (bytes.byteLength > limits.candidateFileBytes) {
      throw fail("limit", `"${name}" exceeds the 5 MiB candidate-file limit.`);
    }
    if (names.has(name)) throw fail("input", "History imports cannot contain duplicate filenames.");
    names.add(name);
    textBytes += bytes.byteLength;
    if (textBytes > limits.extractedTextBytes) {
      throw fail("limit", "The upload exceeds the total extracted-text limit.");
    }
    if (ext === "html" || ext === "htm") return inspectHtml(name, text, limits);
    return ext === "csv" ? inspectCsv(name, text, limits) : inspectJson(name, text, limits);
  });
  return inspected;
}

function inferenceFile(file) {
  return {
    name: file.name,
    format: file.format,
    structure: file.structure,
    sample: file.sample
  };
}

export function buildHistoryInferenceInput(files, { limits = HISTORY_IMPORT_LIMITS } = {}) {
  const input = { schema: 1, files: files.map(inferenceFile) };
  function serialized() {
    return JSON.stringify(input);
  }
  while (serialized().length > limits.inferenceInputCharacters) {
    let changed = false;
    for (let index = input.files.length - 1; index >= 0; index -= 1) {
      if (input.files[index].sample.length) {
        input.files[index].sample.pop();
        changed = true;
        if (serialized().length <= limits.inferenceInputCharacters) break;
      }
    }
    if (!changed) throw fail("limit", "History metadata exceeds the inference-input limit.");
  }
  return input;
}

function ownKeysOnly(value, keys, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set(keys.concat(optional));
  const present = Object.keys(value);
  return present.every((key) => allowed.has(key)) && keys.every((key) => key in value);
}

function validPath(path, optional = false) {
  if (path === null && optional) return true;
  return Array.isArray(path) && path.every((segment) =>
    typeof segment === "string" && segment.length > 0 && segment.length <= 2000 &&
    !segment.includes("\0") && segment !== "__proto__" && segment !== "constructor" && segment !== "prototype"
  );
}

function readPath(value, path) {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function validTypeMap(value, limits) {
  if (!ownKeysOnly(value, ["movie", "series"])) return false;
  return ["movie", "series"].every((kind) => Array.isArray(value[kind]) &&
    value[kind].length <= limits.fields &&
    value[kind].every((item) => typeof item === "string" && item.length > 0 && item.length <= limits.fieldCharacters)
  );
}

function findFile(files, name) {
  return files.find((file) => file.name === name) || null;
}

const DATE_FORMATS = new Set(["ymd", "dmy", "mdy", "iso", "none"]);
const CSV_KEYS = [
  "name", "format", "headerRow", "dataStartRow", "titleColumn", "dateColumn",
  "typeColumn", "seriesColumn", "episodeColumn", "dateFormat", "typeMap"
];
const JSON_KEYS = [
  "name", "format", "recordsPath", "titlePath", "datePath", "typePath",
  "seriesPath", "episodePath", "dateFormat", "typeMap"
];
const HTML_KEYS = [
  "name", "format", "itemClass", "titleLink", "requireHref", "skipIncludes", "dateFormat", "typeMap"
];

export function validateHistoryPlan(value, files, { limits = HISTORY_IMPORT_LIMITS } = {}) {
  if (!value || value.schema !== 1 || !Array.isArray(value.files) || value.files.length === 0 ||
    value.files.length > files.length || Object.keys(value).some((key) => key !== "schema" && key !== "files")) {
    throw fail("plan", "The history import plan has an invalid top-level shape.");
  }
  const names = new Set();
  const plan = { schema: 1, files: [] };
  for (const item of value.files) {
    if (!item || typeof item.name !== "string" || !validName(item.name) || names.has(item.name)) {
      throw fail("plan", "The history import plan has invalid file names.");
    }
    names.add(item.name);
    const file = findFile(files, item.name);
    if (!file || item.format !== file.format) throw fail("plan", "The history import plan references an unknown file.");
    if (!DATE_FORMATS.has(item.dateFormat) || !validTypeMap(item.typeMap, limits)) {
      throw fail("plan", "The history import plan has invalid date or type mappings.");
    }
    if (file.format === "csv") {
      if (!ownKeysOnly(item, CSV_KEYS, ["titlePrefix"])) throw fail("plan", "The CSV plan contains unsupported fields.");
      for (const key of ["headerRow", "dataStartRow", "titleColumn"]) {
        if (!Number.isInteger(item[key]) || item[key] < 0) throw fail("plan", "The CSV plan contains invalid indices.");
      }
      for (const key of ["dateColumn", "typeColumn", "seriesColumn", "episodeColumn"]) {
        if (item[key] !== null && (!Number.isInteger(item[key]) || item[key] < 0)) {
          throw fail("plan", "The CSV plan contains invalid optional indices.");
        }
      }
      const maximumColumn = file.structure.columns - 1;
      if (item.headerRow >= file.rows.length || item.dataStartRow > file.rows.length ||
        [item.titleColumn, item.dateColumn, item.typeColumn, item.seriesColumn, item.episodeColumn]
          .some((index) => index !== null && index > maximumColumn)) {
        throw fail("plan", "The CSV plan references data outside the inspected file.");
      }
      assertTitlePrefix(item, file.sample.map((row) => row[item.titleColumn]));
    } else if (file.format === "html") {
      if (!ownKeysOnly(item, HTML_KEYS)) throw fail("plan", "The HTML plan contains unsupported fields.");
      if (typeof item.itemClass !== "string" || !item.itemClass || item.itemClass.length > limits.fieldCharacters ||
        !file.structure.classes.includes(item.itemClass)) {
        throw fail("plan", "The HTML plan references an unobserved class.");
      }
      if (!Number.isInteger(item.titleLink) || item.titleLink < 0 || item.titleLink > 7) {
        throw fail("plan", "The HTML plan has an invalid link index.");
      }
      if (typeof item.requireHref !== "boolean" || !Array.isArray(item.skipIncludes) ||
        item.skipIncludes.length > limits.fields) {
        throw fail("plan", "The HTML plan has invalid skip text.");
      }
      const sampleText = file.sample.map((block) => block.text).join("\n");
      for (const skip of item.skipIncludes) {
        if (typeof skip !== "string" || !skip || skip.length > limits.fieldCharacters || !sampleText.includes(skip)) {
          throw fail("plan", "The HTML plan references skip text that was not in the sample.");
        }
      }
    } else {
      if (!ownKeysOnly(item, JSON_KEYS, ["titlePrefix"]) || !validPath(item.recordsPath) || !validPath(item.titlePath)) {
        throw fail("plan", "The JSON plan contains invalid paths.");
      }
      for (const key of ["datePath", "typePath", "seriesPath", "episodePath"]) {
        if (!validPath(item[key], true)) throw fail("plan", "The JSON plan contains invalid optional paths.");
      }
      const records = file.recordSets.get(JSON.stringify(item.recordsPath));
      if (!records) throw fail("plan", "The JSON plan references an unknown records path.");
      for (const key of ["titlePath", "datePath", "typePath", "seriesPath", "episodePath"]) {
        if (item[key] !== null && !records.some((record) => readPath(record, item[key]) !== undefined)) {
          throw fail("plan", "The JSON plan references an unobserved field path.");
        }
      }
      assertTitlePrefix(item, file.sample.map((record) => readPath(record, item.titlePath)));
    }
    const copy = {
      ...item,
      typeMap: { movie: item.typeMap.movie.slice(), series: item.typeMap.series.slice() }
    };
    if (file.format === "html") copy.skipIncludes = item.skipIncludes.slice();
    else copy.titlePrefix = item.titlePrefix || null;
    plan.files.push(copy);
  }
  return plan;
}

function assertTitlePrefix(item, values) {
  if (item.titlePrefix == null) return;
  if (typeof item.titlePrefix !== "string" || item.titlePrefix.length < 1 || item.titlePrefix.length > 40) {
    throw fail("plan", "The history import plan has an invalid title prefix.");
  }
  if (!values.some((value) => String(value || "").startsWith(item.titlePrefix))) {
    throw fail("plan", "The history import plan title prefix was not in the sample.");
  }
}

function realDate(year, month, day) {
  if (!Number.isInteger(year) || year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(value, format) {
  if (format === "none" || value === null || value === undefined) return null;
  const source = String(value).trim();
  let match;
  if (format === "iso") {
    match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/.exec(source);
    return match ? realDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
  }
  match = /^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/.exec(source);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  let third = Number(match[3]);
  if (third < 100) third += 2000;
  if (format === "ymd") return realDate(first, second, third);
  return format === "dmy" ? realDate(third, second, first) : realDate(third, first, second);
}

function netflixDate(value) {
  const source = String(value || "").trim();
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(source);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  return first > 12 ? realDate(year, second, first) : realDate(year, first, second);
}

function mappedType(value, typeMap) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  for (const kind of ["movie", "series"]) {
    if (typeMap[kind].some((item) => item.toLowerCase() === normalized)) return kind;
  }
  return "other";
}

function titlePrefix(title) {
  if (!title.includes(": ")) return null;
  const prefix = title.split(": ")[0].trim();
  return prefix.length >= 2 ? prefix : null;
}

function sortTitles(left, right, key) {
  if (left.lastWatched !== right.lastWatched) {
    if (!left.lastWatched) return 1;
    if (!right.lastWatched) return -1;
    return left.lastWatched < right.lastWatched ? 1 : -1;
  }
  return left[key].localeCompare(right[key]);
}

function importedAt(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) throw fail("input", "The import timestamp is invalid.");
  return date.toISOString();
}

export function applyHistoryPlan(value, files, {
  limits = HISTORY_IMPORT_LIMITS,
  now = () => new Date(),
  dateParser = null
} = {}) {
  const plan = validateHistoryPlan(value, files, { limits });
  const entries = [];
  const sources = [];
  for (const filePlan of plan.files) {
    const file = findFile(files, filePlan.name);
    const rows = file.format === "csv"
      ? file.rows.slice(filePlan.dataStartRow)
      : file.recordSets.get(JSON.stringify(filePlan.recordsPath));
    if (rows.length > limits.records) throw fail("limit", "The history file contains too many records.");
    sources.push({ name: file.name, format: file.format, records: rows.length });
    for (const row of rows) {
      const get = file.format === "csv"
        ? (column) => column === null ? undefined : row[column]
        : (path) => path === null ? undefined : readPath(row, path);
      const title = String(get(file.format === "csv" ? filePlan.titleColumn : filePlan.titlePath) || "").trim();
      if (!title) continue;
      const rawType = get(file.format === "csv" ? filePlan.typeColumn : filePlan.typePath);
      const series = String(get(file.format === "csv" ? filePlan.seriesColumn : filePlan.seriesPath) || "").trim();
      const rawDate = get(file.format === "csv" ? filePlan.dateColumn : filePlan.datePath);
      const date = dateParser ? dateParser(rawDate) : parseDate(rawDate, filePlan.dateFormat);
      entries.push({
        title,
        date,
        kind: rawType === undefined ? null : mappedType(rawType, filePlan.typeMap),
        series: series || null
      });
    }
  }
  return assembleHistory(entries, sources, now, limits);
}

function assembleHistory(entries, sources, now, limits) {
  const prefixes = new Map();
  for (const entry of entries) {
    if (entry.kind !== null || entry.series || SEASON_RE.test(entry.title)) continue;
    const prefix = titlePrefix(entry.title);
    if (prefix) prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
  }

  const series = new Map();
  const movies = new Map();
  const other = new Map();
  const seen = new Set();
  for (const entry of entries) {
    const season = SEASON_RE.exec(entry.title);
    const inferredSeries = entry.series || (season ? season[1].trim() : null);
    const repeatedSeries = !inferredSeries && entry.kind === null && titlePrefix(entry.title) &&
      prefixes.get(titlePrefix(entry.title)) >= 3 ? titlePrefix(entry.title) : null;
    const seriesName = inferredSeries || repeatedSeries;
    const kind = entry.kind === "other" ? "other" : (entry.kind === "series" || seriesName ? "series" : "movie");
    const seenTitle = normalizeTitle(entry.title);
    if (seenTitle) seen.add(seenTitle);
    if (kind === "series") {
      const name = seriesName || entry.title;
      const current = series.get(name) || { name, episodes: 0, lastWatched: null };
      current.episodes += 1;
      if (entry.date && (!current.lastWatched || entry.date > current.lastWatched)) current.lastWatched = entry.date;
      series.set(name, current);
      const seenName = normalizeTitle(name);
      if (seenName) seen.add(seenName);
    } else {
      const target = kind === "other" ? other : movies;
      const current = target.get(entry.title) || { title: entry.title, lastWatched: null };
      if (entry.date && (!current.lastWatched || entry.date > current.lastWatched)) current.lastWatched = entry.date;
      target.set(entry.title, current);
    }
  }

  const normalized = {
    schema: 2,
    importedAt: importedAt(now),
    sources,
    series: Array.from(series.values()).sort((left, right) =>
      right.episodes - left.episodes || left.name.localeCompare(right.name)),
    movies: Array.from(movies.values()).sort((left, right) => sortTitles(left, right, "title")),
    other: Array.from(other.values()).sort((left, right) => sortTitles(left, right, "title")),
    seen: Array.from(seen).sort()
  };
  if (TEXT_ENCODER.encode(JSON.stringify(normalized)).byteLength > limits.normalizedHistoryBytes) {
    throw fail("limit", "The normalized history exceeds the 1 MiB storage limit.");
  }
  return normalized;
}

function isYouTubeJson(value) {
  return Array.isArray(value) && value.some((row) =>
    row && typeof row === "object" && !Array.isArray(row) &&
    (row.header === "YouTube" || row.header === "YouTube Music") &&
    typeof row.title === "string" && row.title.startsWith("Watched ")
  );
}

function isYouTubeHtml(text) {
  return typeof text === "string" && /Watched\s*<a\s[^>]*href\s*=/i.test(text);
}

function youtubeRowFromJson(row) {
  const titleRaw = typeof row?.title === "string" ? row.title : "";
  if (!titleRaw.startsWith("Watched ")) return null;
  const header = row.header;
  if (header !== "YouTube" && header !== "YouTube Music") return null;
  const details = Array.isArray(row.details) ? row.details : [];
  if (details.some((item) => item && item.name === "From Google Ads")) return null;
  if (/video that has been removed/i.test(titleRaw)) return null;
  if (typeof row.titleUrl !== "string" || !row.titleUrl.trim()) return null;
  const title = titleRaw.slice("Watched ".length).trim();
  if (!title) return null;
  const channel = Array.isArray(row.subtitles) && row.subtitles[0] && typeof row.subtitles[0].name === "string"
    ? row.subtitles[0].name.trim()
    : "";
  return { title, date: typeof row.time === "string" ? row.time : null, channel };
}

function youtubeRowsFromHtml(text) {
  const Parser = globalThis.DOMParser;
  if (typeof Parser !== "function") throw fail("input", "This browser cannot read a YouTube HTML export.");
  const doc = new Parser().parseFromString(String(text || ""), "text/html");
  const cells = [...doc.querySelectorAll(".content-cell")];
  const nodes = cells.length ? cells : [...doc.body.querySelectorAll("div, li, p")];
  const rows = [];
  for (const cell of nodes) {
    if (cell.querySelector && cell.querySelector(".content-cell")) continue;
    const html = cell.innerHTML || "";
    const textContent = cell.textContent || "";
    if (!/Watched\s*<a\s/i.test(html) && !/^\s*Watched\b/.test(textContent)) continue;
    if (/From Google Ads/i.test(textContent)) continue;
    if (/video that has been removed/i.test(textContent)) continue;
    const link = cell.querySelector("a[href]");
    const href = link ? (link.getAttribute("href") || "") : "";
    if (!href.trim()) continue;
    const title = String(link.textContent || "").replace(/\s+/g, " ").trim();
    if (!title || /video that has been removed/i.test(title)) continue;
    const anchors = [...cell.querySelectorAll("a")];
    const channel = anchors.length > 1 ? String(anchors[1].textContent || "").replace(/\s+/g, " ").trim() : "";
    rows.push({ title, date: null, channel });
  }
  return rows;
}

function finishNormalized(value, limits) {
  if (TEXT_ENCODER.encode(JSON.stringify(value)).byteLength > limits.normalizedHistoryBytes) {
    throw fail("limit", "The normalized history exceeds the 1 MiB storage limit.");
  }
  return value;
}

function historyFromYouTubeRows(file, rows, now, limits) {
  const other = new Map();
  const seen = new Set();
  for (const row of rows) {
    const key = normalizeTitle(row.title);
    if (key) seen.add(key);
    const current = other.get(row.title) || { title: row.title, lastWatched: null, channel: row.channel || "" };
    if (row.date && (!current.lastWatched || row.date > current.lastWatched)) current.lastWatched = row.date;
    if (row.channel) current.channel = row.channel;
    other.set(row.title, current);
  }
  return finishNormalized({
    schema: 2,
    importedAt: importedAt(now),
    sources: [{ name: file.name, kind: "youtube", format: file.format, records: rows.length }],
    series: [],
    movies: [],
    other: Array.from(other.values()).sort((left, right) => sortTitles(left, right, "title")),
    seen: Array.from(seen).sort()
  }, limits);
}

function netflixFilePlan(file) {
  const header = file.rows?.[0] || [];
  const titleColumn = header.findIndex((value) => String(value).trim().toLowerCase() === "title");
  const dateColumn = header.findIndex((value) => String(value).trim().toLowerCase() === "date");
  if (titleColumn === -1 || dateColumn === -1) return null;
  return {
    name: file.name,
    format: "csv",
    headerRow: 0,
    dataStartRow: 1,
    titleColumn,
    dateColumn,
    typeColumn: null,
    seriesColumn: null,
    episodeColumn: null,
    dateFormat: "mdy",
    typeMap: { movie: [], series: [] }
  };
}

function mergeImportedHistories(parts, now, limits) {
  const seen = new Set();
  const sources = [];
  const series = [];
  const movies = [];
  const other = [];
  for (const part of parts) {
    for (const key of part.seen || []) seen.add(key);
    sources.push(...(part.sources || []));
    series.push(...(part.series || []));
    movies.push(...(part.movies || []));
    other.push(...(part.other || []));
  }
  return finishNormalized({
    schema: 2,
    importedAt: importedAt(now),
    sources,
    series,
    movies,
    other,
    seen: Array.from(seen).sort()
  }, limits);
}

export function detectKnownExport(files, { now = () => new Date(), limits = HISTORY_IMPORT_LIMITS } = {}) {
  const parts = [];
  for (const file of Array.isArray(files) ? files : []) {
    if (file?.format === "json" && isYouTubeJson(file.value)) {
      const rows = file.value.map(youtubeRowFromJson).filter(Boolean);
      parts.push(historyFromYouTubeRows(file, rows, now, limits));
      continue;
    }
    if (file?.format === "html" && isYouTubeHtml(file.text)) {
      parts.push(historyFromYouTubeRows(file, youtubeRowsFromHtml(file.text), now, limits));
      continue;
    }
    if (file?.format === "csv") {
      const plan = netflixFilePlan(file);
      if (!plan) continue;
      const parsed = applyHistoryPlan(
        { schema: 1, files: [plan] },
        [file],
        { limits, now, dateParser: netflixDate }
      );
      parsed.sources = parsed.sources.map((source) => ({ ...source, kind: "netflix" }));
      parts.push(parsed);
    }
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return mergeImportedHistories(parts, now, limits);
}

async function runGeneratedHistoryPlan(plan, files, { limits, now, signal }) {
  const validated = validateHistoryPlan(plan, files, { limits });
  const code = generateHistoryExtractorSource(validated);
  const fileTexts = {};
  for (const item of validated.files) fileTexts[item.name] = findFile(files, item.name).text;
  checkAbort(signal);
  let extracted;
  try {
    extracted = await createHistoryRuntime().run({ code, files: fileTexts, limits, signal });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;
    throw fail(cause?.code || "plan", cause?.message || "The generated history reader failed.", cause);
  }
  checkAbort(signal);
  if (!Array.isArray(extracted) || extracted.length === 0) {
    throw fail("input", "This file has no readable titles.");
  }
  const plans = new Map(validated.files.map((item) => [item.name, item]));
  const counts = new Map();
  const entries = [];
  for (const row of extracted) {
    const item = plans.get(row.file);
    if (!item) throw fail("plan", "The generated history reader returned an unknown file.");
    counts.set(item.name, (counts.get(item.name) || 0) + 1);
    const rawType = row.type == null || row.type === "" ? undefined : row.type;
    entries.push({
      title: row.title,
      date: row.date,
      kind: rawType === undefined ? null : mappedType(rawType, item.typeMap),
      series: row.series || null
    });
  }
  const sources = validated.files.map((item) => ({
    name: item.name,
    format: item.format,
    records: counts.get(item.name) || 0
  }));
  const history = assembleHistory(entries, sources, now, limits);
  if (!history.seen.length) throw fail("input", "This file has no readable titles.");
  return history;
}

export async function parseWatchHistoryExport(input, {
  inferPlan,
  now = () => new Date(),
  signal = null,
  limits = HISTORY_IMPORT_LIMITS
} = {}) {
  const files = inspectWatchHistoryFiles(input, { limits, signal });
  if (typeof inferPlan !== "function") throw fail("config", "No history schema inference adapter is configured.");
  const inferenceInput = buildHistoryInferenceInput(files, { limits });
  checkAbort(signal);
  const plan = await inferPlan(inferenceInput, { signal });
  checkAbort(signal);
  return runGeneratedHistoryPlan(plan, files, { limits, now, signal });
}

export function parseNetflixCsv(text) {
  const files = inspectWatchHistoryFiles({ name: "ViewingActivity.csv", text });
  const header = files[0].rows[0] || [];
  const titleColumn = header.findIndex((value) => String(value).trim().toLowerCase() === "title");
  const dateColumn = header.findIndex((value) => String(value).trim().toLowerCase() === "date");
  if (titleColumn === -1 || dateColumn === -1) throw new Error("CSV must have Title and Date columns");
  const parsed = applyHistoryPlan({
    schema: 1,
    files: [{
      name: "ViewingActivity.csv",
      format: "csv",
      headerRow: 0,
      dataStartRow: 1,
      titleColumn,
      dateColumn,
      typeColumn: null,
      seriesColumn: null,
      episodeColumn: null,
      dateFormat: "mdy",
      typeMap: { movie: [], series: [] }
    }]
  }, files, { dateParser: netflixDate });
  parsed.sources = parsed.sources.map((source) => ({ ...source, kind: "netflix" }));
  return parsed;
}

export function resolveHistoryWithCatalog(history, records, { limits = HISTORY_IMPORT_LIMITS } = {}) {
  if (!history || typeof history !== "object") return history;
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) return history;

  const byKeyAndKind = new Map();
  const byKey = new Map();
  const better = (candidate, current) => {
    if (!current) return true;
    const cv = Number(candidate?.v) || 0;
    const xv = Number(current?.v) || 0;
    if (cv !== xv) return cv > xv;
    const cTmdb = String(candidate?.id || "").startsWith("tmdb:") ? 0 : 1;
    const xTmdb = String(current?.id || "").startsWith("tmdb:") ? 0 : 1;
    if (cTmdb !== xTmdb) return cTmdb < xTmdb;
    return String(candidate?.id || "").localeCompare(String(current?.id || "")) < 0;
  };

  for (const rec of list) {
    if (!rec || typeof rec.id !== "string" || typeof rec.t !== "string") continue;
    const key = normalizeTitle(rec.t);
    if (!key) continue;
    const kind = rec.k === "series" || rec.k === "tv" ? "series" : rec.k === "movie" ? "movie" : "other";
    const kk = key + "\0" + kind;
    if (better(rec, byKeyAndKind.get(kk))) byKeyAndKind.set(kk, rec);
    if (better(rec, byKey.get(key))) byKey.set(key, rec);
  }

  const resolvedIds = new Set();
  const attach = (entry, titleField, preferredKind) => {
    if (!entry || typeof entry !== "object") return entry;
    const rawTitle = entry[titleField];
    const key = normalizeTitle(rawTitle);
    if (!key) return { ...entry };
    const match = (preferredKind && byKeyAndKind.get(key + "\0" + preferredKind)) || byKey.get(key) || null;
    if (!match) return { ...entry };
    resolvedIds.add(match.id);
    const next = { ...entry, id: match.id };
    if (Number.isInteger(match.y)) next.y = match.y;
    if (Number.isInteger(match.rt) && match.rt > 0) next.rt = match.rt;
    if (typeof match.l === "string" && match.l) next.l = match.l;
    if (Array.isArray(match.g) && match.g.length > 0) next.g = match.g.slice(0, 6);
    return next;
  };

  const candidate = {
    ...history,
    series: (Array.isArray(history.series) ? history.series : []).map((item) => attach(item, "name", "series")),
    movies: (Array.isArray(history.movies) ? history.movies : []).map((item) => attach(item, "title", "movie")),
    other: (Array.isArray(history.other) ? history.other : []).map((item) => attach(item, "title", null)),
    resolvedIds: Array.from(resolvedIds).sort()
  };
  if (TEXT_ENCODER.encode(JSON.stringify(candidate)).byteLength > limits.normalizedHistoryBytes) {
    return history;
  }
  return candidate;
}

export function summarize(parsed) {
  const other = Array.isArray(parsed?.other) && parsed.other.length ? `, ${parsed.other.length} other` : "";
  return `${parsed.series.length} series, ${parsed.movies.length} movies${other}, ${parsed.seen.length} titles seen`;
}

export function historyImportReply(filename, parsed) {
  const series = Array.isArray(parsed?.series) ? parsed.series.length : 0;
  const movies = Array.isArray(parsed?.movies) ? parsed.movies.length : 0;
  const other = Array.isArray(parsed?.other) ? parsed.other.length : 0;
  const seen = Array.isArray(parsed?.seen) ? parsed.seen.length : 0;
  const noun = seen === 1 ? "title" : "titles";
  return `Read ${filename}. Marked ${seen.toLocaleString("en-IN")} ${noun} seen. ${series.toLocaleString("en-IN")} series, ${movies.toLocaleString("en-IN")} movies, ${other.toLocaleString("en-IN")} other.`;
}
