// Pure export formatters: data in, string out. No DOM, no imports.

const MAX_RECENT = 25;

function providerLabel(slug) {
  const s = String(slug || "");
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function providerLinks(u) {
  if (!u || typeof u !== "object") return "";
  return Object.keys(u)
    .map((slug) => `[${providerLabel(slug)}](${u[slug]})`)
    .join(" · ");
}

function firstUrl(u) {
  if (!u || typeof u !== "object") return "";
  const keys = Object.keys(u);
  if (keys.length === 0) return "";
  const v = u[keys[0]];
  return v == null ? "" : String(v);
}

export function toMarkdown(picks, meta) {
  if (!Array.isArray(picks) || picks.length === 0) {
    return "# Watch picks\n\nNo results.\n";
  }
  const m = meta || {};
  const head = `# Watch picks\n\n> Query: ${m.query}\n> Generated: ${m.generatedAt}\n`;
  const blocks = picks.map((pick, i) => {
    const p = pick || {};
    const title = p.y == null ? `${p.t}` : `${p.t} (${p.y})`;
    const facts = [p.k];
    if (p.rt != null) facts.push(`${p.rt} min`);
    if (p.r != null) facts.push(`IMDb ${p.r}`);
    const lines = [`## ${i + 1}. ${title}`, `- Kind: ${facts.join(" · ")}`, `- Why: ${p.reason}`];
    const links = providerLinks(p.u);
    if (links) lines.push(`- Watch: ${links}`);
    return lines.join("\n");
  });
  return `${head}\n${blocks.join("\n\n")}\n`;
}

export function toJson(picks, meta) {
  const m = meta || {};
  return JSON.stringify({ generatedAt: m.generatedAt, query: m.query, picks }, null, 2);
}

function csvField(value) {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(picks) {
  const header = "id,title,year,kind,runtime_min,rating,providers,url,reason";
  const list = Array.isArray(picks) ? picks : [];
  const rows = list.map((pick) => {
    const p = pick || {};
    const providers = Array.isArray(p.p) ? p.p.join("|") : "";
    return [p.id, p.t, p.y, p.k, p.rt, p.r, providers, firstUrl(p.u), p.reason]
      .map(csvField)
      .join(",");
  });
  return `${[header].concat(rows).join("\n")}\n`;
}

export function toYouMd(youmd, history) {
  const base = String(youmd || "")
    .replace(/\n## Recently watched[\s\S]*$/, "")
    .trimEnd();
  if (history == null) return `${base}\n`;
  const series = Array.isArray(history.series) ? history.series : [];
  const movies = Array.isArray(history.movies) ? history.movies : [];
  const lines = series
    .slice(0, MAX_RECENT)
    .map((s) => `- ${s.name} — ${s.episodes} episodes`)
    .concat(movies.slice(0, MAX_RECENT).map((m) => `- ${m.title}`));
  return `${base}\n\n## Recently watched\n${lines.length ? `${lines.join("\n")}\n` : ""}`;
}
