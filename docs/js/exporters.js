// Pure export formatters: data in, string out. providers.js is the one
// import allowed here since it is itself import-free and DOM-free.
import { providerLabel, watchCta } from "./providers.js";
import { renderLearnedContext } from "./preferences.js";

const MAX_RECENT = 25;

function providerLinks(u) {
  if (!u || typeof u !== "object") return "";
  return Object.keys(u)
    .map((slug) => `[${watchCta(slug, u[slug])}](${u[slug]})`)
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
  const m = meta || {};
  const title = typeof m.title === "string" && m.title.trim() ? m.title.trim() : "Watch picks";
  if (!Array.isArray(picks) || picks.length === 0) {
    return `# ${title}\n\nNo results.\n`;
  }
  const details = [];
  if (typeof m.query === "string" && m.query.trim()) details.push(`> Query: ${m.query}`);
  if (typeof m.generatedAt === "string" && m.generatedAt.trim()) details.push(`> Generated: ${m.generatedAt}`);
  const head = `# ${title}${details.length ? `\n\n${details.join("\n")}` : ""}\n`;
  const blocks = picks.map((pick, i) => {
    const p = pick || {};
    const title = p.y == null ? `${p.t}` : `${p.t} (${p.y})`;
    const facts = [p.k];
    if (p.rt != null) facts.push(`${p.rt} min`);
    if (p.r != null) facts.push(`TMDB ${p.r}`);
    const lines = [`## ${i + 1}. ${title}`, `- Kind: ${facts.join(" · ")}`];
    if (typeof p.s === "string" && p.s.trim()) lines.push(`- Description: ${p.s}`);
    if (typeof p.reason === "string" && p.reason.trim()) lines.push(`- Why: ${p.reason}`);
    const links = providerLinks(p.u);
    if (links) lines.push(`- Watch: ${links}`);
    return lines.join("\n");
  });
  return `${head}\n${blocks.join("\n\n")}\n`;
}

export function toJson(picks, meta) {
  const m = meta || {};
  const exported = { generatedAt: m.generatedAt, query: m.query, picks };
  if (typeof m.title === "string" && m.title.trim()) exported.title = m.title.trim();
  if (m.playlist && typeof m.playlist === "object") exported.playlist = m.playlist;
  if (Array.isArray(m.unavailableIds)) exported.unavailableIds = m.unavailableIds;
  return JSON.stringify(exported, null, 2);
}

function csvField(value) {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(picks, meta) {
  const header = "id,title,year,kind,runtime_min,rating,language,genre,providers,url,description,reason";
  const list = Array.isArray(picks) ? picks : [];
  const rows = list.map((pick) => {
    const p = pick || {};
    const providers = Array.isArray(p.p) ? p.p.map(providerLabel).join("|") : "";
    const language = p.l || "";
    const genre = (p.g || []).join("; ");
    return [p.id, p.t, p.y, p.k, p.rt, p.r, language, genre, providers, firstUrl(p.u), p.s, p.reason]
      .map(csvField)
      .join(",");
  });
  return `${[header].concat(rows).join("\n")}\n`;
}

export function toYouMd(youmd, history, learned = null) {
  const base = String(youmd || "")
    .replace(/\n## Recently watched[\s\S]*$/, "")
    .trimEnd();
  const learnedContext = renderLearnedContext(learned);
  if (history == null) return `${base}${learnedContext ? `\n\n${learnedContext}` : ""}\n`;
  const series = Array.isArray(history.series) ? history.series : [];
  const movies = Array.isArray(history.movies) ? history.movies : [];
  const lines = series
    .slice(0, MAX_RECENT)
    .map((s) => `- ${s.name} — ${s.episodes} episodes`)
    .concat(movies.slice(0, MAX_RECENT).map((m) => `- ${m.title}`));
  return `${base}${learnedContext ? `\n\n${learnedContext}` : ""}\n\n## Recently watched\n${lines.length ? `${lines.join("\n")}\n` : ""}`;
}
