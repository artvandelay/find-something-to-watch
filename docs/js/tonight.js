// Clock, welcome, and keyword recall. DOM-free and import-free.

export const SESSION_GAP_MS = 21600000;
export const WELCOME_GAP_MS = 1800000;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STOPWORDS = new Set(
  "the and for with that this what some something about from have tonight watch show movie film like want good not are you can please any give need into over under more less one get has its but was were too very just only".split(" ")
);

function asDate(now) {
  return now instanceof Date ? now : new Date(now);
}

function localMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dayPartFor(hour) {
  if (hour >= 5 && hour <= 11) return "morning";
  if (hour >= 12 && hour <= 16) return "afternoon";
  if (hour >= 17 && hour <= 21) return "evening";
  return "night";
}

export function describeGap(lastIso, now) {
  const parsed = Date.parse(lastIso);
  if (!Number.isFinite(parsed)) return { kind: "first", label: "first visit" };
  const ms = asDate(now).getTime() - parsed;
  if (ms < 2 * 60000) return { kind: "minutes", label: "just now" };
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return { kind: "minutes", label: minutes + " minutes ago" };
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return { kind: "hours", label: hours === 1 ? "1 hour ago" : hours + " hours ago" };
  const days = Math.floor(hours / 24);
  if (days === 1) return { kind: "days", label: "yesterday" };
  return { kind: "days", label: days + " days ago" };
}

function clockParts(now) {
  const date = asDate(now);
  const hour = date.getHours();
  const h12 = hour % 12 || 12;
  const time = h12 + ":" + String(date.getMinutes()).padStart(2, "0") + (hour < 12 ? " am" : " pm");
  return {
    hour,
    dayPart: dayPartFor(hour),
    weekend: date.getDay() === 0 || date.getDay() === 6,
    line: "- Local time: " + WEEKDAYS[date.getDay()] + " " + date.getDate() + " " + MONTHS[date.getMonth()] + ", " + time + " (" + dayPartFor(hour) + ")."
  };
}

export function buildTemporalBlock({ now, lastActivityIso, region } = {}) {
  const clock = clockParts(now);
  const gap = describeGap(lastActivityIso, now);
  const last = gap.kind === "first"
    ? "- Last chat with this viewer: none (first visit)."
    : "- Last chat with this viewer: " + gap.label + ".";
  const lines = ["## Right now", clock.line, "- Weekend: " + (clock.weekend ? "yes." : "no."), last];
  if (typeof region === "string" && /^[A-Za-z]{2}$/.test(region.trim())) {
    lines.push("- Region: " + region.trim().toUpperCase() + ".");
  }
  return lines.join("\n");
}

function joinClauses(clauses) {
  if (clauses.length === 1) return clauses[0];
  if (clauses.length === 2) return clauses[0] + " and " + clauses[1];
  return clauses.slice(0, -1).join(", ") + ", and " + clauses.at(-1);
}

export function buildMemoryLine({ facts, seenCount, blockedCount } = {}) {
  const list = Array.isArray(facts) ? facts : [];
  const clauses = [];
  const likes = list.filter((item) => item && item.polarity === "like" && item.kind !== "habit" && item.value).slice(0, 2);
  const avoids = list.filter((item) => item && item.polarity === "avoid" && item.kind !== "habit" && item.value).slice(0, 1);
  const habits = list.filter((item) => item && item.kind === "habit" && item.value).slice(0, 1);
  for (const item of likes) clauses.push("you like " + String(item.value).trim());
  for (const item of avoids) clauses.push("you avoid " + String(item.value).trim());
  for (const item of habits) {
    const value = String(item.value).trim();
    clauses.push(/^you\b/i.test(value) ? value : "you " + value);
  }
  const seen = Number.isFinite(seenCount) ? Math.max(0, Math.floor(seenCount)) : 0;
  const blocked = Number.isFinite(blockedCount) ? Math.max(0, Math.floor(blockedCount)) : 0;
  if (seen > 0) clauses.push(seen === 1 ? "1 title is marked seen" : seen + " titles are marked seen");
  if (blocked > 0) clauses.push(blocked === 1 ? "1 title is hidden" : blocked + " titles are hidden");
  if (clauses.length === 0) return null;
  return "I remember: " + joinClauses(clauses) + ".";
}

function dividerLabel(iso, now) {
  const next = new Date(iso);
  if (Number.isNaN(next.getTime())) return null;
  const days = Math.round((localMidnight(asDate(now)) - localMidnight(next)) / 86400000);
  const part = dayPartFor(next.getHours());
  const weekday = WEEKDAYS[next.getDay()];
  if (days <= 0) return "Today, " + part;
  if (days === 1) return "Yesterday, " + part;
  if (days <= 6) return weekday + ", " + part;
  return weekday + " " + next.getDate() + " " + MONTHS[next.getMonth()] + ", " + part;
}

export function buildDividers(messages, now) {
  const list = Array.isArray(messages) ? messages : [];
  return list.map((message, index) => {
    const nextMs = Date.parse(message?.createdAt);
    if (!Number.isFinite(nextMs)) return null;
    if (index > 0) {
      const prevMs = Date.parse(list[index - 1]?.createdAt);
      if (Number.isFinite(prevMs) && nextMs - prevMs < SESSION_GAP_MS) return null;
    }
    return dividerLabel(message.createdAt, now);
  });
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function shortText(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildRecapBlock({ turns, query = "", resolveTitle = null, maxItems = 8 } = {}) {
  const prepared = [];
  for (const turn of Array.isArray(turns) ? turns : []) {
    const userText = shortText(turn?.user?.content, 100);
    if (!userText) continue;
    const picks = Array.isArray(turn?.assistant?.picks) ? turn.assistant.picks.slice(0, 3) : [];
    const titles = picks.map((pick) => {
      const id = typeof pick?.id === "string" ? pick.id : "";
      if (!id) return "";
      const title = typeof resolveTitle === "function" ? (resolveTitle(id) || id) : id;
      return title;
    }).filter(Boolean);
    prepared.push({
      user: turn.user,
      userText,
      picksText: titles.join(", ")
    });
  }
  if (prepared.length === 0) return "";
  const queryTokens = [...new Set(tokenize(query))];
  const scored = prepared.map((turn, index) => {
    const hay = new Set(tokenize(turn.userText + " " + turn.picksText));
    let score = 0;
    for (const token of queryTokens) if (hay.has(token)) score += 1;
    return { turn, index, score };
  });
  const keyword = scored
    .filter((item) => item.score >= 1)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 4);
  const chosen = new Set(keyword.map((item) => item.index));
  const recent = scored.filter((item) => !chosen.has(item.index)).sort((a, b) => b.index - a.index);
  const selected = keyword.concat(recent).slice(0, maxItems).sort((a, b) => a.index - b.index);
  const lines = ["## Earlier in this chat"];
  for (const item of selected) {
    const created = Date.parse(item.turn.user?.createdAt);
    const prefix = Number.isFinite(created)
      ? new Date(created).getDate() + " " + MONTHS[new Date(created).getMonth()] + ": "
      : "";
    let line = "- " + prefix + "\"" + item.turn.userText + "\"";
    if (item.turn.picksText) line += " -> " + item.turn.picksText;
    lines.push(line);
  }
  const text = lines.join("\n");
  return text.length > 1800 ? text.slice(0, 1800) : text;
}

function chipLabel(label) {
  return label.length > 32 ? label.slice(0, 31) + "…" : label;
}

function dayPartChip(dayPart) {
  if (dayPart === "morning") {
    return { label: "A podcast for my commute", query: "A free podcast, around 30 minutes, for my commute" };
  }
  if (dayPart === "afternoon") {
    return { label: "Something short for a break", query: "Something short I can finish in under an hour" };
  }
  if (dayPart === "evening") {
    return { label: "A movie for tonight", query: "A movie for tonight, under two hours" };
  }
  return { label: "Something light, under 90 minutes", query: "Something light and easy, under 90 minutes" };
}

export function buildWelcome({ now, lastActivityIso, lastPickTitle, hasMessages, dailyFree, memoryLine } = {}) {
  const clock = clockParts(now);
  const gap = describeGap(lastActivityIso, now);
  const headlines = {
    morning: "Morning. Something for now, or for later?",
    afternoon: "Afternoon. Planning tonight early?",
    evening: "Evening. What are we watching?",
    night: "Late one. Something easy?"
  };
  const title = typeof lastPickTitle === "string" ? lastPickTitle.trim() : "";
  let sub = "";
  if (hasMessages && gap.kind !== "first") {
    sub = "Last chat: " + gap.label + ".";
    if (title) sub += " We landed on \u201c" + title + "\u201d.";
  }
  const chips = [dayPartChip(clock.dayPart)];
  if (title) {
    chips.push({
      label: "More like " + title,
      query: "More like \u201c" + title + "\u201d, but something I have not seen"
    });
  }
  if (dailyFree && typeof dailyFree.t === "string" && dailyFree.t.trim()) {
    chips.push({
      label: "Free today: " + dailyFree.t.trim(),
      query: "Tell me about \u201c" + dailyFree.t.trim() + "\u201d. It is free. Is it worth my time tonight?"
    });
  }
  chips.push({
    label: "Free, outside my services",
    query: "Something free to watch or listen to tonight, not on my subscriptions"
  });
  chips.push(clock.weekend
    ? { label: "A long film for the weekend", query: "A long, absorbing film for the weekend" }
    : { label: "Surprise me, nothing I have seen", query: "Surprise me with something I have not seen" });
  const remembered = typeof memoryLine === "string" ? memoryLine.trim() : "";
  return {
    headline: headlines[clock.dayPart],
    sub,
    memoryLine: remembered || null,
    chips: chips.slice(0, 4).map((chip) => ({ label: chipLabel(chip.label), query: chip.query }))
  };
}
