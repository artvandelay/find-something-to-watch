import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bootApp, createStorage, defaultRecords } from "./harness/app.mjs";
import { createBrowserMemory } from "../docs/js/memory.js";
import { parseChatCommand } from "../docs/js/chat-commands.js";
import { historyImportReply, parseWatchHistoryExport, summarize } from "../docs/js/history.js";
import { DEFAULT_LLM, KEYS } from "../docs/js/store.js";

const freeDoc = JSON.parse(await readFile(
  new URL("../data/fixtures/free-sources.fixture.json", import.meta.url),
  "utf8"
));

function agentResult(extra = {}) {
  return {
    ok: true,
    reply: "Fixture reply.",
    queue: [{ id: "tmdb:m1", reason: "A tight comedy" }],
    memoryCandidates: [],
    watched: [],
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, requestCount: 1 },
    billing: { basis: "provider_reported", amountUsd: 0, complete: true, requestCount: 1, pricedRequestCount: 1 },
    timing: { totalMs: 50, firstTokenMs: 10 },
    ...extra
  };
}

async function ready(app) {
  await app.click("#settings-btn");
  app.$("#settings-provider-list input[value=netflix]").click();
  app.$("#llm-api-key").value = "sk-test";
  await app.click("#settings-save");
  await app.settle();
}

async function send(app, query) {
  app.$("#query-input").value = query;
  await app.click("#send-btn");
  await app.settle();
}

const dark = {
  id: "tmdb:dark",
  t: "Dark Matter",
  y: 2024,
  k: "movie",
  rt: 90,
  s: "A title the viewer already finished.",
  im: null,
  r: 7,
  p: ["netflix"],
  u: { netflix: "https://example.test/netflix/tmdb:dark" },
  img: null,
  l: "en",
  g: ["Drama"],
  v: 1
};

// H1 + H5
{
  const storage = createStorage();
  const queries = [];
  const app = await bootApp({
    storage,
    freeDoc,
    agentFixture: async (opts) => {
      queries.push(opts.query);
      return agentResult({
        reply: "Radiolab is free, and Sharp Comedy is on Netflix.",
        queue: [
          { id: "free:p:radiolab", reason: "A free listen" },
          { id: "tmdb:m1", reason: "A film on Netflix" }
        ]
      });
    }
  });
  try {
    await ready(app);
    assert.ok(app.$(".chat-welcome-headline"), "H1 welcome headline");
    const chip = app.$(".chat-chip");
    const chipQuery = chip.dataset.query;
    chip.click();
    await app.settle();
    assert.equal(queries[0], chipQuery, "H1 chip submits its query");
    assert.ok(app.$(".chat-picks .card"), "H1 inline cards");
    const link = app.$(".chat-picks a");
    assert.match(link?.getAttribute("href") || "", /^https:\/\//, "H1 card link");
    assert.equal(app.$(".chat-picks .badge-free")?.textContent, "Free");

    app.$(".chat-picks .card-feedback-btn[data-feedback=blocked]").click();
    await app.settle();
    assert.equal(
      app.$$(".chat-picks .card-title").some((node) => /Radiolab/.test(node.textContent || "")),
      false,
      "H5 card leaves the transcript"
    );
    const memory = createBrowserMemory({ indexedDB: storage.indexedDB, now: () => new Date() });
    await memory.initialize();
    assert.ok((await memory.getHistory()).blocked.includes("radiolab"), "H5 writes history.blocked");
  } finally {
    app.restore();
  }

  const reloaded = await bootApp({ storage, freeDoc, agentFixture: async () => agentResult() });
  try {
    assert.equal(
      reloaded.$$(".card-title").some((node) => /Radiolab/.test(node.textContent || "")),
      false,
      "H5 card stays gone after reload"
    );
  } finally {
    reloaded.restore();
  }
}

// H3
{
  const storage = createStorage();
  const calls = [];
  const app = await bootApp({
    storage,
    records: defaultRecords().concat(dark),
    freeDoc,
    agentFixture: async (opts) => {
      calls.push(opts);
      if (/weeknights under 90 minutes/i.test(opts.query)) {
        return agentResult({
          reply: "Weeknights stay under 90 minutes. I will not suggest Dark Matter.",
          queue: [
            { id: "tmdb:dark", reason: "You mentioned it" },
            { id: "tmdb:m1", reason: "A shorter comedy" }
          ],
          memoryCandidates: [{
            kind: "habit",
            polarity: "like",
            value: "weeknights under 90 minutes",
            explicit: true,
            durable: true,
            evidence: "weeknights under 90 minutes"
          }],
          watched: ["Dark Matter"]
        });
      }
      return agentResult({ reply: "Something in the same vein as last time." });
    }
  });
  try {
    await ready(app);
    await send(app, "I only watch on weeknights under 90 minutes, and I watched Dark Matter last week");
    assert.equal(
      app.$$(".card-title").some((node) => /Dark Matter/.test(node.textContent || "")),
      false,
      "H3 watched title is not recommended"
    );
    await app.click("#context-btn");
    assert.ok(app.text("#learned-facts").includes("weeknights under 90 minutes"), "H3 habit is visible: " + app.text("#learned-facts"));
    app.$("#context-close").click();
    await app.settle();
    const memory = createBrowserMemory({ indexedDB: storage.indexedDB, now: () => new Date() });
    await memory.initialize();
    assert.ok((await memory.getHistory()).seen.includes("dark matter"), "H3 marks Dark Matter seen");

    await app.click("#new-chat-btn");
    await send(app, "something like what we talked about");
    assert.match(calls.at(-1).context.temporal || "", /^## Right now/, "H3 clock reaches the model");
    assert.match(calls.at(-1).context.recap || "", /## Earlier in this chat/, "H3 recap reaches the model");
    assert.match(calls.at(-1).context.recap || "", /weeknights under 90 minutes/, "H3 recap includes the earlier turn");
  } finally {
    app.restore();
  }
}

// H4
{
  const storage = createStorage();
  const start = new Date(2026, 9, 14, 21, 42).getTime();
  const first = await bootApp({
    storage,
    now: start,
    agentFixture: async () => agentResult({
      reply: "Sharp Comedy fits tonight.",
      queue: [{ id: "tmdb:m1", reason: "Under two hours" }]
    })
  });
  try {
    await ready(first);
    await send(first, "a movie for tonight");
    assert.ok(first.$(".chat-picks .card"), "H4 cards before reload");
  } finally {
    first.restore();
  }
  const later = await bootApp({
    storage,
    now: start + 7 * 60 * 60 * 1000,
    agentFixture: async () => agentResult()
  });
  try {
    assert.match(later.text(".chat-divider") || "", /Yesterday, evening/, "H4 divider");
    assert.match(later.$(".chat-welcome-sub")?.textContent || "", /Last chat: 7 hours ago/, "H4 return welcome");
    assert.ok(later.$(".chat-picks .card"), "H4 cards survive reload");
  } finally {
    later.restore();
  }
}

// H6
{
  const app = await bootApp();
  try {
    assert.equal(app.$("#error-banner").hidden, true, "H6 no error banner");
    assert.ok(app.$(".chat-welcome"), "H6 welcome without free data");
  } finally {
    app.restore();
  }
}

const youtubeFixture = await readFile(
  new URL("../data/fixtures/youtube-watch-history.fixture.json", import.meta.url),
  "utf8"
);

// H7
{
  const storage = createStorage();
  const memory = createBrowserMemory({ indexedDB: storage.indexedDB, now: () => new Date("2026-10-15T00:00:00.000Z") });
  await memory.initialize();
  await memory.setLearned({
    items: [{ kind: "theme", polarity: "like", value: "slow thrillers" }]
  });
  await memory.setHistory({
    seen: ["sharp comedy"],
    blocked: [],
    marks: [{
      key: "sharp comedy",
      title: "Sharp Comedy",
      bucket: "seen",
      source: "button",
      at: "2026-10-15T00:00:00.000Z"
    }]
  });
  const app = await bootApp({ storage, freeDoc });
  try {
    await ready(app);
    assert.match(app.$(".chat-welcome-memory")?.textContent || "", /slow thrillers/, "H7 memory line");
    assert.match(app.$(".chat-welcome-memory")?.textContent || "", /marked seen/, "H7 seen count");
    assert.equal(
      app.$$(".card-title").some((node) => /Sharp Comedy/.test(node.textContent || "")),
      false,
      "H7 seen title starts out of the queue"
    );
    await app.click(".chat-welcome-memory-link");
    assert.equal(app.$("#memory-dialog").hasAttribute("open"), true, "H7 See all opens the panel");
    assert.match(app.$("#memory-marks")?.textContent || "", /Sharp Comedy/, "H7 panel lists the mark");
    const remove = [...app.$$("#memory-marks button")].find((node) => node.textContent === "Remove");
    remove.click();
    await app.settle();
    assert.equal(
      app.$$(".card-title").some((node) => /Sharp Comedy/.test(node.textContent || "")),
      true,
      "H7 removed mark is a candidate again"
    );
  } finally {
    app.restore();
  }
}

// H8
{
  const storage = createStorage();
  const regional = JSON.parse(JSON.stringify(freeDoc));
  regional.records.push({
    id: "free:m:a-star-is-born",
    t: "A Star is Born",
    y: 1937,
    k: "movie",
    rt: null,
    s: "A free film on YouTube.",
    im: null,
    r: null,
    p: ["free_youtube"],
    u: { free_youtube: "https://www.youtube.com/watch?v=HKjR70GCRPE" },
    img: null,
    l: "en",
    g: ["Comedy & Dramas"],
    v: 0
  });
  const youtubePlan = {
    schema: 1,
    files: [{
      name: "watch-history.json",
      format: "json",
      recordsPath: [],
      titlePath: ["title"],
      datePath: ["time"],
      typePath: null,
      seriesPath: null,
      episodePath: null,
      titlePrefix: "Watched ",
      dateFormat: "iso",
      typeMap: { movie: [], series: [] }
    }]
  };
  const app = await bootApp({
    storage,
    freeDoc: regional,
    historyPlanFixture: async () => youtubePlan
  });
  try {
    await ready(app);
    assert.equal(app.$("#history-file"), null, "H8 profile has no file input");
    const parsedYoutube = await parseWatchHistoryExport(
      { name: "watch-history.json", text: youtubeFixture },
      { inferPlan: async () => youtubePlan }
    );
    await app.setFile("#chat-file", {
      name: "watch-history.json",
      content: youtubeFixture,
      type: "application/json"
    });
    await app.settle();
    assert.equal(app.$(".chat-msg-user .chat-bubble")?.textContent, "watch-history.json", "H8 user message is the filename");
    assert.equal(
      app.$(".chat-msg-assistant .chat-bubble")?.textContent,
      historyImportReply("watch-history.json", parsedYoutube),
      "H8 assistant reply states the counts"
    );
    await app.click("#context-btn");
    assert.equal(app.$("#history-summary")?.textContent, summarize(parsedYoutube), "H8 profile shows the imported counts");
    assert.equal(
      app.$$(".card-title").some((node) => (node.textContent || "").trim() === "A Star is Born"),
      false,
      "H8 imported film stays out of the queue"
    );
    assert.equal(
      app.$$(".chat-chip").some((node) => /Free today/.test(node.textContent || "") && /A Star is Born/.test(node.textContent || "")),
      false,
      "H8 imported film is not tonight's free pick"
    );
    const memory = createBrowserMemory({ indexedDB: storage.indexedDB, now: () => new Date() });
    await memory.initialize();
    assert.ok((await memory.getHistory()).seen.includes("a star is born"), "H8 marks the film seen");
  } finally {
    app.restore();
  }
}

// H9
{
  const storage = createStorage();
  const regional = JSON.parse(JSON.stringify(freeDoc));
  regional.records.push({
    id: "free:m:india-only",
    t: "India Only Film",
    y: 1940,
    k: "movie",
    rt: null,
    s: "Playable in India.",
    im: null,
    r: null,
    p: ["free_youtube"],
    u: { free_youtube: { url: "https://www.youtube.com/watch?v=indiaOnly", regions: ["IN"] } },
    img: null,
    l: "en",
    g: ["Drama"],
    v: 0
  });
  const app = await bootApp({ storage, freeDoc: regional });
  try {
    await ready(app);
    assert.ok(
      app.$$(".card-title").some((node) => /India Only Film/.test(node.textContent || "")),
      "H9 India-only film is visible in IN"
    );
    assert.match(app.$("a[href*='podcasts.apple.com']")?.getAttribute("href") || "", /\/in\//, "H9 Apple link starts in India");
    await app.click("#settings-btn");
    app.$("#region-select").value = "US";
    await app.click("#settings-save");
    assert.equal(app.$("#shell").hidden, false, "H9 region switch does not reload");
    assert.equal(
      app.$$(".card-title").some((node) => /India Only Film/.test(node.textContent || "")),
      false,
      "H9 US hides the India-only YouTube link"
    );
    assert.match(app.$("a[href*='podcasts.apple.com']")?.getAttribute("href") || "", /\/us\//, "H9 Apple link uses the US store");
  } finally {
    app.restore();
  }
}

// H10
{
  const storage = createStorage();
  storage.local.set(KEYS.llm, JSON.stringify({ ...DEFAULT_LLM, apiKey: "sk-keep" }));
  const memory = createBrowserMemory({ indexedDB: storage.indexedDB, now: () => new Date("2026-10-15T00:00:00.000Z") });
  await memory.initialize();
  await memory.setProfile({ providers: ["netflix"], region: "US", onboardingComplete: true });
  await memory.setLearned({ items: [{ kind: "theme", polarity: "like", value: "slow thrillers" }] });
  await memory.setHistory({
    schema: 2,
    sources: [{ name: "watch-history.json", kind: "youtube", records: 7 }],
    series: [],
    movies: [],
    other: [{ title: "A Star is Born", lastWatched: null }],
    seen: ["a star is born"],
    blocked: ["radiolab"]
  });
  await memory.setConversation({
    messages: [{ role: "user", content: "something slow", createdAt: "2026-10-14T00:00:00.000Z" }]
  });
  const app = await bootApp({
    storage,
    prepare(window) { window.confirm = () => true; }
  });
  try {
    await app.click("#settings-btn");
    assert.equal(app.$("#region-select").value, "US", "H10 settings show the saved region");
    assert.equal(app.$("#llm-api-key").value, "sk-keep", "H10 key is present before reset");
    app.$("#settings-close").click();
    await app.settle();
    await app.click("#reset-keep-key-btn");
  } finally {
    app.restore();
  }
  const restarted = await bootApp({ storage, prepare(window) { window.confirm = () => true; } });
  try {
    assert.equal(restarted.$("#onboarding-screen").hidden, false, "H10 start over opens onboarding");
    assert.equal(restarted.$("#onboarding-llm-api-key").value, "sk-keep", "H10 key is still filled in");
    assert.equal(restarted.$("#onboarding-region-select").value, "IN", "H10 region returns to India");
    restarted.$("#onboarding-provider-list input[value=netflix]").click();
    await restarted.click("#onboarding-next");
    await restarted.click("#onboarding-next");
    await restarted.click(".chat-welcome-memory-link");
    assert.match(restarted.$("#memory-facts")?.textContent || "", /No learned preferences yet/, "H10 learned facts are empty");
    assert.match(restarted.$("#memory-marks")?.textContent || "", /Nothing marked in chat yet/, "H10 marks are empty");
    assert.equal(restarted.$("#memory-imports").textContent, "No imported history.", "H10 imported history is empty");
    restarted.$("#memory-close").click();
    await restarted.click("#clear-data-btn");
  } finally {
    restarted.restore();
  }
  const cleared = await bootApp({ storage });
  try {
    assert.equal(cleared.$("#onboarding-screen").hidden, true, "H10 clear everything leaves the shell");
    await cleared.click("#settings-btn");
    assert.equal(cleared.$("#llm-api-key").value, "", "H10 clear everything removes the key");
  } finally {
    cleared.restore();
  }

  const resetStorage = createStorage();
  resetStorage.local.set(KEYS.llm, JSON.stringify({ ...DEFAULT_LLM, apiKey: "sk-reset" }));
  const seeded = createBrowserMemory({ indexedDB: resetStorage.indexedDB, now: () => new Date() });
  await seeded.initialize();
  await seeded.setProfile({ providers: ["netflix"], region: "US", onboardingComplete: true });
  await seeded.setHistory({ seen: ["sharp comedy"], sources: [{ name: "ViewingActivity.csv", kind: "netflix", records: 4 }] });
  const resetting = await bootApp({
    storage: resetStorage,
    url: "http://localhost/?reset",
    prepare(window) { window.confirm = () => true; }
  });
  resetting.restore();
  const afterReset = await bootApp({ storage: resetStorage });
  try {
    assert.equal(afterReset.$("#onboarding-screen").hidden, false, "H10 ?reset opens onboarding");
    assert.equal(afterReset.$("#onboarding-llm-api-key").value, "sk-reset", "H10 ?reset keeps the key");
    assert.equal(afterReset.$("#onboarding-region-select").value, "IN", "H10 ?reset restores region IN");
    const remembered = createBrowserMemory({ indexedDB: resetStorage.indexedDB, now: () => new Date() });
    await remembered.initialize();
    assert.equal(await remembered.getHistory(), null, "H10 ?reset clears history");
  } finally {
    afterReset.restore();
  }
}

// H11 chat file import: success saves history; a broken file replies with the error.
{
  const storage = createStorage();
  const netflixCsv = await readFile(new URL("../data/fixtures/netflix_history_sample.csv", import.meta.url), "utf8");
  function netflixPlan(name) {
    return {
      schema: 1,
      files: [{
        name,
        format: "csv",
        headerRow: 0,
        dataStartRow: 1,
        titleColumn: 0,
        dateColumn: 1,
        typeColumn: null,
        seriesColumn: null,
        episodeColumn: null,
        dateFormat: "mdy",
        typeMap: { movie: [], series: [] }
      }]
    };
  }
  const app = await bootApp({
    storage,
    freeDoc,
    historyPlanFixture: async (input) => {
      const name = input?.files?.[0]?.name;
      if (name === "odd.csv") return { schema: 1, files: [] };
      if (name === "empty-plan.csv") return {};
      return netflixPlan(name);
    }
  });
  try {
    await ready(app);
    const parsed = await parseWatchHistoryExport(
      { name: "NetflixViewingHistory.csv", text: netflixCsv },
      { inferPlan: async () => netflixPlan("NetflixViewingHistory.csv") }
    );
    assert.ok(parsed.seen.length > 0, "H11 fixture has titles");
    await app.setFile("#chat-file", {
      name: "NetflixViewingHistory.csv",
      content: netflixCsv,
      type: "text/csv"
    });
    await app.settle();
    const reply = historyImportReply("NetflixViewingHistory.csv", parsed);
    assert.equal(app.$(".chat-msg-user .chat-bubble")?.textContent, "NetflixViewingHistory.csv", "H11 filename is the user message");
    assert.equal(app.$(".chat-msg-assistant .chat-bubble")?.textContent, reply, "H11 success reply uses the parsed counts");
    const memory = createBrowserMemory({ indexedDB: storage.indexedDB, now: () => new Date() });
    await memory.initialize();
    const saved = await memory.getHistory();
    assert.deepEqual(saved.seen, parsed.seen, "H11 saves the seen titles");
    assert.equal(saved.series.length, parsed.series.length, "H11 saves series");
    assert.equal(saved.movies.length, parsed.movies.length, "H11 saves movies");

    const before = JSON.stringify(saved);
    await app.setFile("#chat-file", {
      name: "broken.csv",
      content: "Title,Date\n\"unterminated",
      type: "text/csv"
    });
    await app.settle();
    const assistants = app.$$(".chat-msg-assistant .chat-bubble").map((node) => node.textContent);
    assert.match(assistants.at(-1) || "", /unterminated quoted field/, "H11 broken CSV error is the chat reply");
    assert.equal(JSON.stringify(await memory.getHistory()), before, "H11 broken CSV does not replace history");

    await app.setFile("#chat-file", {
      name: "odd.csv",
      content: "Title,Date\nOdd Film,1/2/26\n",
      type: "text/csv"
    });
    await app.settle();
    const oddReply = app.$$(".chat-msg-assistant .chat-bubble").map((node) => node.textContent);
    assert.match(oddReply.at(-1) || "", /invalid top-level shape/, "H11 an empty plan is the chat reply");
    assert.equal(JSON.stringify(await memory.getHistory()), before, "H11 an empty plan does not replace history");

    await app.setFile("#chat-file", {
      name: "empty-plan.csv",
      content: "Title,Date\nAnother Film,1/3/26\n",
      type: "text/csv"
    });
    await app.settle();
    const emptyPlanReply = app.$$(".chat-msg-assistant .chat-bubble").map((node) => node.textContent);
    assert.match(emptyPlanReply.at(-1) || "", /invalid top-level shape/, "H11 a broken plan is the chat reply");
    assert.equal(JSON.stringify(await memory.getHistory()), before, "H11 a broken plan does not replace history");

    await app.setFile("#chat-file", {
      name: "empty.csv",
      content: "Title,Date\n",
      type: "text/csv"
    });
    await app.settle();
    const afterEmpty = app.$$(".chat-msg-assistant .chat-bubble").map((node) => node.textContent);
    assert.match(afterEmpty.at(-1) || "", /no readable titles/, "H11 a file with no titles is a failure reply");
    assert.equal(JSON.stringify(await memory.getHistory()), before, "H11 an empty export does not replace history");
    assert.equal(app.$("#context-feedback")?.hidden, true, "H11 the error is not only the profile alert");
  } finally {
    app.restore();
  }
}

// Local commands stay out of the model. A watch request does not.
{
  assert.equal(parseChatCommand("region US")?.region, "US");
  assert.equal(parseChatCommand("I watch in India")?.region, "IN");
  assert.deepEqual(parseChatCommand("I subscribe to Netflix and Prime Video")?.providers, ["netflix", "prime"]);
  assert.equal(parseChatCommand("recommend a Prime Video thriller"), null);
  assert.equal(parseChatCommand("something on Netflix tonight"), null);
  assert.equal(parseChatCommand("I watch in India tonight"), null);

  const storage = createStorage();
  const queries = [];
  const app = await bootApp({
    storage,
    freeDoc,
    agentFixture: async (opts) => {
      queries.push(opts.query);
      return agentResult();
    }
  });
  try {
    await ready(app);
    await send(app, "region US");
    await app.settle();
    assert.equal(queries.length, 0, "H12 region does not call the model");
    assert.match(app.$(".chat-msg-assistant .chat-bubble")?.textContent || "", /United States/, "H12 replies with the region");
    await app.click("#settings-btn");
    assert.equal(app.$("#region-select").value, "US", "H12 settings show the chat region");
    app.$("#settings-close").click();
    await app.settle();

    await send(app, "I want a thriller tonight");
    await app.settle();
    assert.equal(queries.at(-1), "I want a thriller tonight", "H12 a watch request still reaches the agent");

    await send(app, "I subscribe to Netflix and Prime Video");
    await app.settle();
    assert.equal(queries.length, 1, "H12 subscriptions do not call the model");
    assert.match(app.$$(".chat-msg-assistant .chat-bubble").at(-1)?.textContent || "", /Netflix, Prime Video/, "H12 replies with the services");
    await app.click("#settings-btn");
    assert.equal(app.$("#settings-provider-list input[value=netflix]").checked, true, "H12 Netflix stays selected");
    assert.equal(app.$("#settings-provider-list input[value=prime]").checked, true, "H12 Prime is selected");
    const hotstar = app.$("#settings-provider-list input[value=hotstar]");
    assert.equal(Boolean(hotstar && hotstar.checked), false, "H12 unnamed services stay off");
  } finally {
    app.restore();
  }
}

console.log("check_hero_flows: ok");
