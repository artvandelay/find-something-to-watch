import assert from "node:assert/strict";
import { bootApp, createStorage } from "./harness/app.mjs";
import { RECOMMENDATION_LIMITS } from "../docs/js/recommendations.js";

/**
 * The agent owns the picks rail. It returns `queue`, `queueMode` ("replace" | "append")
 * and `showAll`; the UI applies them. These checks drive the real app with a scripted
 * agent and prove the UI obeys the returned decision and never classifies the viewer's
 * words, never forces three visible, and keeps the rail and chat in step.
 */

function makeRecords(count) {
  return Array.from({ length: count }, (_, index) => {
    const id = "tmdb:r" + String(index + 1).padStart(2, "0");
    return {
      id,
      t: "Title " + String(index + 1).padStart(2, "0"),
      y: 2020,
      k: "movie",
      rt: 100,
      s: "Synopsis " + (index + 1),
      im: null,
      r: 7.5,
      p: ["netflix"],
      u: { netflix: "https://example.test/netflix/" + id },
      img: null,
      l: "en",
      g: ["Comedy"],
      v: 4
    };
  });
}

const ids = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => "tmdb:r" + String(from + i).padStart(2, "0"));
const items = (list) => list.map((id) => ({ id, reason: "Because " + id }));

function decision(overrides = {}) {
  return {
    ok: true,
    reply: "Fixture reply.",
    queue: undefined,
    queueMode: undefined,
    showAll: undefined,
    memoryCandidates: [],
    watched: [],
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, requestCount: 1 },
    billing: { basis: "provider_reported", amountUsd: 0, complete: true, requestCount: 1, pricedRequestCount: 1 },
    timing: { totalMs: 50, firstTokenMs: 10 },
    ...overrides
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

const railIds = (app) => app.$$("#queue-track .card-title-button").map((node) => node.dataset.titleId);
const visibleCards = (app) => app.$$("#queue-track .card").filter((card) => !card.closest("[hidden]"));
const chatIds = (app) => app.$$("#chat-transcript .chat-picks .card-title-button").map((node) => node.dataset.titleId);

let passed = 0;
function check(name, condition, detail = "") {
  assert.ok(condition, name + (detail ? "\n  " + detail : ""));
  passed += 1;
  console.log("PASS - " + name);
}

// A script maps each query to one decision, so what the agent "chooses" is explicit.
function scriptedAgent(script, seen = []) {
  return async (opts) => {
    seen.push(opts.query);
    const entry = script[opts.query];
    if (!entry) throw new Error("No scripted decision for: " + opts.query);
    if (entry.gate) await entry.gate;
    const result = decision(typeof entry === "function" ? entry() : entry.result);
    opts.onEvent?.({ type: "done", turnId: opts.turnId, ...result });
    return result;
  };
}

// ---- replace, append, and "the UI does not read the sentence" ----------------
{
  const seen = [];
  let releaseMore;
  const moreGate = new Promise((resolve) => { releaseMore = resolve; });
  const script = {
    "something funny": { result: { queue: items(ids(1, 4)), queueMode: "replace", reply: "Four to start." } },
    "give me more options": { result: { queue: items([...ids(3, 4), ...ids(5, 7)]), queueMode: "append", reply: "Added three." } },
    "More, please": { gate: moreGate, result: { queue: items(ids(8, 9)), queueMode: "append", reply: "Two more." } },
    "a movie for tonight": { result: { queue: items(ids(20, 21)), queueMode: "replace", reply: "Fresh start." } },
    // Words say "more", the agent says replace: the UI must replace.
    "show me more": { result: { queue: items(ids(10, 11)), queueMode: "replace", reply: "Starting over." } },
    // Words say nothing about more, the agent says append: the UI must append.
    "what about horror": { result: { queue: items(ids(12, 12)), queueMode: "append", reply: "One horror." } },
    // No queueMode at all: replace, whatever the words were.
    "10 more": { result: { queue: items(ids(13, 14)), reply: "No mode given." } },
    // No queue at all: the rail and the chat picks stay as they are.
    "why that one": { result: { reply: "Because it is short." } }
  };
  const app = await bootApp({ records: makeRecords(30), agentFixture: scriptedAgent(script, seen) });
  try {
    await ready(app);
    await send(app, "something funny");
    check("agent length drives the rail: four returned, four cards", railIds(app).length === 4, railIds(app).join());
    check("inline chat picks match what the agent returned, not a fixed three",
      chatIds(app).length === 4 && chatIds(app).join() === ids(1, 4).join(), chatIds(app).join());
    check("a short queue is not folded", !app.$("#queue-more .queue-more-toggle") && visibleCards(app).length === 4);
    check("More button is present once the rail has picks and says More",
      app.$(".queue-more-request")?.hidden === false && app.text(".queue-more-request") === "Ask for more picks");

    const before = railIds(app);
    await send(app, "give me more options");
    check("queueMode append keeps the prior cards in the same order and adds only new ids",
      railIds(app).join() === [...before, ...ids(5, 7)].join(), railIds(app).join());
    check("the repeated id was not duplicated", new Set(railIds(app)).size === railIds(app).length);
    check("inline chat picks for an append turn show only what was added",
      chatIds(app).slice(-3).join() === ids(5, 7).join());
    check("an append that reaches past the fold opens it: all seven visible", visibleCards(app).length === 7);

    // Rail button: dumb hook, draft untouched, disabled while the turn runs.
    app.$("#query-input").value = "my half-typed draft";
    app.$(".queue-more-request").click();
    await app.settle();
    check("rail button disables itself while the turn runs", app.$(".queue-more-request").disabled === true);
    check("rail button sends a short plain chat message, no count, no flag", seen.at(-1) === "More, please");
    check("the user message is visible in the chat",
      /More, please/.test(app.text("#chat-transcript") || ""));
    check("the typed draft is untouched", app.$("#query-input").value === "my half-typed draft");
    releaseMore();
    await app.settle();
    check("button re-enables after the turn", app.$(".queue-more-request").disabled === false);
    check("button turn appended after the existing cards and the originals stayed first",
      railIds(app).join() === [...before, ...ids(5, 9)].join(), railIds(app).join());
    check("the draft survives the finished turn", app.$("#query-input").value === "my half-typed draft");
    // Fold: 9 titles > 6, so the fold opened because the agent appended them.
    check("appended titles are not trapped behind a collapsed toggle",
      visibleCards(app).length === 9 && app.$("#queue-more .queue-more-toggle")?.getAttribute("aria-expanded") === "true",
      String(visibleCards(app).length));
    app.$("#query-input").value = "";

    await send(app, "why that one");
    check("a turn with no queue leaves the rail and adds no chat picks",
      railIds(app).join() === [...before, ...ids(5, 9)].join() && chatIds(app).length === 4 + 3 + 2);

    await send(app, "show me more");
    check("the words 'show me more' do not trigger append when the agent says replace",
      railIds(app).join() === ids(10, 11).join(), railIds(app).join());

    await send(app, "what about horror");
    check("an unrelated sentence still appends when the agent says append",
      railIds(app).join() === ids(10, 12).join(), railIds(app).join());

    await send(app, "10 more");
    check("no queueMode means replace, whatever the sentence", railIds(app).join() === ids(13, 14).join());

    await send(app, "a movie for tonight");
    check("queueMode replace swaps the rail",
      railIds(app).join() === ids(20, 21).join() && chatIds(app).slice(-2).join() === ids(20, 21).join());
  } finally {
    app.restore();
  }
}

// ---- fold follows the agent: showAll, long queues, and the hard cap -----------
{
  const script = {
    long: { result: { queue: items(ids(1, 12)), queueMode: "replace" } },
    longAll: { result: { queue: items(ids(1, 12)), queueMode: "replace", showAll: true } },
    fill: { result: { queue: items(ids(1, 18)), queueMode: "replace", showAll: true } },
    overflow: { result: { queue: items(ids(19, 24)), queueMode: "append" } },
    keepAll: { result: { queue: items(ids(25, 25)), queueMode: "append" } }
  };
  const storage = createStorage();
  const app = await bootApp({ storage, records: makeRecords(40), agentFixture: scriptedAgent(script) });
  try {
    await ready(app);
    await send(app, "long");
    check("a long queue folds after the first few and says how many are folded",
      visibleCards(app).length === 5 && /Show 7 more/.test(app.text("#queue-more") || ""),
      String(visibleCards(app).length));
    check("the fold does not hide anything from the DOM-level list, just from view", railIds(app).length === 12);
    app.$("#queue-more .queue-more-toggle").click();
    await app.settle();
    check("the viewer can open the fold", visibleCards(app).length === 12);

    await send(app, "longAll");
    check("showAll true shows all twelve with no fold",
      visibleCards(app).length === 12 && !app.$("#queue-more .queue-more-toggle"));

    const reloaded = await (async () => {
      app.restore();
      return bootApp({ storage, records: makeRecords(40), agentFixture: scriptedAgent(script) });
    })();
    try {
      check("showAll is stored with the queue and survives a reload",
        reloaded.$$("#queue-track .card").length === 12
          && reloaded.$$("#queue-track .card").filter((card) => !card.closest("[hidden]")).length === 12);
      await send(reloaded, "fill");
      check("eighteen titles, all shown", visibleCards(reloaded).length === 18);
      await send(reloaded, "overflow");
      check("the hard cap holds the stored rail at the limit",
        railIds(reloaded).length === RECOMMENDATION_LIMITS.items
          && railIds(reloaded).join() === ids(1, 20).join(), railIds(reloaded).join());
      check("overflow is announced, not silent",
        /did not fit/.test(reloaded.text("#queue-feedback") || ""), reloaded.text("#queue-feedback"));
      await send(reloaded, "keepAll");
      check("at the cap nothing is added and the originals stay", railIds(reloaded).join() === ids(1, 20).join());
    } finally {
      reloaded.restore();
    }
  } finally {
    try { app.restore(); } catch { /* already restored */ }
  }
}

// ---- no key: the rail button shows the key banner and changes nothing ---------
{
  const seen = [];
  const app = await bootApp({
    url: "http://localhost/?testMode=1&testProviders=netflix",
    records: makeRecords(30),
    agentFixture: scriptedAgent({}, seen)
  });
  try {
    const cards = railIds(app);
    check("test mode seeds a rail", cards.length > 0 && app.$(".queue-more-request")?.hidden === false, String(cards.length));
    app.$("#query-input").value = "keep my draft";
    app.$(".queue-more-request").click();
    await app.settle();
    check("no key: the key banner is showing", app.$("#chat-key-error")?.hidden === false);
    check("no key: no message was sent and the agent never ran",
      seen.length === 0 && app.$$("#chat-transcript .chat-msg").length === 0);
    check("no key: rail, draft and button are untouched",
      railIds(app).join() === cards.join()
        && app.$("#query-input").value === "keep my draft"
        && app.$(".queue-more-request").disabled === false);
  } finally {
    app.restore();
  }
}

// ---- the frontend does not classify the viewer's sentence --------------------
{
  const { readFile } = await import("node:fs/promises");
  for (const file of ["ui.js", "views/queue.js", "views/chat.js", "recommendations.js"]) {
    const text = await readFile(new URL("../docs/js/" + file, import.meta.url), "utf8");
    check("docs/js/" + file + " has no more-intent sentence classifier",
      !/asksForMore|wantsMore|moreIntent|appendTo|give me more|show me more/i.test(text));
  }
}

console.log(passed + " passed, 0 failed");
console.log("check_agent_rail OK");
