import { bootApp, createStorage } from "./harness/app.mjs";
import { createBrowserMemory } from "../docs/js/memory.js";

async function completeOnboarding(app, provider = "netflix") {
  await app.click("#settings-btn");
  app.$("#settings-provider-list input[value=" + provider + "]").click();
  app.$("#llm-api-key").value = "sk-test";
  await app.click("#settings-save");
}

/** True only when the node exists and no ancestor is hidden. */
function isVisible(app, selector) {
  let node = app.$(selector);
  if (!node) return false;
  while (node && node.nodeType === 1) {
    if (node.hidden) return false;
    node = node.parentElement;
  }
  return true;
}

function playlistRow(app, name) {
  return app.$$("#playlist-library-list .playlist-row")
    .find((button) => (button.textContent || "").includes(name)) || null;
}

function playlistRowNames(app) {
  return app.$$("#playlist-library-list .playlist-row .playlist-row-name")
    .map((node) => node.textContent.trim());
}

async function openPlaylist(app, name) {
  const row = playlistRow(app, name);
  if (!row) throw new Error("No playlist row named " + name);
  row.click();
  await app.settle();
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

async function firstVisitShowsWorkspace() {
  const app = await bootApp();
  try {
    check("first visit bypasses onboarding", app.$("#onboarding-screen").hidden === true);
    check("first visit opens the chat shell", app.$("#shell").hidden === false);
    check("onboarding markup remains available",
      !!app.$("#onboarding-form") && app.$$("#onboarding-form [data-onboarding-step]").length === 3);
  } finally {
    app.restore();
  }
}

async function phaseFiveStructuralContract() {
  const app = await bootApp();
  try {
    const sidebarBottom = app.$("#sidebar > .sidebar-bottom");
    const sidebarMain = app.$("#sidebar > .sidebar-main");
    const subscriptions = app.$("#subscriptions-summary");
    const navigation = app.$("#sidebar nav.sidebar-nav");
    check("sidebar bottom contains subscriptions before its navigation",
      !!sidebarBottom && !!subscriptions && !!navigation
        && subscriptions.closest(".sidebar-bottom") === sidebarBottom
        && navigation.parentElement === sidebarBottom
        && !navigation.contains(subscriptions)
        && !!(subscriptions.closest(".sidebar-block")?.compareDocumentPosition(navigation)
          & app.window.Node.DOCUMENT_POSITION_FOLLOWING));
    check("conversation history remains in the upper scrollable sidebar area",
      !!sidebarMain && sidebarMain.contains(app.$("#conversation-list"))
        && !sidebarBottom.contains(app.$("#conversation-list")));

    const utilityControls = [
      "#sidebar-toggle", "#sidebar-collapse", "#new-chat-btn",
      "#playlists-btn", "#context-btn", "#settings-btn"
    ];
    check("sidebar utility controls use accessible currentColor SVGs",
      utilityControls.every((selector) => {
        const control = app.$(selector);
        const svg = control?.querySelector("svg[aria-hidden='true']");
        const accessibleName = control?.getAttribute("aria-label") || control?.textContent?.trim();
        return !!svg && !!svg.querySelector("path, circle") && !!accessibleName;
      }));

    const composerLabel = app.$("label[for='query-input']");
    check("composer keeps a real visible input label",
      !!composerLabel && /what would you like to watch/i.test(composerLabel.textContent || ""));
    const details = app.$("#title-details-dialog");
    check("title details retains native dialog semantics",
      details?.tagName === "DIALOG"
        && details.getAttribute("aria-labelledby") === "title-details-title"
        && !!app.$("#title-details-title")
        && app.$("#title-details-close")?.getAttribute("aria-label") === "Close title details");
  } finally {
    app.restore();
  }
}

async function legacyOnboardingStaysDormant() {
  const app = await bootApp();
  try {
    check("bypassed onboarding stays hidden", app.$("#onboarding-screen").hidden === true);
    check("its key input and navigation remain in the document",
      !!app.$("#onboarding-llm-api-key") && !!app.$("#onboarding-next"));
    check("direct boot does not make a model request",
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

async function titleDetailsShareFullCatalogAndRefresh() {
  const record = {
    id: "tmdb:m100",
    t: "Catalog Detail",
    y: 2023,
    k: "movie",
    rt: 97,
    s: "",
    im: "tt1234567",
    r: 8.4,
    p: ["netflix", "prime"],
    u: {
      netflix: "https://www.netflix.com/title/1234567",
      prime: "https://www.primevideo.com/search?phrase=Catalog%20Detail"
    },
    img: "https://image.tmdb.org/t/p/w185/example.jpg",
    l: "en",
    g: ["Comedy", "Drama"],
    v: 456
  };
  const app = await bootApp({ records: [record], sidecar: "deferred" });
  try {
    await completeOnboarding(app);
    const trigger = app.$("#queue-track .card-title-button");
    trigger.focus();
    trigger.click();
    await app.settle();

    check("a queue title opens the shared title-details dialog",
      app.$("#title-details-dialog").hasAttribute("open"));
    check("details render catalog display fields without invented metadata",
      /Catalog Detail/.test(app.text("#title-details-title") || "")
        && /2023 · movie · 97 min/.test(app.text("#title-details-content") || "")
        && /TMDB 8.4 · 456 votes/.test(app.text("#title-details-content") || "")
        && /Language: en/.test(app.text("#title-details-content") || "")
        && /Comedy, Drama/.test(app.text("#title-details-content") || "")
        && !!app.$("#title-details-content img")
        && !!app.$("#title-details-content a[href*='imdb.com']"),
      app.text("#title-details-content"));
    check("details split all catalog providers by current subscriptions",
      /On your subscriptions/.test(app.text("#title-details-content") || "")
        && /Watch on Netflix/.test(app.text("#title-details-content") || "")
        && /Other known platforms/.test(app.text("#title-details-content") || "")
        && /Find on Prime Video/.test(app.text("#title-details-content") || ""),
      app.text("#title-details-content"));

    const focusBeforeRefresh = app.document.activeElement;
    app.resolveSidecar({ schema: 2, count: 1, s: { [record.id]: "Merged synopsis from the sidecar." } });
    await app.settle();
    check("an open details dialog refreshes after the sidecar merge",
      /Merged synopsis from the sidecar/.test(app.text("#title-details-content") || ""));
    check("sidecar refresh leaves dialog focus in place", app.document.activeElement === focusBeforeRefresh);

    await app.click("#title-details-close");
    check("closing details restores focus to its title trigger",
      app.document.activeElement === app.$("#queue-track .card-title-button"));

    app.$("#queue-track .card").dispatchEvent(new app.window.Event("click", { bubbles: true }));
    await app.settle();
    check("card-background clicks open title details", app.$("#title-details-dialog").hasAttribute("open"));
    await app.click("#title-details-close");

    app.$("#queue-track .card-links a").dispatchEvent(new app.window.Event("click", { bubbles: true }));
    await app.settle();
    check("provider links do not open title details", !app.$("#title-details-dialog").hasAttribute("open"));

    await app.click("#queue-track .card-save");
    check("save controls open playlists without opening title details",
      app.$("#playlists-dialog").hasAttribute("open") && !app.$("#title-details-dialog").hasAttribute("open"));
  } finally {
    app.restore();
  }
}

async function missingPlaylistTitleOpensDetailsTombstone() {
  const storage = createStorage();
  const first = await bootApp({ storage });
  try {
    await completeOnboarding(first);
    const browserMemory = createBrowserMemory();
    await browserMemory.initialize();
    const playlists = await browserMemory.getPlaylists();
    playlists.playlists[0].titleIds = ["missing:title"];
    await browserMemory.setPlaylists(playlists);
  } finally {
    first.restore();
  }

  const second = await bootApp({ storage });
  try {
    await second.click("#playlists-btn");
    await openPlaylist(second, "Watch later");
    const title = second.$("#playlist-items .playlist-title");
    check("unavailable playlist entries retain a title-details trigger", !!title);
    title.click();
    await second.settle();
    check("a missing saved title renders the details tombstone",
      second.$("#title-details-dialog").hasAttribute("open")
        && /Title unavailable/.test(second.text("#title-details-title") || "")
        && /missing:title/.test(second.text("#title-details-content") || ""),
      second.text("#title-details-content"));
  } finally {
    second.restore();
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
    check("the library opens on Your playlists",
      second.text("#playlists-dialog-title") === "Your playlists"
        && isVisible(second, "#playlist-library-list"),
      second.text("#playlists-dialog-title"));
    check("the library counts saved titles per playlist",
      (playlistRow(second, "Watch later")?.textContent || "").includes("1"),
      playlistRow(second, "Watch later")?.textContent);

    await openPlaylist(second, "Watch later");
    const items = second.$$("#playlist-items > *").map((n) => n.textContent);
    check("the saved title survives a reload",
      items.length === 1 && items[0].includes(savedTitle), savedTitle + " vs " + items.join(","));

    second.$("#playlists-close").click();
    await second.click("#new-chat-btn");
    await second.click("#playlists-btn");
    await openPlaylist(second, "Watch later");
    check("new chat clears the queue but keeps playlists",
      second.$$("#playlist-items > *").length === 1);
  } finally {
    second.restore();
  }
}

async function customPlaylistLifecycleAndExports() {
  const app = await bootApp();
  try {
    await completeOnboarding(app);
    const savedTitle = app.text("#queue-track .card .card-title");
    await app.click("#playlists-btn");

    check("the library lists Watch later first",
      playlistRowNames(app)[0] === "Watch later", playlistRowNames(app).join(","));
    check("the library hides creation controls until New playlist is chosen",
      !isVisible(app, "#playlist-create-view") && !isVisible(app, "#playlist-create-name"));
    check("the library hides destructive and export controls",
      !isVisible(app, "#playlist-delete") && !isVisible(app, "#playlist-rename")
        && !isVisible(app, "#playlist-export-md"));
    check("the library shows an intentional empty state before anything is saved",
      isVisible(app, "#playlist-library-empty")
        && (app.text("#playlist-library-empty") || "").length > 0);

    await app.click("#playlist-new");
    check("New playlist opens a focused create view",
      isVisible(app, "#playlist-create-name") && !isVisible(app, "#playlist-library-list")
        && !isVisible(app, "#playlist-items"),
      app.text("#playlists-dialog-title"));

    await app.click("#playlist-create");
    check("an empty playlist name is rejected",
      /enter a name/i.test(app.text("#playlist-feedback") || ""),
      app.text("#playlist-feedback"));

    app.$("#playlist-create-name").value = "Weekend";
    await app.click("#playlist-create");
    check("creating a playlist opens its detail view",
      app.text("#playlists-dialog-title") === "Weekend" && isVisible(app, "#playlist-items"),
      app.text("#playlists-dialog-title"));
    check("detail keeps rename, delete and export behind More",
      isVisible(app, "#playlist-more") && !isVisible(app, "#playlist-rename")
        && !isVisible(app, "#playlist-delete") && !isVisible(app, "#playlist-export-md"));

    await app.click("#playlist-more");
    check("More reveals the secondary actions",
      isVisible(app, "#playlist-rename") && isVisible(app, "#playlist-delete")
        && isVisible(app, "#playlist-export"));
    check("export formats stay hidden until Export is chosen",
      !isVisible(app, "#playlist-export-md"));

    await app.click("#playlist-rename");
    check("rename opens a single focused field",
      isVisible(app, "#playlist-rename-name")
        && app.document.activeElement === app.$("#playlist-rename-name"),
      String(app.document.activeElement?.id));

    await app.click("#playlist-rename-cancel");
    check("cancelling rename returns to the detail actions",
      !isVisible(app, "#playlist-rename-name") && isVisible(app, "#playlist-more"));

    await app.click("#playlist-more");
    await app.click("#playlist-rename");
    app.$("#playlist-rename-name").value = "Friday Night";
    await app.click("#playlist-rename-save");
    check("a custom playlist can be renamed",
      app.text("#playlists-dialog-title") === "Friday Night"
        && !isVisible(app, "#playlist-rename-name"),
      app.text("#playlists-dialog-title"));

    await app.click("#playlist-back");
    check("Back returns to the library",
      isVisible(app, "#playlist-library-list") && !isVisible(app, "#playlist-items")
        && playlistRowNames(app).includes("Friday Night"),
      playlistRowNames(app).join(","));

    await openPlaylist(app, "Watch later");
    await app.click("#playlist-more");
    check("watch later cannot be renamed or deleted",
      !isVisible(app, "#playlist-rename") && !isVisible(app, "#playlist-delete")
        && isVisible(app, "#playlist-export"));
    await app.click("#playlist-back");

    await app.click("#playlists-close");
    await app.click("#queue-track .card .card-save");
    check("the save button still opens the compact picker, not the manager",
      isVisible(app, "#playlist-picker-list") && !isVisible(app, "#playlist-library-list"));
    const customPicker = app.$$("#playlist-picker-list label")
      .find((label) => /Friday Night/.test(label.textContent));
    check("custom playlists appear in the card picker", !!customPicker);
    customPicker.querySelector("input").click();
    await app.settle();
    check("a title can be saved to a custom playlist",
      /Saved to Friday Night/.test(app.text("#playlist-feedback") || ""),
      app.text("#playlist-feedback"));

    await app.click("#playlists-close");
    await app.click("#playlists-btn");
    await openPlaylist(app, "Friday Night");
    check("the custom playlist resolves its saved title",
      app.$$("#playlist-items > *").length === 1
        && (app.text("#playlist-items") || "").includes(savedTitle),
      app.text("#playlist-items"));

    await app.click("#playlist-more");
    await app.click("#playlist-export");
    check("export choices appear only after Export is chosen",
      isVisible(app, "#playlist-export-md") && isVisible(app, "#playlist-export-json")
        && isVisible(app, "#playlist-export-csv"));
    await app.click("#playlist-export-md");
    await app.click("#playlist-export-json");
    await app.click("#playlist-export-csv");
    check("all three playlist export controls download files", app.downloads.length === 3,
      String(app.downloads.length));

    const markdown = await app.readDownload(-3);
    const json = await app.readDownload(-2);
    const csv = await app.readDownload(-1);
    check("Markdown export names and describes the playlist",
      /friday-night\.md$/.test(markdown.filename)
        && markdown.text.includes("# Friday Night")
        && markdown.text.includes(savedTitle),
      markdown.filename + "\n" + markdown.text);
    check("JSON export carries playlist metadata and title",
      /friday-night\.json$/.test(json.filename)
        && JSON.parse(json.text).playlist.name === "Friday Night"
        && json.text.includes(savedTitle),
      json.filename + "\n" + json.text);
    check("CSV export contains the saved title",
      /friday-night\.csv$/.test(csv.filename) && csv.text.includes(savedTitle),
      csv.filename + "\n" + csv.text);

    await app.click("#playlist-items .playlist-item-remove");
    check("a title can be removed from a custom playlist",
      /No saved titles/.test(app.text("#playlist-items") || ""),
      app.text("#playlist-items"));

    await app.click("#playlist-delete");
    check("deleting a custom playlist returns to the library without it",
      isVisible(app, "#playlist-library-list")
        && !playlistRowNames(app).includes("Friday Night"),
      playlistRowNames(app).join(","));
    check("Watch later survives the delete", playlistRowNames(app).includes("Watch later"));
  } finally {
    app.restore();
  }
}

async function backupExportIncludesUserState() {
  const app = await bootApp({ agentFixture: {} });
  try {
    await completeOnboarding(app);

    await app.click("#queue-track .card .card-save");
    app.$("#playlist-picker-list input[type=checkbox]").click();
    await app.settle();
    await app.click("#playlists-close");

    // Build a real conversation through the deterministic agent fixture so the
    // backup has state from each major user-owned area.
    app.$("#query-input").value = "comedy";
    app.$("#query-input").dispatchEvent(new app.window.Event("input", { bubbles: true }));
    await app.click("#send-btn");
    const messagesBefore = app.$$("#chat-transcript .chat-msg").map((node) => node.textContent);
    const queueBefore = app.$$("#queue-track .card-title").map((node) => node.textContent);

    await app.click("#settings-btn");
    check("local data lives in the Settings dialog",
      app.$("#export-backup-btn").closest("dialog") === app.$("#settings-dialog")
        && app.$("#clear-data-btn").closest("dialog") === app.$("#settings-dialog"));
    check("local data buttons are reachable once Settings is open",
      isVisible(app, "#export-backup-btn") && isVisible(app, "#clear-data-btn"));
    check("the sidebar no longer carries local-data controls",
      app.$("#sidebar").querySelector("#export-backup-btn") === null
        && app.$("#sidebar").querySelector("#clear-data-btn") === null);

    await app.click("#export-backup-btn");
    await app.click("#settings-close");
    const backupDownload = await app.readDownload();
    const backup = JSON.parse(backupDownload.text);
    check("backup export downloads the versioned memory document",
      backupDownload.filename === "memory.json" && backup.schema === 3,
      backupDownload.filename + " schema=" + backup.schema);
    check("backup export includes conversation, ranked queue, profile, archives, learned facts, and playlists",
      backup.conversation.messages.length >= messagesBefore.length
        && backup.conversation.messages.some((message) => message.role === "assistant")
        && backup.queue.items.length === queueBefore.length
        && backup.profile.providers.includes("netflix")
        && Array.isArray(backup.threads.items)
        && Array.isArray(backup.learned.items)
        && backup.playlists.playlists[0].titleIds.length === 1);
    check("backup export never includes the LLM key",
      !backupDownload.text.includes("sk-test") && !("llm" in backup));
  } finally {
    app.restore();
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

async function sidebarCollapsePersistsAcrossReload() {
  const storage = createStorage();
  const first = await bootApp({ storage });
  try {
    await completeOnboarding(first);
    check("the sidebar starts expanded",
      first.$("#shell").classList.contains("sidebar-collapsed") === false
        && first.$("#sidebar-collapse").getAttribute("aria-expanded") === "true",
      first.$("#sidebar-collapse").getAttribute("aria-expanded"));

    await first.click("#sidebar-collapse");
    check("the collapse control switches to the icon rail",
      first.$("#shell").classList.contains("sidebar-collapsed")
        && first.$("#sidebar-collapse").getAttribute("aria-expanded") === "false");
    check("the collapse control keeps an accessible name",
      /expand sidebar/i.test(first.$("#sidebar-collapse").getAttribute("aria-label") || ""),
      first.$("#sidebar-collapse").getAttribute("aria-label"));
    check("collapsed nav items stay labelled",
      ["#new-chat-btn", "#playlists-btn", "#context-btn", "#settings-btn"].every((selector) => {
        const node = first.$(selector);
        return (node.getAttribute("aria-label") || "").trim().length > 0
          && (node.getAttribute("title") || "").trim().length > 0;
      }));
  } finally {
    first.restore();
  }

  const second = await bootApp({ storage });
  try {
    check("the collapsed sidebar survives a reload",
      second.$("#shell").classList.contains("sidebar-collapsed")
        && second.$("#sidebar-collapse").getAttribute("aria-expanded") === "false",
      second.$("#sidebar-collapse").getAttribute("aria-expanded"));

    await second.click("#sidebar-collapse");
    check("expanding again is persisted",
      second.$("#shell").classList.contains("sidebar-collapsed") === false
        && second.window.localStorage.getItem("ottbyok.sidebar") === "0",
      second.window.localStorage.getItem("ottbyok.sidebar"));
  } finally {
    second.restore();
  }

  const third = await bootApp({ storage });
  try {
    check("the expanded preference survives a reload too",
      third.$("#shell").classList.contains("sidebar-collapsed") === false);
  } finally {
    third.restore();
  }
}

async function chatIsGatedWithoutKey() {
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
    check("a query without a key does not enter the conversation",
      roles.length === 0, roles.join(" | "));
    check("the chat explains how to configure the missing key",
      /settings/i.test(app.text("#chat-key-error") || "")
        && /api key/i.test(app.text("#chat-key-error") || ""));
    check("the composer becomes disabled without a key", app.$("#send-btn").disabled === true);
    check("no network call is attempted without a key",
      !app.requested.some((u) => /chat\/completions/.test(u)));
  } finally {
    app.restore();
  }
}

async function conversationsAndLearnedMemoryPersist() {
  const storage = createStorage();
  const first = await bootApp({ storage, agentFixture: {} });
  try {
    await completeOnboarding(first);
    first.$("#query-input").value = "comedy";
    first.$("#query-input").dispatchEvent(new first.window.Event("input", { bubbles: true }));
    await first.click("#send-btn");
    const transcript = first.text("#chat-transcript");
    const picks = first.$$("#queue-track .card-title").map((node) => node.textContent).join("\n");

    await first.click("#new-chat-btn");
    check("New chat archives the non-empty conversation",
      first.$$("#conversation-list-items .conversation-list-item").length === 2
        && first.$$("#conversation-list-items .conversation-list-item:not(:disabled)")
          .some((node) => /comedy/i.test(node.textContent || "")));
    check("New chat starts an empty active conversation",
      /Ask for something to watch/.test(first.text("#chat-transcript") || ""));

    const archived = first.$$("#conversation-list-items .conversation-list-item:not(:disabled)")
      .find((node) => /comedy/i.test(node.textContent || ""));
    archived.click();
    await first.settle();
    check("selecting an archived conversation restores its transcript",
      first.$$("#chat-transcript .chat-msg").length === 2
        && /comedy/i.test(first.text("#chat-transcript") || "")
        && /Fixture reply/i.test(first.text("#chat-transcript") || ""),
      transcript + " vs " + first.text("#chat-transcript"));
    check("selecting an archived conversation restores its ranked queue",
      first.$$("#queue-track .card-title").map((node) => node.textContent).join("\n") === picks);

    const browserMemory = createBrowserMemory();
    await browserMemory.initialize();
    await browserMemory.setLearned({
      schema: 1,
      revision: 1,
      items: [{ id: "learned-comedy", kind: "genre", polarity: "like", value: "comedy" }]
    });
    await first.click("#context-btn");
    check("Profile & context exposes learned-memory controls",
      first.$("#memory-enabled").checked && first.$$("#learned-facts .learned-fact").length === 1
        && first.$("#learned-clear") !== null);
    const learnedValue = first.$("#learned-facts input");
    learnedValue.value = "comedies";
    learnedValue.dispatchEvent(new first.window.Event("input", { bubbles: true }));
    await first.click("#context-save");
    check("learned facts are editable through the context coordinator",
      (await browserMemory.getLearned()).items[0].value === "comedies");

    await first.click("#context-btn");
    first.$("#memory-enabled").checked = false;
    await first.click("#learned-clear");
    await first.click("#context-save");
    check("learned memory can be disabled and cleared",
      (await browserMemory.getProfile()).memoryEnabled === false
        && (await browserMemory.getLearned()).items.length === 0);
    await first.click("#new-chat-btn");
  } finally {
    first.restore();
  }

  const second = await bootApp({ storage });
  try {
    check("archived conversations survive a reload",
      second.$$("#conversation-list-items .conversation-list-item").length >= 2);
  } finally {
    second.restore();
  }
}

async function workerUnavailableKeepsShellAndKeyGate() {
  const app = await bootApp();
  try {
    check("the harness has no Worker implementation", typeof app.window.Worker === "undefined",
      String(app.window.Worker));
    check("Worker unavailability still opens the chat shell",
      app.$("#onboarding-screen").hidden === true && app.$("#shell").hidden === false);
    check("Worker unavailability keeps the key gate visible",
      /api key/i.test(app.text("#chat-key-error") || "") && app.$("#send-btn").disabled);
  } finally {
    app.restore();
  }
}

async function settingsModelPickerSupportsOpenRouterDropdown() {
  const app = await bootApp();
  try {
    await completeOnboarding(app);
    await app.click("#settings-btn");
    await app.settle();

    check("OpenRouter settings expose the model picker",
      app.$("#llm-model-picker") !== null && app.$("#llm-model-openrouter-field").hidden === false);
    check("the default model is preselected",
      /GPT-5\.6 Terra Pro/.test(app.text("#llm-model-trigger-name") || ""));

    await app.click("#llm-model-trigger");
    await app.settle();
    check("opening the picker shows search and a model list",
      app.$("#llm-model-panel").hidden === false
        && !!app.$("#llm-model-search")
        && app.$$(".model-picker-option").length > 0);

    const sonnet = [...app.$$(".model-picker-option")]
      .find((node) => node.dataset.modelId === "anthropic/claude-sonnet-4.6");
    check("recommended models are listed as picker options", !!sonnet);
    sonnet.click();
    await app.settle();
    await app.click("#settings-save");
    let stored = JSON.parse(app.window.localStorage.getItem("ottbyok.llm") || "{}");
    check("saving a picker model persists the slug",
      stored.model === "anthropic/claude-sonnet-4.6", JSON.stringify(stored));

    await app.click("#settings-btn");
    await app.settle();
    await app.click("#llm-model-trigger");
    await app.settle();
    await app.click("#llm-model-other");
    await app.settle();
    app.$("#llm-model-custom").value = "vendor/custom-model";
    app.$("#llm-model-custom").dispatchEvent(new app.window.Event("input", { bubbles: true }));
    await app.click("#settings-save");
    stored = JSON.parse(app.window.localStorage.getItem("ottbyok.llm") || "{}");
    check("saving a custom model persists the typed slug",
      stored.model === "vendor/custom-model", JSON.stringify(stored));

    app.$("#llm-base-url").value = "https://model.example.test/v1";
    app.$("#llm-base-url").dispatchEvent(new app.window.Event("input", { bubbles: true }));
    await app.settle();
    check("non-OpenRouter URLs fall back to the free-text model field",
      app.$("#llm-model-compat-field").hidden === false && app.$("#llm-model-openrouter-field").hidden === true);
  } finally {
    app.restore();
  }
}

async function settingsWebSearchIsScopedToOpenRouter() {
  const app = await bootApp();
  try {
    await completeOnboarding(app);
    await app.click("#settings-btn");

    const baseUrl = app.$("#llm-base-url");
    const webSearch = app.$("#llm-web-search");
    check("settings exposes the web-search control", !!webSearch);

    baseUrl.value = "https://model.example.test/v1";
    baseUrl.dispatchEvent(new app.window.Event("input", { bubbles: true }));
    await app.settle();
    check("web search is disabled for a non-OpenRouter URL", webSearch.disabled === true);

    baseUrl.value = "https://openrouter.ai/api/v1";
    baseUrl.dispatchEvent(new app.window.Event("input", { bubbles: true }));
    await app.settle();
    webSearch.checked = true;
    await app.click("#settings-save");

    const stored = JSON.parse(app.window.localStorage.getItem("ottbyok.llm") || "{}");
    check("OpenRouter web-search preference persists", stored.webSearch === true, JSON.stringify(stored));
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
    check("direct chat boot is also used off localhost",
      remote.$("#onboarding-screen").hidden === true && remote.$("#shell").hidden === false);
    check("remote test-mode parameters do not configure subscriptions",
      !/Netflix/i.test(remote.text("#subscriptions-summary") || ""));
  } finally {
    remote.restore();
  }
}

async function searchIndexIdleWaitIsBounded() {
  const app = await bootApp();
  try {
    check("search-index readiness bounds the idle callback wait",
      app.idleRequests.some((options) => options?.timeout === 250),
      JSON.stringify(app.idleRequests));
  } finally {
    app.restore();
  }
}

async function streamedTurnRendersDecisionActivityAndMetrics() {
  const storage = createStorage();
  const records = [
    { ...defaultRecord("tmdb:one", "First Choice"), p: ["netflix"] },
    { ...defaultRecord("tmdb:two", "Second Choice"), p: ["netflix"] },
    { ...defaultRecord("tmdb:three", "Third Choice"), p: ["netflix"] },
    { ...defaultRecord("tmdb:four", "Fourth Choice"), p: ["netflix"] },
    { ...defaultRecord("tmdb:five", "Fifth Choice"), p: ["netflix"] }
  ];
  let release = null;
  const app = await bootApp({
    storage,
    records,
    agentFixture: (opts) => {
      opts.onEvent({ type: "status", turnId: opts.turnId, phase: "PLANNING", text: "Planning", step: 1 });
      opts.onEvent({ type: "status", turnId: opts.turnId, phase: "SEARCHING CATALOG", text: "Searching catalog", step: 2 });
      opts.onEvent({ type: "tool_result", turnId: opts.turnId, id: "tool-1", name: "run_catalog_js", count: 5, ok: true, durationMs: 4, step: 2 });
      opts.onEvent({ type: "delta", turnId: opts.turnId, text: "**Draft answer**" });
      return new Promise((resolve) => {
        release = () => resolve({
          ok: true,
          reply: "**Final answer** with a catalog-grounded explanation.",
          queue: records.map((record, index) => ({ id: record.id, reason: "Fit reason " + (index + 1) })),
          memoryCandidates: [{
            kind: "genre", polarity: "like", value: "comedy",
            explicit: true, durable: true, evidence: "comedy"
          }],
          usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20, requestCount: 2 },
          billing: { basis: "provider_reported", amountUsd: 0.0042, complete: true, requestCount: 2, pricedRequestCount: 2 },
          timing: { totalMs: 18400, firstTokenMs: 120 }
        });
      });
    }
  });
  try {
    await completeOnboarding(app);
    app.$("#query-input").value = "I like comedy";
    await app.click("#send-btn");
    check("streamed turn persists the user before completion",
      app.$$("#chat-transcript .chat-msg-user").length === 1);
    check("streamed text stays literal until completion",
      app.$(".chat-turn-response")?.textContent === "**Draft answer**"
        && app.$(".chat-turn-response strong") === null,
      app.$(".chat-turn-response")?.textContent);
    check("attached activity reports the catalog phase",
      /ANALYZING MATCHES/.test(app.text(".chat-turn-status") || ""));

    release();
    await app.settle();
    check("completed streamed reply uses safe Markdown",
      !!app.$(".chat-turn-response strong") && /Final answer/.test(app.text(".chat-turn-response") || ""));
    check("completed turn shows honest metrics",
      /18\.4s · 20 tokens · \$0\.0042 reported/.test(app.text(".chat-turn-metrics") || ""),
      app.text(".chat-turn-metrics"));
    check("ranked rail separates Top pick and Alternatives",
      app.text("#queue-top-pick")?.includes("First Choice")
        && app.text("#queue-alternatives")?.includes("Second Choice")
        && app.text("#queue-alternatives")?.includes("Third Choice"),
      app.text("#queue-track"));
    check("ranked rail exposes Top pick, Alternatives, and More labels",
      app.$("#queue-top-pick .queue-group-title")?.textContent === "Top pick"
        && app.$("#queue-alternatives .queue-group-title")?.textContent === "Alternatives"
        && /Show 2 more/.test(app.text("#queue-more") || ""),
      app.text("#queue-track"));
    check("rail connects its decision to the source query and fit reasons",
      /For “I like comedy”/.test(app.text("#queue-source") || "")
        && /Fit reason 1/.test(app.text("#queue-top-pick") || ""));
    check("more options stay collapsed until requested",
      app.$("#queue-more .queue-group-list").hidden === true
        && /Show 2 more/.test(app.text("#queue-more") || ""));
    await app.click("#queue-more .queue-more-toggle");
    check("more options expand only on request",
      app.$("#queue-more .queue-group-list").hidden === false
        && /Fourth Choice/.test(app.text("#queue-more") || ""));
  } finally {
    app.restore();
  }

  const restored = await bootApp({ storage, records });
  try {
    check("reload restores a completed streamed decision",
      /Final answer/.test(restored.text("#chat-transcript") || "")
        && /First Choice/.test(restored.text("#queue-top-pick") || "")
        && /For “I like comedy”/.test(restored.text("#queue-source") || ""));
  } finally {
    restored.restore();
  }
}

function defaultRecord(id, title) {
  return {
    id, t: title, y: 2023, k: "movie", rt: 100, s: "Fixture synopsis.", im: null,
    r: 8, p: ["netflix"], u: { netflix: "https://example.test/netflix/" + id },
    img: null, l: "en", g: ["Comedy"], v: 12
  };
}

async function followUpContextUsesPriorTurnsAndQueue() {
  const captures = [];
  const storage = createStorage();
  const records = [
    defaultRecord("netflix:first", "First Choice"),
    defaultRecord("netflix:second", "Second Choice")
  ];
  const app = await bootApp({
    storage,
    records,
    agentFixture: async (opts) => {
      captures.push({
        conversation: opts.conversation,
        context: opts.context,
        query: opts.query
      });
      if (captures.length === 1) {
        return {
          ok: true,
          reply: "Try First Choice.",
          queue: [{ id: "netflix:first", reason: "Surreal fit." }],
          memoryCandidates: [],
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, requestCount: 1 },
          billing: { basis: "provider_reported", amountUsd: 0.0042, complete: true, requestCount: 1, pricedRequestCount: 1 },
          timing: { totalMs: 1200, firstTokenMs: 200 }
        };
      }
      return {
        ok: true,
        reply: "Because it matches the surreal mood you asked for.",
        queue: null,
        memoryCandidates: [],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, requestCount: 1 },
        billing: { basis: "provider_reported", amountUsd: 0.0042, complete: true, requestCount: 1, pricedRequestCount: 1 },
        timing: { totalMs: 900, firstTokenMs: 180 }
      };
    }
  });
  try {
    await completeOnboarding(app);
    app.$("#query-input").value = "surreal indian gem";
    await app.click("#send-btn");
    app.$("#query-input").value = "why would I like it?";
    await app.click("#send-btn");
    check("follow-up forwards both prior roles to the agent",
      captures.length === 2
        && captures[1].conversation.length === 2
        && captures[1].conversation[0].content === "surreal indian gem"
        && captures[1].conversation[1].content === "Try First Choice.",
      JSON.stringify(captures[1]?.conversation || []));
    check("follow-up passes the current ranked queue with resolved titles",
      captures[1].context.recommendationQueue?.items?.[0]?.id === "netflix:first"
        && captures[1].context.recommendationQueue.items[0].t === "First Choice",
      JSON.stringify(captures[1]?.context?.recommendationQueue || null));
    check("clarification follow-up leaves the queue unchanged",
      app.text("#queue-top-pick")?.includes("First Choice")
        && captures[1].query === "why would I like it?");
  } finally {
    app.restore();
  }
}

async function failedTurnRollsBackPendingUserMessage() {
  const app = await bootApp({
    agentFixture: async (opts) => {
      opts.onEvent({
        type: "error",
        turnId: opts.turnId,
        code: "network",
        message: "Fixture network failure.",
        retryable: true,
        partialReply: "",
        timing: { totalMs: 2500, firstTokenMs: null }
      });
      return { ok: false, reply: "", queue: null, memoryCandidates: [] };
    }
  });
  try {
    await completeOnboarding(app);
    app.$("#query-input").value = "a thriller";
    await app.click("#send-btn");
    const browserMemory = createBrowserMemory();
    await browserMemory.initialize();
    check("failed turns do not leave dangling user history",
      (await browserMemory.getConversation()).messages.length === 0,
      JSON.stringify((await browserMemory.getConversation()).messages));
    check("failed turns remain visible inline for retry context",
      /a thriller/.test(app.text("#chat-transcript") || "")
        && /Fixture network failure/.test(app.text("#chat-transcript") || ""));
  } finally {
    app.restore();
  }
}

async function stoppedAndFailedTurnsStayInlineAndIgnoreLateEvents() {
  let stale = null;
  const stopped = await bootApp({
    agentFixture: (opts) => {
      stale = opts;
      opts.onEvent({ type: "status", turnId: opts.turnId, phase: "PLANNING", text: "Planning", step: 1 });
      return new Promise(() => {});
    }
  });
  try {
    await completeOnboarding(stopped);
    stopped.$("#query-input").value = "something funny";
    await stopped.click("#send-btn");
    await stopped.click("#stop-btn");
    stale.onEvent({ type: "delta", turnId: stale.turnId, text: "late stale text" });
    await stopped.settle();
    check("Stop keeps cancellation inline and hides the active controls",
      /Stopped\./.test(stopped.text(".chat-turn-error") || "")
        && stopped.$("#stop-btn").hidden
        && !/late stale text/.test(stopped.text("#chat-transcript") || ""));
    const stoppedMemory = createBrowserMemory();
    await stoppedMemory.initialize();
    check("Stop rolls back the pending user message",
      (await stoppedMemory.getConversation()).messages.length === 0,
      JSON.stringify((await stoppedMemory.getConversation()).messages));
    check("Stop does not create a global error banner", stopped.$("#error-banner").hidden);
  } finally {
    stopped.restore();
  }

  const failed = await bootApp({
    agentFixture: async (opts) => {
      opts.onEvent({ type: "status", turnId: opts.turnId, phase: "WRITING", text: "Writing", step: 3 });
      opts.onEvent({
        type: "error", turnId: opts.turnId, code: "network", message: "Fixture network failure.",
        retryable: true, partialReply: "Partial fixture reply", timing: { totalMs: 2500, firstTokenMs: 200 }
      });
      return { ok: false, reply: "", queue: null, memoryCandidates: [] };
    }
  });
  try {
    await completeOnboarding(failed);
    failed.$("#query-input").value = "a thriller";
    await failed.click("#send-btn");
    check("failed streamed turns keep partial text and error inline",
      /Partial fixture reply/.test(failed.text(".chat-turn-response") || "")
        && /Fixture network failure/.test(failed.text(".chat-turn-error") || ""));
    const failedMemory = createBrowserMemory();
    await failedMemory.initialize();
    check("failed streamed turns roll back the pending user message",
      (await failedMemory.getConversation()).messages.length === 0,
      JSON.stringify((await failedMemory.getConversation()).messages));
    check("failed streamed turns do not create a global error banner", failed.$("#error-banner").hidden);
  } finally {
    failed.restore();
  }
}

async function slowStreamShowsAttachedStuckState() {
  let release = null;
  const actualNow = Date.now;
  let actualWindowNow = null;
  let currentNow = actualNow();
  const app = await bootApp({
    agentFixture: (opts) => {
      opts.onEvent({ type: "status", turnId: opts.turnId, phase: "WRITING", text: "Writing", step: 4 });
      return new Promise((resolve) => {
        release = () => resolve({
          ok: true,
          reply: "Finished after the fixture delay.",
          queue: null,
          memoryCandidates: [],
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, requestCount: 1 },
          billing: { basis: "unavailable", amountUsd: null, complete: false, requestCount: 1, pricedRequestCount: 0 },
          timing: { totalMs: 21001, firstTokenMs: null }
        });
      });
    }
  });
  try {
    await completeOnboarding(app);
    Date.now = () => currentNow;
    actualWindowNow = app.window.Date.now;
    app.window.Date.now = () => currentNow;
    app.$("#query-input").value = "a slow fixture";
    await app.click("#send-btn");
    await new Promise((resolve) => app.window.setTimeout(resolve, 1000));
    currentNow += 21001;
    await new Promise((resolve) => app.window.setTimeout(resolve, 650));
    check("slow streamed turns show the attached stuck state without losing Stop",
      /TAKING LONGER THAN USUAL/.test(app.text(".chat-turn-status") || "")
        && !app.$(".chat-turn-stop").hidden,
      (app.text(".chat-turn-status") || "") + " / stop hidden=" + app.$(".chat-turn-stop").hidden);
    release();
    await app.settle();
    check("unpriced successful turns label cost as unavailable",
      /Cost unavailable/.test(app.text(".chat-turn-metrics") || ""));
  } finally {
    Date.now = actualNow;
    if (actualWindowNow) app.window.Date.now = actualWindowNow;
    app.restore();
  }
}

const suites = [
  firstVisitShowsWorkspace,
  phaseFiveStructuralContract,
  legacyOnboardingStaysDormant,
  shellRespectsSubscriptions,
  titleDetailsShareFullCatalogAndRefresh,
  missingPlaylistTitleOpensDetailsTombstone,
  playlistsPersistAcrossReload,
  customPlaylistLifecycleAndExports,
  backupExportIncludesUserState,
  sidebarCollapsePersistsAcrossReload,
  mobileDrawerCloses,
  chatIsGatedWithoutKey,
  conversationsAndLearnedMemoryPersist,
  workerUnavailableKeepsShellAndKeyGate,
  settingsModelPickerSupportsOpenRouterDropdown,
  settingsWebSearchIsScopedToOpenRouter,
  developerSurfaceIsHidden,
  testModeIsLocalhostOnly,
  searchIndexIdleWaitIsBounded,
  streamedTurnRendersDecisionActivityAndMetrics,
  followUpContextUsesPriorTurnsAndQueue,
  failedTurnRollsBackPendingUserMessage,
  stoppedAndFailedTurnsStayInlineAndIgnoreLateEvents,
  slowStreamShowsAttachedStuckState
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
