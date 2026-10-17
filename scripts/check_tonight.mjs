import assert from "node:assert/strict";
import {
  buildDividers,
  buildRecapBlock,
  buildTemporalBlock,
  buildMemoryLine,
  buildWelcome,
  dayPartFor,
  describeGap
} from "../docs/js/tonight.js";

const now = new Date(2026, 9, 14, 21, 42);

assert.deepEqual(
  [4, 5, 11, 12, 16, 17, 21, 22].map(dayPartFor),
  ["night", "morning", "morning", "afternoon", "afternoon", "evening", "evening", "night"]
);

assert.equal(describeGap(null, now).kind, "first");
assert.equal(describeGap(new Date(now.getTime() - 30 * 1000).toISOString(), now).label, "just now");
assert.equal(describeGap(new Date(now.getTime() - 10 * 60000).toISOString(), now).label, "10 minutes ago");
assert.equal(describeGap(new Date(now.getTime() - 3600000).toISOString(), now).label, "1 hour ago");
assert.equal(describeGap(new Date(now.getTime() - 3 * 3600000).toISOString(), now).label, "3 hours ago");
assert.equal(describeGap(new Date(now.getTime() - 25 * 3600000).toISOString(), now).label, "yesterday");
assert.equal(describeGap(new Date(now.getTime() - 3 * 86400000).toISOString(), now).label, "3 days ago");

const temporal = buildTemporalBlock({
  now,
  lastActivityIso: new Date(now.getTime() - 3 * 3600000).toISOString()
});
assert.equal(temporal, [
  "## Right now",
  "- Local time: Wednesday 14 Oct, 9:42 pm (evening).",
  "- Weekend: no.",
  "- Last chat with this viewer: 3 hours ago."
].join("\n"));
assert.match(buildTemporalBlock({ now, lastActivityIso: null }), /none \(first visit\)/);

const yesterdayEvening = new Date(2026, 9, 13, 20, 0).toISOString();
const earlier = new Date(2026, 9, 13, 10, 0).toISOString();
const dividers = buildDividers([
  { createdAt: earlier },
  { createdAt: yesterdayEvening }
], now);
assert.equal(dividers[1], "Yesterday, evening");
assert.equal(buildDividers([
  { createdAt: now.toISOString() },
  { createdAt: new Date(now.getTime() + 3600000).toISOString() }
], now)[1], null);

const turns = [];
for (let i = 0; i < 15; i += 1) {
  const user = i === 2
    ? "slow Korean dramas"
    : "something else " + i;
  turns.push({
    user: { content: user, createdAt: new Date(2026, 9, 1 + (i % 28), 12, 0).toISOString() },
    assistant: { picks: i === 2 ? [{ id: "tmdb:reply" }] : [{ id: "tmdb:" + i }] }
  });
}
const recap = buildRecapBlock({
  turns,
  query: "any Korean drama like Reply 1988",
  resolveTitle: (id) => (id === "tmdb:reply" ? "Reply 1988" : id),
  maxItems: 4
});
assert.match(recap, /^## Earlier in this chat/);
assert.match(recap, /slow Korean dramas/);
assert.match(recap, /Reply 1988/);
const koreanAt = recap.indexOf("slow Korean dramas");
const laterAt = recap.indexOf("something else 14");
assert.ok(koreanAt > 0 && laterAt > koreanAt);
assert.equal(buildRecapBlock({ turns: [] }), "");
assert.ok(buildRecapBlock({
  turns: Array.from({ length: 30 }, (_, i) => ({
    user: { content: "x".repeat(80) + " turn " + i, createdAt: "2026-10-01T00:00:00.000Z" },
    assistant: { picks: [{ id: "tmdb:" + i }] }
  })),
  maxItems: 8
}).length <= 1800);

const first = buildWelcome({ now, lastActivityIso: null, hasMessages: false, dailyFree: null });
assert.equal(first.sub, "");
assert.equal(first.headline, "Evening. What are we watching?");
assert.ok(first.chips.some((chip) => chip.label === "A movie for tonight"));

const back = buildWelcome({
  now,
  lastActivityIso: new Date(now.getTime() - 3 * 3600000).toISOString(),
  lastPickTitle: "Dune",
  hasMessages: true,
  dailyFree: { t: "Radiolab" }
});
assert.equal(back.sub, "Last chat: 3 hours ago. We landed on \u201cDune\u201d.");
assert.equal(back.chips.length, 4);
assert.equal(back.chips[1].label, "More like Dune");
assert.equal(back.chips[2].label, "Free today: Radiolab");

const long = buildWelcome({
  now,
  lastActivityIso: null,
  hasMessages: false,
  dailyFree: { t: "A Very Long Free Title That Will Not Fit" }
});
assert.ok(long.chips.some((chip) => chip.label.endsWith("\u2026") && chip.label.length === 32));
assert.equal(long.memoryLine, null);
assert.equal(buildMemoryLine({}), null);
assert.equal(buildMemoryLine({ facts: [], seenCount: 0, blockedCount: 0 }), null);
assert.equal(
  buildMemoryLine({
    facts: [
      { kind: "theme", polarity: "like", value: "slow thrillers" },
      { kind: "content", polarity: "avoid", value: "gore" },
      { kind: "habit", polarity: "like", value: "watch late on weekdays" }
    ],
    seenCount: 212,
    blockedCount: 0
  }),
  "I remember: you like slow thrillers, you avoid gore, you watch late on weekdays, and 212 titles are marked seen."
);
assert.equal(buildMemoryLine({ seenCount: 1 }), "I remember: 1 title is marked seen.");
assert.equal(
  buildMemoryLine({ blockedCount: 2 }),
  "I remember: 2 titles are hidden."
);
const remembered = buildWelcome({
  now,
  lastActivityIso: null,
  hasMessages: false,
  memoryLine: "I remember: you like slow thrillers."
});
assert.equal(remembered.memoryLine, "I remember: you like slow thrillers.");
assert.equal(buildTemporalBlock({ now, lastActivityIso: null, region: "us" }).includes("- Region: US."), true);

console.log("check_tonight: ok");
