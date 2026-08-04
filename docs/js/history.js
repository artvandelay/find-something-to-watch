import { extractHistoryArchive } from "./archive.js";

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
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function parseCsv(text, limits) {
  let source = String(text || "");
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  function finishField() {
    if (field.length > limits.fieldCharacters) {
      throw fail("limit", `CSV fields may contain at most ${limits.fieldCharacters} characters.`);
    }
    if (row.length >= limits.fields) {
      throw fail("limit", `CSV rows may contain at most ${limits.fields} fields.`);
    }
    row.push(field);
    field = "";
    closedQuote = false;
  }

  function finishRow() {
    finishField();
    if (row.length !== 1 || row[0] !== "") {
      if (rows.length >= limits.records + 1) {
        throw fail("limit", `History files may contain at most ${limits.records} records.`);
      }
      rows.push(row);
    }
    row = [];
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === "\"") {
        if (source[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (closedQuote && char !== "," && char !== "\r" && char !== "\n") {
      throw fail("input", "CSV contains text after a closing quoted field.");
    }
    if (char === "\"") {
      if (field) throw fail("input", "CSV quotes must begin at the start of a field.");
      quoted = true;
    } else if (char === ",") {
      finishField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      field += char;
    }
  }
  if (quoted) throw fail("input", "CSV contains an unterminated quoted field.");
  if (field || row.length) finishRow();
  return rows;
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

function inspectCsv(name, text, limits) {
  const rows = parseCsv(text, limits);
  const maxColumns = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  return {
    name,
    format: "csv",
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
      files.push({ name: trimmed.startsWith("{") || trimmed.startsWith("[") ? "watch-history.json" : "watch-history.csv", text: first });
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
    if (!validName(name) || (extension(name) !== "csv" && extension(name) !== "json")) {
      throw fail("input", "History imports accept only CSV, JSON, or ZIP files.");
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
    return extension(name) === "csv" ? inspectCsv(name, text, limits) : inspectJson(name, text, limits);
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

function ownKeysOnly(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
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
      if (!ownKeysOnly(item, CSV_KEYS)) throw fail("plan", "The CSV plan contains unsupported fields.");
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
    } else {
      if (!ownKeysOnly(item, JSON_KEYS) || !validPath(item.recordsPath) || !validPath(item.titlePath)) {
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
    }
    plan.files.push({ ...item, typeMap: { movie: item.typeMap.movie.slice(), series: item.typeMap.series.slice() } });
  }
  return plan;
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

export async function parseWatchHistoryExport(input, {
  inferPlan,
  now = () => new Date(),
  signal = null,
  limits = HISTORY_IMPORT_LIMITS
} = {}) {
  if (typeof inferPlan !== "function") throw fail("config", "No history schema inference adapter is configured.");
  const files = inspectWatchHistoryFiles(input, { limits, signal });
  const inferenceInput = buildHistoryInferenceInput(files, { limits });
  checkAbort(signal);
  const plan = await inferPlan(inferenceInput, { signal });
  checkAbort(signal);
  return applyHistoryPlan(plan, files, { limits, now });
}

export function parseNetflixCsv(text) {
  const files = inspectWatchHistoryFiles({ name: "ViewingActivity.csv", text });
  const header = files[0].rows[0] || [];
  const titleColumn = header.findIndex((value) => String(value).trim().toLowerCase() === "title");
  const dateColumn = header.findIndex((value) => String(value).trim().toLowerCase() === "date");
  if (titleColumn === -1 || dateColumn === -1) throw new Error("CSV must have Title and Date columns");
  return applyHistoryPlan({
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
}

export function summarize(parsed) {
  const other = Array.isArray(parsed?.other) && parsed.other.length ? `, ${parsed.other.length} other` : "";
  return `${parsed.series.length} series, ${parsed.movies.length} movies${other}, ${parsed.seen.length} titles seen`;
}
