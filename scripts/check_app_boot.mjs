import { bootApp, createStorage } from "./harness/app.mjs";

async function completeOnboarding(app, provider = "netflix") {
  app.$("#onboarding-provider-list input[value=" + provider + "]").click();
  await app.click("#onboarding-next");
  app.$("#onboarding-llm-api-key").value = "sk-test";
  await app.click("#onboarding-next");
  await app.click("#onboarding-next");
}

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log("PASS - " + name);
    return;
  }
  failed += 1;
  console.log("FAIL - " + name + (detail === undefined ? "" : "\n       " + detail));
}

async function firstVisitShowsUsableOnboarding() {
  const app = await bootApp();
  try {
    check("first visit shows onboarding", app.$("#onboarding-screen").hidden === false);
    check("first visit hides the shell", app.$("#shell").hidden === true);
    check("onboarding starts on step 1", app.visibleSteps().join(",") === "subscriptions",
      "visible: " + app.visibleSteps().join(","));

    const options = app.$$("#onboarding-provider-list input[type=checkbox]");
    check("provider checkboxes are rendered", options.length > 0,
      "rendered " + options.length + " options; a first-time user cannot continue without them");
    check("provider options match the catalog order",
      options.map((i) => i.value).join(",") === "netflix,prime,hotstar",
      options.map((i) => i.value).join(","));
    check("provider options are labelled",
      options.every((i) => (i.closest("label")?.textContent || "").trim().length > 0));
  } finally {
    app.restore();
  }
}

async function onboardingGuardsAndCompletes() {
  const app = await bootApp();
  try {
    await app.click("#onboarding-next");
    check("step 1 blocks an empty selection",
      app.visibleSteps().join(",") === "subscriptions" && /subscription/i.test(app.text("#error-banner") || ""),
      "step=" + app.visibleSteps().join(",") + " banner=" + app.text("#error-banner"));

    app.$("#onboarding-provider-list input[value=netflix]").click();
    await app.click("#onboarding-next");
    check("selecting a provider advances to the key step",
      app.visibleSteps().join(",") === "openrouter-key", app.visibleSteps().join(","));

    await app.click("#onboarding-next");
    check("step 2 blocks an empty key",
      app.visibleSteps().join(",") === "openrouter-key" && /key/i.test(app.text("#error-banner") || ""),
      "step=" + app.visibleSteps().join(",") + " banner=" + app.text("#error-banner"));

    app.$("#onboarding-llm-api-key").value = "sk-test";
    await app.click("#onboarding-next");
    check("entering a key advances to the history step",
      app.visibleSteps().join(",") === "watch-history", app.visibleSteps().join(","));

    const stored = JSON.parse(app.window.localStorage.getItem("ottbyok.llm") || "{}");
    check("the key is stored with default endpoint and model",
      stored.apiKey === "sk-test" && /^https?:\/\//.test(stored.baseUrl || "") && !!stored.model,
      JSON.stringify(stored));

    await app.click("#onboarding-back");
    check("back returns to the key step", app.visibleSteps().join(",") === "openrouter-key");
    await app.click("#onboarding-next");

    await app.click("#onboarding-next");
    check("finishing without history reveals the shell",
      app.$("#onboarding-screen").hidden === true && app.$("#shell").hidden === false);
    check("no model request is made during onboarding",
      !app.requested.some((u) => /chat\/completions/.test(u)), app.requested.join(" "));
  } finally {
    app.restore();
  }
}

async function shellRespectsSubscriptions() {
  const app = await bootApp();
  try {
    await completeOnboarding(app);

    const titles = app.$$("#queue-track .card-title").map((n) => n.textContent);
    check("the queue is seeded", titles.length > 0, titles.join(","));
    check("only subscribed titles appear",
      !titles.includes("Prime Thriller") && !titles.includes("Hotstar Only"), titles.join(","));

    const links = app.$$("#queue-track .card-links a").map((a) => a.textContent.trim());
    check("only subscribed providers are linked",
      links.length > 0 && links.every((l) => /Netflix/i.test(l)), links.join(","));

    const descriptions = app.$$("#queue-track .card-description").map((n) => n.textContent.trim());
    check("every card carries a description", descriptions.length === titles.length
      && descriptions.every((d) => d.length > 0));
    check("save controls are present", app.$$("#queue-track .card-save").length === titles.length);
  } finally {
    app.restore();
  }
}

async function playlistsPersistAcrossReload() {
  const storage = createStorage();
  const first = await bootApp({ storage });
  let savedTitle = null;
  try {
    await completeOnboarding(first);
    savedTitle = first.text("#queue-track .card .card-title");
    await first.click("#queue-track .card .card-save");
    check("the save button opens the playlist picker",
      first.$("#playlists-dialog").hasAttribute("open") && !first.$("#playlist-picker").hidden);

    const boxes = first.$$("#playlist-picker-list input[type=checkbox]");
    check("watch later exists by default", boxes.length === 1
      && /watch later/i.test(first.$("#playlist-picker-list label")?.textContent || ""));

    boxes[0].click();
    await first.settle();
    check("saving reports success", /saved/i.test(first.text("#playlist-feedback") || ""),
      first.text("#playlist-feedback"));
  } finally {
    first.restore();
  }

  const second = await bootApp({ storage });
  try {
    check("a returning visitor skips onboarding",
      second.$("#onboarding-screen").hidden === true && second.$("#shell").hidden === false);

    await second.click("#playlists-btn");
    const items = second.$$("#playlist-items > *").map((n) => n.textContent);
    check("the saved title survives a reload",
      items.length === 1 && items[0].includes(savedTitle), savedTitle + " vs " + items.join(","));

    second.$("#playlists-close").click();
    await second.click("#new-chat-btn");
    await second.click("#playlists-btn");
    check("new chat clears the queue but keeps playlists",
      second.$$("#playlist-items > *").length === 1);
  } finally {
    second.restore();
  }
}

async function mobileDrawerCloses() {
  const app = await bootApp({ mobile: true });
  try {
    await completeOnboarding(app);
    // The view sets the inert property (which jsdom does not reflect to an
    // attribute) alongside aria-hidden, so assert on both signals.
    const closed = () => app.$("#sidebar").getAttribute("aria-hidden") === "true"
      && app.$("#sidebar").inert === true;

    check("the drawer is hidden from assistive tech on mobile", closed(),
      "aria-hidden=" + app.$("#sidebar").getAttribute("aria-hidden") + " inert=" + app.$("#sidebar").inert);

    await app.click("#sidebar-toggle");
    check("the toggle opens the drawer", !closed()
      && app.$("#sidebar-toggle").getAttribute("aria-expanded") === "true");

    app.document.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await app.settle();
    check("escape closes the drawer", closed());
    check("escape restores focus to the toggle",
      app.document.activeElement === app.$("#sidebar-toggle"),
      String(app.document.activeElement?.id));
  } finally {
    app.restore();
  }
}

async function keywordFallbackWithoutKey() {
  const app = await bootApp();
  try {
    await completeOnboarding(app);

    app.window.localStorage.removeItem("ottbyok.llm");
    const input = app.$("#query-input");
    input.value = "comedy";
    input.dispatchEvent(new app.window.Event("input", { bubbles: true }));
    await app.click("#send-btn");
    await app.settle();

    const roles = app.$$("#chat-transcript .chat-msg").map((n) => n.className);
    check("a query without a key still answers locally",
      roles.length === 2 && /user/.test(roles[0]) && /assistant/.test(roles[1]), roles.join(" | "));
    check("the local answer explains the missing key",
      /api key/i.test(app.text("#chat-transcript") || ""));
    check("no network call is attempted without a key",
      !app.requested.some((u) => /chat\/completions/.test(u)));
  } finally {
    app.restore();
  }
}

async function developerSurfaceIsHidden() {
  const app = await bootApp();
  try {
    await completeOnboarding(app);

    check("no developer button is exposed", app.$("#disclosure-btn") === null);
    check("the developer dialog starts closed", !app.$("#disclosure-dialog").hasAttribute("open"));

    app.document.dispatchEvent(new app.window.KeyboardEvent("keydown", {
      key: "D", ctrlKey: true, altKey: true, shiftKey: true, bubbles: true
    }));
    await app.settle();
    check("the developer shortcut opens the console",
      app.$("#disclosure-dialog").hasAttribute("open"));
    check("the developer console does not print the api key",
      !/sk-test/.test(app.$("#disclosure-dialog").textContent || ""));
  } finally {
    app.restore();
  }
}

async function testModeIsLocalhostOnly() {
  const local = await bootApp({ url: "http://localhost/?testMode=1&testProviders=netflix,prime" });
  try {
    check("test mode skips onboarding on localhost",
      local.$("#onboarding-screen").hidden === true && local.$("#shell").hidden === false);
  } finally {
    local.restore();
  }

  const remote = await bootApp({ url: "https://ott.example.com/?testMode=1&testProviders=netflix" });
  try {
    check("test mode cannot bypass onboarding off localhost",
      remote.$("#onboarding-screen").hidden === false, "onboarding was skipped on a public host");
  } finally {
    remote.restore();
  }
}

const suites = [
  firstVisitShowsUsableOnboarding,
  onboardingGuardsAndCompletes,
  shellRespectsSubscriptions,
  playlistsPersistAcrossReload,
  mobileDrawerCloses,
  keywordFallbackWithoutKey,
  developerSurfaceIsHidden,
  testModeIsLocalhostOnly
];

for (const suite of suites) {
  console.log("\n# " + suite.name);
  try {
    await suite();
  } catch (err) {
    failed += 1;
    console.log("FAIL - " + suite.name + " threw\n       " + (err && err.stack ? err.stack : err));
  }
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
