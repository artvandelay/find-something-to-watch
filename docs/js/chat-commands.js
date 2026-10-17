// Obvious chat commands handled before any model call.
// A normal watch request returns null so the agent keeps it.

import { PROVIDER_LABELS, PROVIDER_SLUGS, REGION_LABELS, REGIONS } from "./providers.js";

const WATCH_REQUEST = /\b(recommend|recommended|recommendation|recommendations|suggest|suggestion|suggestions|tonight|movie|movies|film|films|show|shows|series|thriller|comedy|horror|drama|romance|something|anything|episode|episodes|season|queue|watchlist|similar)\b/i;

const REGION_COMMAND = /^(?:region:?|my region is|(?:i|we) watch in|(?:set|change|switch|update)(?: my)? region to)\s+(.+)$/i;

const SUBSCRIPTION_COMMAND = /^(?:subscriptions?(?:\s+are)?|my (?:subscriptions|services) are|(?:i|we) (?:subscribe to|pay for|have)|(?:i am|i'm) subscribed to|(?:set|change|update|switch)(?: my)? (?:subscriptions|services) to)\s+(.+)$/i;

const REGION_ALIASES = Object.freeze([
  ["IN", ["in", "india"]],
  ["US", ["us", "usa", "u s", "u s a", "united states", "united states of america"]],
  ["GB", ["gb", "uk", "u k", "united kingdom", "britain", "great britain"]],
  ["CA", ["ca", "canada"]],
  ["AU", ["au", "australia"]],
  ["SG", ["sg", "singapore"]],
  ["AE", ["ae", "uae", "u a e", "united arab emirates"]]
]);

const EXTRA_ALIASES = Object.freeze({
  prime: ["amazon prime", "amazon prime video", "prime video"],
  hotstar: ["hotstar", "jio hotstar", "disney hotstar", "disney plus hotstar"],
  appletv: ["apple tv", "apple tv plus"],
  discovery: ["discovery plus"],
  sonyliv: ["sony liv"],
  zee5: ["zee 5"],
  mxplayer: ["mx player"],
  sunnxt: ["sun nxt"],
  curiosity: ["curiosity stream"],
  shemaroo: ["shemaroo"],
  lionsgate: ["lionsgate"],
  manoramamax: ["manorama max", "manorama"],
  hungama: ["hungama"],
  epicon: ["epic on", "epic"],
  tataplay: ["tata play", "tata"],
  bbcplayer: ["bbc player", "bbc"],
  docubay: ["docu bay"],
  erosnow: ["eros now", "eros"]
});

function commandText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").replace(/[.!?]+$/g, "").trim();
}

function phraseNorm(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function regionCode(value) {
  const token = phraseNorm(String(value || "").replace(/^the\s+/i, ""));
  if (!token || token.split(" ").length > 5) return null;
  for (const [code, aliases] of REGION_ALIASES) {
    if (aliases.includes(token) && REGIONS.includes(code)) return code;
  }
  return null;
}

function providerPhrases() {
  const byPhrase = new Map();
  const add = (slug, phrase) => {
    const key = phraseNorm(phrase);
    if (!key || byPhrase.has(key)) return;
    byPhrase.set(key, slug);
  };
  for (const slug of PROVIDER_SLUGS) {
    add(slug, slug);
    add(slug, PROVIDER_LABELS[slug]);
  }
  for (const [slug, aliases] of Object.entries(EXTRA_ALIASES)) {
    for (const alias of aliases) add(slug, alias);
  }
  return [...byPhrase.entries()]
    .map(([phrase, slug]) => ({ phrase, slug }))
    .sort((left, right) => right.phrase.length - left.phrase.length || left.phrase.localeCompare(right.phrase));
}

const PHRASES = providerPhrases();

function providerList(payload) {
  let rest = phraseNorm(String(payload || "").replace(/^(?:a |my )?(?:subscription|subscriptions) to\s+/i, ""));
  if (!rest) return null;
  const found = [];
  const seen = new Set();
  while (rest) {
    rest = rest.replace(/^(?:and|plus)\s+/, "");
    if (!rest) break;
    const hit = PHRASES.find((item) => rest === item.phrase || rest.startsWith(item.phrase + " "));
    if (!hit) return null;
    if (!seen.has(hit.slug)) {
      seen.add(hit.slug);
      found.push(hit.slug);
    }
    rest = rest.slice(hit.phrase.length).trim();
  }
  return found.length ? found : null;
}

export function parseChatCommand(text) {
  const raw = commandText(text);
  if (!raw || WATCH_REQUEST.test(raw)) return null;

  const region = REGION_COMMAND.exec(raw);
  if (region) {
    const code = regionCode(region[1]);
    if (code) return { kind: "region", region: code };
    return null;
  }

  const subscriptions = SUBSCRIPTION_COMMAND.exec(raw);
  if (subscriptions) {
    const providers = providerList(subscriptions[1]);
    if (providers) return { kind: "subscriptions", providers };
  }
  return null;
}

export function regionCommandReply(code) {
  return `Region set to ${REGION_LABELS[code] || code}.`;
}

export function subscriptionCommandReply(slugs) {
  const labels = (Array.isArray(slugs) ? slugs : []).map((slug) => PROVIDER_LABELS[slug] || slug);
  return `Subscriptions: ${labels.join(", ")}.`;
}
