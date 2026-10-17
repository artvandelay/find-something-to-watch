const DEFAULT_LIMITS = Object.freeze({
  records: 50000,
  fields: 64,
  fieldCharacters: 2000
});

const MAX_CODE_CHARACTERS = 12000;
const ALLOWED_WORDS = new Set([
  "const", "let", "for", "if", "break", "continue", "return", "of", "null",
  "out", "rows", "readCsv", "files", "i", "length", "MAX", "row", "title", "cell",
  "startsWith", "slice", "trim", "push", "file", "date", "readDate", "type", "series",
  "records", "readJson", "segments", "segment", "Array", "isArray", "record", "field",
  "blocks", "readHtml", "block", "classes", "includes", "text", "link", "links", "href", "String"
]);
const FORBIDDEN = /\b(import|export|eval|Function|fetch|XMLHttpRequest|WebSocket|Worker|postMessage|globalThis|process|require|document|window|self|constructor|__proto__|prototype|AsyncFunction|importScripts|localStorage|indexedDB)\b/;

export class HistoryExtractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HistoryExtractError";
    this.code = code;
  }
}

function extractError(code, message) {
  return new HistoryExtractError(code, message);
}

function limitsOf(limits) {
  return {
    records: limits?.records || DEFAULT_LIMITS.records,
    fields: limits?.fields || DEFAULT_LIMITS.fields,
    fieldCharacters: limits?.fieldCharacters || DEFAULT_LIMITS.fieldCharacters
  };
}

export function readCsv(text, limits = DEFAULT_LIMITS) {
  const active = limitsOf(limits);
  let source = String(text || "");
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  function finishField() {
    if (field.length > active.fieldCharacters) {
      throw extractError("limit", `CSV fields may contain at most ${active.fieldCharacters} characters.`);
    }
    if (row.length >= active.fields) {
      throw extractError("limit", `CSV rows may contain at most ${active.fields} fields.`);
    }
    row.push(field);
    field = "";
    closedQuote = false;
  }

  function finishRow() {
    finishField();
    if (row.length !== 1 || row[0] !== "") {
      if (rows.length >= active.records + 1) {
        throw extractError("limit", `History files may contain at most ${active.records} records.`);
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
      throw extractError("input", "CSV contains text after a closing quoted field.");
    }
    if (char === "\"") {
      if (field) throw extractError("input", "CSV quotes must begin at the start of a field.");
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
  if (quoted) throw extractError("input", "CSV contains an unterminated quoted field.");
  if (field || row.length) finishRow();
  return rows;
}

export function readJson(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    throw extractError("input", "The history file is not valid JSON.");
  }
}

function attribute(tag, name) {
  const pattern = new RegExp("\\b" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')", "i");
  const match = pattern.exec(tag);
  return match ? (match[2] || match[3] || "") : "";
}

export function readHtml(text, limits = DEFAULT_LIMITS) {
  const active = limitsOf(limits);
  const source = String(text || "");
  const blocks = [];
  let index = 0;
  while (index < source.length && blocks.length < active.records) {
    const open = source.indexOf("<", index);
    if (open === -1) break;
    if (source.startsWith("</", open) || source.startsWith("<!", open) || source.startsWith("<?", open)) {
      index = open + 2;
      continue;
    }
    const close = source.indexOf(">", open);
    if (close === -1) break;
    const startTag = source.slice(open + 1, close);
    if (startTag.endsWith("/")) {
      index = close + 1;
      continue;
    }
    const space = startTag.search(/\s/);
    const tag = (space === -1 ? startTag : startTag.slice(0, space)).toLowerCase();
    if (!/^[a-z][\w:-]*$/.test(tag)) {
      index = close + 1;
      continue;
    }
    const end = source.toLowerCase().indexOf("</" + tag + ">", close + 1);
    if (end === -1) {
      index = close + 1;
      continue;
    }
    const classes = attribute(startTag, "class").split(/\s+/).filter(Boolean).slice(0, active.fields);
    const inner = source.slice(close + 1, end);
    const links = [];
    const lower = inner.toLowerCase();
    let linkAt = 0;
    while (links.length < 8) {
      const found = lower.indexOf("<a", linkAt);
      if (found === -1) break;
      const linkClose = inner.indexOf(">", found);
      if (linkClose === -1) break;
      const linkEnd = lower.indexOf("</a>", linkClose);
      if (linkEnd === -1) break;
      const label = inner.slice(linkClose + 1, linkEnd).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      links.push({
        href: attribute(inner.slice(found, linkClose), "href").slice(0, active.fieldCharacters),
        text: label.slice(0, active.fieldCharacters)
      });
      linkAt = linkEnd + 4;
    }
    if (classes.length || links.length) {
      blocks.push({
        classes,
        text: inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, active.fieldCharacters),
        links
      });
    }
    index = close + 1;
  }
  return blocks;
}

function realDate(year, month, day) {
  if (!Number.isInteger(year) || year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function readDate(value, format) {
  if (format === "none" || value === null || value === undefined || value === "") return null;
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

export function cell(row, index) {
  if (!Array.isArray(row) || !Number.isInteger(index) || index < 0 || index >= row.length) return "";
  return String(row[index] ?? "").trim();
}

export function field(record, path) {
  let current = record;
  for (const segment of Array.isArray(path) ? path : []) {
    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) return "";
    current = current[segment];
  }
  if (current == null || typeof current === "object") return "";
  return String(current).trim();
}

function withoutStrings(code) {
  return String(code)
    .replace(/"(?:\\.|[^"\\])*"/g, "\"\"")
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

export function assertExtractorSource(code) {
  if (typeof code !== "string" || !code.startsWith("\"use strict\";") || !code.trimEnd().endsWith("return out;")) {
    throw extractError("plan", "The generated history reader was rejected.");
  }
  if (code.length > MAX_CODE_CHARACTERS) {
    throw extractError("plan", "The generated history reader was rejected.");
  }
  const stripped = withoutStrings(code);
  if (FORBIDDEN.test(stripped) || /=>|\bnew\b|\bthis\b/.test(stripped)) {
    throw extractError("plan", "The generated history reader was rejected.");
  }
  const words = stripped.match(/\b[A-Za-z_$][\w$]*\b/g) || [];
  if (words.some((word) => !ALLOWED_WORDS.has(word))) {
    throw extractError("plan", "The generated history reader was rejected.");
  }
}

function sanitizeEntries(value, limits) {
  const active = limitsOf(limits);
  if (!Array.isArray(value)) {
    throw extractError("plan", "The generated history reader returned an unexpected result.");
  }
  if (value.length > active.records) {
    throw extractError("limit", "The history file contains too many records.");
  }
  const entries = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw extractError("plan", "The generated history reader returned an unexpected result.");
    }
    const keys = Object.keys(item);
    if (keys.some((key) => key !== "file" && key !== "title" && key !== "date" && key !== "type" && key !== "series")) {
      throw extractError("plan", "The generated history reader returned an unexpected result.");
    }
    if (typeof item.title !== "string" || typeof item.file !== "string") continue;
    const title = item.title.trim();
    if (!title) continue;
    if (title.length > active.fieldCharacters) {
      throw extractError("limit", "The generated history reader returned a title that is too long.");
    }
    const date = typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : null;
    const type = item.type == null || item.type === "" ? null : String(item.type).slice(0, active.fieldCharacters);
    const series = item.series == null || item.series === "" ? null : String(item.series).slice(0, active.fieldCharacters);
    entries.push({ file: item.file, title, date, type, series });
  }
  return entries;
}

/**
 * Runs generated extractor source. Call this only from a disposable worker.
 * The source may read the supplied files and return titles and dates.
 */
export function executeHistoryExtractor(code, fileTexts, limits = DEFAULT_LIMITS) {
  assertExtractorSource(code);
  const active = limitsOf(limits);
  if (!fileTexts || typeof fileTexts !== "object" || Array.isArray(fileTexts)) {
    throw extractError("plan", "The generated history reader was rejected.");
  }
  const names = Object.keys(fileTexts);
  if (!names.length || names.length > 100) {
    throw extractError("plan", "The generated history reader was rejected.");
  }
  const files = Object.create(null);
  for (const name of names) {
    if (typeof fileTexts[name] !== "string") {
      throw extractError("plan", "The generated history reader was rejected.");
    }
    files[name] = fileTexts[name];
  }
  Object.freeze(files);
  let result;
  try {
    const run = new Function(
      "files", "readCsv", "readJson", "readHtml", "cell", "field", "readDate", "MAX",
      code
    );
    result = run(
      files,
      (text) => readCsv(text, active),
      readJson,
      (text) => readHtml(text, active),
      cell,
      field,
      readDate,
      active.records
    );
  } catch (cause) {
    if (cause instanceof HistoryExtractError) throw cause;
    throw extractError("plan", "The generated history reader failed.");
  }
  return sanitizeEntries(result, active);
}
