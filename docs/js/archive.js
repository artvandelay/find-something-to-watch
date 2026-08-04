import { unzipSync } from "./vendor/fflate.js";

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function archiveError(message, cause = null) {
  const error = new Error(message);
  error.name = "HistoryImportError";
  error.code = "archive";
  if (cause) error.cause = cause;
  return error;
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw archiveError("The ZIP upload must be binary data.");
}

function read16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function read32(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function checkAbort(signal) {
  if (signal?.aborted) {
    const error = new Error("The history import was cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

function findEndOfCentralDirectory(bytes) {
  const start = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (read32(bytes, i) === ZIP_EOCD) return i;
  }
  throw archiveError("The ZIP archive is malformed.");
}

function extension(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function decodeName(bytes) {
  try {
    return UTF8.decode(bytes);
  } catch (cause) {
    throw archiveError("The ZIP archive contains a non-text filename.", cause);
  }
}

function validateName(name) {
  if (
    !name ||
    name.length > 255 ||
    name.includes("\0") ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    name.includes("\\") ||
    name.split("/").some((part) => part === ".." || part === ".")
  ) {
    throw archiveError("The ZIP archive contains an unsafe entry name.");
  }
  const format = extension(name);
  if (format !== "csv" && format !== "json") {
    throw archiveError("ZIP archives may contain only CSV or JSON history files.");
  }
  return format;
}

function assertText(bytes, name) {
  try {
    const text = UTF8.decode(bytes);
    if (text.includes("\0") || /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
      throw archiveError(`The ZIP entry "${name}" is binary, not text.`);
    }
    return text;
  } catch (cause) {
    if (cause?.name === "HistoryImportError") throw cause;
    throw archiveError(`The ZIP entry "${name}" is not valid UTF-8 text.`, cause);
  }
}

function inspectEntries(bytes, limits, signal) {
  const end = findEndOfCentralDirectory(bytes);
  const disk = read16(bytes, end + 4);
  const centralDisk = read16(bytes, end + 6);
  const entries = read16(bytes, end + 10);
  const centralSize = read32(bytes, end + 12);
  let offset = read32(bytes, end + 16);

  if (disk !== 0 || centralDisk !== 0 || entries !== read16(bytes, end + 8)) {
    throw archiveError("Multi-disk ZIP archives are not supported.");
  }
  if (entries > limits.archiveEntries) {
    throw archiveError(`ZIP archives may contain at most ${limits.archiveEntries} entries.`);
  }
  if (offset + centralSize > end || offset > bytes.length) {
    throw archiveError("The ZIP central directory is malformed.");
  }

  const seenNames = new Set();
  const files = [];
  let extractedBytes = 0;
  for (let index = 0; index < entries; index += 1) {
    checkAbort(signal);
    if (offset + 46 > bytes.length || read32(bytes, offset) !== ZIP_CENTRAL) {
      throw archiveError("The ZIP central directory is malformed.");
    }

    const flags = read16(bytes, offset + 8);
    const compression = read16(bytes, offset + 10);
    const compressedBytes = read32(bytes, offset + 20);
    const uncompressedBytes = read32(bytes, offset + 24);
    const nameLength = read16(bytes, offset + 28);
    const extraLength = read16(bytes, offset + 30);
    const commentLength = read16(bytes, offset + 32);
    const localOffset = read32(bytes, offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;

    if (next > bytes.length || localOffset + 30 > bytes.length) {
      throw archiveError("The ZIP archive is malformed.");
    }
    if ((flags & 0x1) || (flags & 0x40)) {
      throw archiveError("Encrypted ZIP entries are not supported.");
    }
    if (compression !== 0 && compression !== 8) {
      throw archiveError("The ZIP archive uses an unsupported compression method.");
    }
    if (
      compressedBytes === 0xffffffff ||
      uncompressedBytes === 0xffffffff ||
      compressedBytes > limits.candidateFileBytes ||
      uncompressedBytes > limits.candidateFileBytes
    ) {
      throw archiveError("A ZIP entry exceeds the permitted history-file size.");
    }
    if (read32(bytes, localOffset) !== ZIP_LOCAL) {
      throw archiveError("The ZIP archive has an invalid local file header.");
    }

    const name = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const format = validateName(name);
    if (seenNames.has(name)) throw archiveError("The ZIP archive contains duplicate entry names.");
    seenNames.add(name);
    extractedBytes += uncompressedBytes;
    if (extractedBytes > limits.extractedTextBytes) {
      throw archiveError("The ZIP archive exceeds the total extracted-text limit.");
    }
    files.push({ name, format, compressedBytes, uncompressedBytes });
    offset = next;
  }
  return files;
}

export function extractHistoryArchive(input, { limits, signal = null } = {}) {
  const bytes = asBytes(input);
  if (!limits) throw archiveError("Archive limits are required.");
  if (bytes.byteLength > limits.uploadBytes) {
    throw archiveError("The ZIP upload exceeds the 10 MiB limit.");
  }
  checkAbort(signal);
  const entries = inspectEntries(bytes, limits, signal);
  let extracted;
  try {
    extracted = unzipSync(bytes);
  } catch (cause) {
    throw archiveError("The ZIP archive could not be extracted.", cause);
  }

  const files = [];
  for (const entry of entries) {
    checkAbort(signal);
    const content = extracted[entry.name];
    if (!(content instanceof Uint8Array) || content.byteLength !== entry.uncompressedBytes) {
      throw archiveError(`The ZIP entry "${entry.name}" did not match its declared size.`);
    }
    files.push({
      name: entry.name,
      format: entry.format,
      text: assertText(content, entry.name)
    });
  }
  return files;
}
