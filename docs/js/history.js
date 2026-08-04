const SEASON_RE =
  /^(.+?): (?:Season \d+|Part \d+|Limited Series|Chapter \d+|Book \d+|Volume \d+|Series \d+|Collection \d+): (.+)$/;

function normalizeTitle(s) {
  return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function parseCsv(text) {
  let src = String(text || "");
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  function endField() {
    row.push(field);
    field = "";
  }

  function endRow() {
    endField();
    const isEmpty = row.length === 1 && row[0] === "";
    if (!isEmpty) rows.push(row);
    row = [];
  }

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (src[i + 1] === "\"") {
          field += "\"";
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === "\"") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      if (src[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field !== "" || row.length > 0) endRow();
  return rows;
}

function parseDate(s) {
  const parts = String(s || "").trim().split("/");
  if (parts.length !== 3) return null;
  const a = parseInt(parts[0], 10);
  const b = parseInt(parts[1], 10);
  const c = parseInt(parts[2], 10);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
  const year = c < 100 ? 2000 + c : c;
  let month;
  let day;
  if (a > 12) {
    day = a;
    month = b;
  } else {
    month = a;
    day = b;
  }
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export function parseNetflixCsv(text) {
  const rows = parseCsv(text);
  const header = rows.length > 0 ? rows[0] : [];
  let titleIdx = -1;
  let dateIdx = -1;
  for (let i = 0; i < header.length; i += 1) {
    const key = String(header[i] || "").trim().toLowerCase();
    if (key === "title" && titleIdx === -1) titleIdx = i;
    if (key === "date" && dateIdx === -1) dateIdx = i;
  }
  if (titleIdx === -1 || dateIdx === -1) {
    throw new Error("CSV must have Title and Date columns");
  }

  const items = [];
  for (let r = 1; r < rows.length; r += 1) {
    const title = String(rows[r][titleIdx] || "").trim();
    if (!title) continue;
    items.push({ title, date: parseDate(rows[r][dateIdx]) });
  }

  const showOf = [];
  for (let i = 0; i < items.length; i += 1) {
    const m = SEASON_RE.exec(items[i].title);
    if (m) showOf[i] = m[1].trim();
  }

  const prefixCounts = new Map();
  for (let i = 0; i < items.length; i += 1) {
    if (showOf[i] !== undefined) continue;
    if (!items[i].title.includes(": ")) continue;
    const prefix = items[i].title.split(": ")[0].trim();
    if (prefix.length < 2) continue;
    prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
  }
  for (let i = 0; i < items.length; i += 1) {
    if (showOf[i] !== undefined) continue;
    if (!items[i].title.includes(": ")) continue;
    const prefix = items[i].title.split(": ")[0].trim();
    if (prefix.length < 2) continue;
    if ((prefixCounts.get(prefix) || 0) >= 3) showOf[i] = prefix;
  }

  const seriesMap = new Map();
  for (let i = 0; i < items.length; i += 1) {
    const name = showOf[i];
    if (name === undefined) continue;
    const entry = seriesMap.get(name) || { name, episodes: 0, lastWatched: null };
    entry.episodes += 1;
    const date = items[i].date;
    if (date && (!entry.lastWatched || date > entry.lastWatched)) entry.lastWatched = date;
    seriesMap.set(name, entry);
  }
  const series = Array.from(seriesMap.values()).sort((x, y) => {
    if (y.episodes !== x.episodes) return y.episodes - x.episodes;
    return x.name.localeCompare(y.name);
  });

  const moviesMap = new Map();
  for (let i = 0; i < items.length; i += 1) {
    if (showOf[i] !== undefined) continue;
    const title = items[i].title;
    const date = items[i].date;
    const entry = moviesMap.get(title);
    if (!entry) {
      moviesMap.set(title, { title, lastWatched: date });
      continue;
    }
    if (date && (!entry.lastWatched || date > entry.lastWatched)) entry.lastWatched = date;
  }
  const movies = Array.from(moviesMap.values()).sort((x, y) => {
    if (x.lastWatched !== y.lastWatched) {
      if (!x.lastWatched) return 1;
      if (!y.lastWatched) return -1;
      return x.lastWatched < y.lastWatched ? 1 : -1;
    }
    return x.title.localeCompare(y.title);
  });

  const seenSet = new Set();
  for (let i = 0; i < items.length; i += 1) {
    const key = normalizeTitle(items[i].title);
    if (key) seenSet.add(key);
  }
  for (const entry of series) {
    const key = normalizeTitle(entry.name);
    if (key) seenSet.add(key);
  }
  const seen = Array.from(seenSet).sort();

  return { importedAt: new Date().toISOString(), series, movies, seen };
}

export function summarize(parsed) {
  return `${parsed.series.length} series, ${parsed.movies.length} movies, ${parsed.seen.length} titles seen`;
}
