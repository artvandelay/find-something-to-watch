import { bootApp, createStorage } from "./harness/app.mjs";
import {
  paneBounds,
  clampRailWidth,
  RAIL_MIN,
  CHAT_MIN,
  SEPARATOR_W,
  RAIL_DEFAULT_WIDE
} from "../docs/js/views/panes.js";

let passed = 0;
let failed = 0;

function toggleSubscription(app, provider) {
  const option = app.$("#settings-provider-list [data-provider-slug=" + provider + "]");
  if (!option) throw new Error("Missing subscription option: " + provider);
  option.click();
}

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log("PASS - " + name);
    return;
  }
  failed += 1;
  console.log("FAIL - " + name + (detail === undefined ? "" : "\n       " + detail));
}

async function completeOnboarding(app, provider = "netflix") {
  await app.click("#settings-btn");
  toggleSubscription(app, provider);
  app.$("#llm-api-key").value = "sk-test";
  await app.click("#settings-save");
}

function pressKey(app, key, { shiftKey = false } = {}) {
  app.$("#pane-separator").dispatchEvent(new app.window.KeyboardEvent("keydown", {
    key, shiftKey, bubbles: true, cancelable: true
  }));
}

function railStyle(app) {
  return app.$("#workspace").style.getPropertyValue("--rail-w");
}

function storedLayout(app) {
  return JSON.parse(app.window.localStorage.getItem("ottbyok.pane.v1") || "null");
}

// jsdom lays nothing out, so bounds derive from the window's 1024px fallback.
const VIEWPORT = 1024;
const RAIL_MAX = VIEWPORT - CHAT_MIN - SEPARATOR_W;

function boundsMathHoldsUp() {
  const bounds = paneBounds(VIEWPORT);
  check("bounds leave room for the chat minimum and the separator",
    bounds.min === RAIL_MIN && bounds.max === RAIL_MAX,
    JSON.stringify(bounds));
  check("tiny viewports never produce negative or inverted bounds",
    (() => {
      const tiny = paneBounds(200);
      return tiny.max === 0 && tiny.min === 0 && tiny.min <= tiny.max;
    })(),
    JSON.stringify(paneBounds(200)));
  check("clamping keeps widths inside the bounds",
    clampRailWidth(5000, bounds) === RAIL_MAX
      && clampRailWidth(10, bounds) === RAIL_MIN
      && clampRailWidth(400.4, bounds) === 400
      && clampRailWidth(NaN, bounds) === RAIL_MIN);
}

async function separatorExposesSplitterSemantics() {
  const app = await bootApp();
  try {
    await completeOnboarding(app);
    const separator = app.$("#pane-separator");
    check("the separator is a focusable vertical splitter",
      separator.getAttribute("role") === "separator"
        && separator.getAttribute("tabindex") === "0"
        && separator.getAttribute("aria-orientation") === "vertical"
        && (separator.getAttribute("aria-label") || "").length > 0);
    check("the separator announces the default rail width and its range",
      separator.getAttribute("aria-valuenow") === String(RAIL_DEFAULT_WIDE)
        && separator.getAttribute("aria-valuemin") === String(RAIL_MIN)
        && separator.getAttribute("aria-valuemax") === String(RAIL_MAX),
      separator.getAttribute("aria-valuenow") + " within "
        + separator.getAttribute("aria-valuemin") + ".." + separator.getAttribute("aria-valuemax"));
    check("the separator has an accessible value description",
      /pixels wide/.test(separator.getAttribute("aria-valuetext") || ""));
    check("the default layout sets no inline rail width", railStyle(app) === "");
    check("the rail starts expanded with a labelled collapse control",
      !app.$("#workspace").classList.contains("queue-collapsed")
        && app.$("#queue-collapse").getAttribute("aria-expanded") === "true"
        && /hide picks/i.test(app.$("#queue-collapse").getAttribute("aria-label") || ""));
    check("the restore strip starts hidden", app.$("#queue-restore").hidden === true);
  } finally {
    app.restore();
  }
}

async function keyboardResizingPersistsAndClamps() {
  const storage = createStorage();
  const app = await bootApp({ storage });
  try {
    await completeOnboarding(app);

    pressKey(app, "ArrowLeft");
    check("ArrowLeft widens the rail one step",
      railStyle(app) === (RAIL_DEFAULT_WIDE + 16) + "px", railStyle(app));
    check("the resize persists to scoped versioned storage",
      storedLayout(app)?.railWidth === RAIL_DEFAULT_WIDE + 16,
      JSON.stringify(storedLayout(app)));
    check("aria-valuenow tracks the resize",
      app.$("#pane-separator").getAttribute("aria-valuenow") === String(RAIL_DEFAULT_WIDE + 16));

    pressKey(app, "ArrowRight", { shiftKey: true });
    check("Shift+ArrowRight narrows the rail by a large step",
      railStyle(app) === (RAIL_DEFAULT_WIDE + 16 - 64) + "px", railStyle(app));

    pressKey(app, "Home");
    check("Home jumps to the minimum rail width", railStyle(app) === RAIL_MIN + "px", railStyle(app));
    pressKey(app, "End");
    check("End jumps to the widest the viewport allows", railStyle(app) === RAIL_MAX + "px", railStyle(app));
    pressKey(app, "End");
    check("resizing clamps at the maximum", railStyle(app) === RAIL_MAX + "px");
    pressKey(app, "ArrowRight", { shiftKey: true });
    pressKey(app, "ArrowRight", { shiftKey: true });
    pressKey(app, "ArrowRight", { shiftKey: true });
    pressKey(app, "ArrowRight", { shiftKey: true });
    pressKey(app, "ArrowRight", { shiftKey: true });
    pressKey(app, "ArrowRight", { shiftKey: true });
    pressKey(app, "ArrowRight", { shiftKey: true });
    pressKey(app, "ArrowRight", { shiftKey: true });
    pressKey(app, "ArrowRight", { shiftKey: true });
    check("repeated narrowing clamps at the minimum",
      railStyle(app) === RAIL_MIN + "px", railStyle(app));
  } finally {
    app.restore();
  }

  const second = await bootApp({ storage });
  try {
    check("the keyboard-chosen width survives a reload",
      railStyle(second) === RAIL_MIN + "px", railStyle(second));
  } finally {
    second.restore();
  }
}

async function pointerDraggingResizes() {
  const app = await bootApp();
  try {
    await completeOnboarding(app);
    const separator = app.$("#pane-separator");
    separator.dispatchEvent(new app.window.MouseEvent("pointerdown", {
      bubbles: true, cancelable: true, clientX: 600, button: 0
    }));
    separator.dispatchEvent(new app.window.MouseEvent("pointermove", {
      bubbles: true, clientX: 500
    }));
    check("dragging left widens the rail by the drag distance",
      railStyle(app) === (RAIL_DEFAULT_WIDE + 100) + "px", railStyle(app));
    check("mid-drag changes are not persisted yet",
      storedLayout(app) === null, JSON.stringify(storedLayout(app)));
    separator.dispatchEvent(new app.window.MouseEvent("pointerup", { bubbles: true, clientX: 500 }));
    check("releasing the drag persists the final width",
      storedLayout(app)?.railWidth === RAIL_DEFAULT_WIDE + 100,
      JSON.stringify(storedLayout(app)));

    separator.dispatchEvent(new app.window.MouseEvent("pointerdown", {
      bubbles: true, cancelable: true, clientX: 100, button: 0
    }));
    separator.dispatchEvent(new app.window.MouseEvent("pointermove", {
      bubbles: true, clientX: -5000
    }));
    check("dragging past the chat minimum clamps the rail",
      railStyle(app) === RAIL_MAX + "px", railStyle(app));
    separator.dispatchEvent(new app.window.MouseEvent("pointerup", { bubbles: true }));
  } finally {
    app.restore();
  }
}

async function doubleClickRestoresDocumentedDefault() {
  const app = await bootApp();
  try {
    await completeOnboarding(app);
    pressKey(app, "ArrowRight", { shiftKey: true });
    check("setup: the rail has a custom width",
      railStyle(app) === (RAIL_DEFAULT_WIDE - 64) + "px", railStyle(app));

    app.$("#pane-separator").dispatchEvent(new app.window.MouseEvent("dblclick", { bubbles: true }));
    check("double-click clears the custom width back to the CSS default",
      railStyle(app) === "", railStyle(app));
    check("double-click announces the documented default width",
      app.$("#pane-separator").getAttribute("aria-valuenow") === String(RAIL_DEFAULT_WIDE),
      app.$("#pane-separator").getAttribute("aria-valuenow"));
    check("the reset persists a null (default) width",
      storedLayout(app)?.railWidth === null, JSON.stringify(storedLayout(app)));

    pressKey(app, "ArrowLeft");
    check("resizing after a reset starts from the documented default",
      railStyle(app) === (RAIL_DEFAULT_WIDE + 16) + "px", railStyle(app));
  } finally {
    app.restore();
  }
}

async function collapseAndRestorePersist() {
  const storage = createStorage();
  const first = await bootApp({ storage });
  try {
    await completeOnboarding(first);
    await first.click("#queue-collapse");
    check("collapsing marks the workspace and swaps the controls",
      first.$("#workspace").classList.contains("queue-collapsed")
        && first.$("#queue-restore").hidden === false
        && first.$("#pane-separator").hidden === true);
    check("the collapse control reports the collapsed state",
      first.$("#queue-collapse").getAttribute("aria-expanded") === "false"
        && /show picks/i.test(first.$("#queue-collapse").getAttribute("aria-label") || ""));
    check("the restore strip is clearly labelled",
      /show picks/i.test(first.$("#queue-restore").getAttribute("aria-label") || ""));
    check("collapsing persists without dropping the chosen width",
      storedLayout(first)?.railCollapsed === true
        && storedLayout(first)?.railWidth === null,
      JSON.stringify(storedLayout(first)));
    check("collapsing moves focus to the restore control",
      first.document.activeElement === first.$("#queue-restore"));
  } finally {
    first.restore();
  }

  const second = await bootApp({ storage });
  try {
    check("a returning visitor keeps the collapsed rail",
      second.$("#workspace").classList.contains("queue-collapsed")
        && second.$("#queue-restore").hidden === false);

    pressKey(second, "ArrowLeft");
    check("keyboard resizing is inert while collapsed",
      railStyle(second) === "", railStyle(second));

    await second.click("#queue-restore");
    check("restoring brings back the rail and the separator",
      !second.$("#workspace").classList.contains("queue-collapsed")
        && second.$("#queue-restore").hidden === true
        && second.$("#pane-separator").hidden === false);
    check("restoring persists the expanded state",
      storedLayout(second)?.railCollapsed === false);
    check("restoring returns focus to the collapse control",
      second.document.activeElement === second.$("#queue-collapse"));
  } finally {
    second.restore();
  }
}

async function persistedValuesAreClampedOnBoot() {
  const storage = createStorage();
  storage.local.set("ottbyok.pane.v1", JSON.stringify({ railWidth: 5000, railCollapsed: false }));
  const wide = await bootApp({ storage });
  try {
    await completeOnboarding(wide);
    check("an over-wide persisted width clamps to the viewport bounds",
      railStyle(wide) === RAIL_MAX + "px", railStyle(wide));
  } finally {
    wide.restore();
  }

  const broken = createStorage();
  broken.local.set("ottbyok.pane.v1", "{corrupt");
  const app = await bootApp({ storage: broken });
  try {
    await completeOnboarding(app);
    check("corrupt persisted state falls back to the default layout",
      railStyle(app) === ""
        && app.$("#pane-separator").getAttribute("aria-valuenow") === String(RAIL_DEFAULT_WIDE)
        && !app.$("#workspace").classList.contains("queue-collapsed"));
  } finally {
    app.restore();
  }
}

async function mobileLayoutKeepsBothPanes() {
  const storage = createStorage();
  storage.local.set("ottbyok.pane.v1", JSON.stringify({ railWidth: 600, railCollapsed: true }));
  const app = await bootApp({ storage, mobile: true });
  try {
    await completeOnboarding(app);
    check("mobile ignores the collapsed state and keeps the rail",
      !app.$("#workspace").classList.contains("queue-collapsed")
        && app.$("#queue-restore").hidden === true);
    check("mobile disables the splitter",
      app.$("#pane-separator").hidden === true
        && app.$("#pane-separator").getAttribute("aria-disabled") === "true");
    check("mobile never applies an inline rail width", railStyle(app) === "");

    pressKey(app, "ArrowLeft");
    check("keyboard resizing is inert on mobile", railStyle(app) === "");

    await app.setMobile(false);
    check("returning to desktop restores the persisted collapsed layout",
      app.$("#workspace").classList.contains("queue-collapsed")
        && app.$("#queue-restore").hidden === false);
    await app.click("#queue-restore");
    check("the persisted width applies once back on desktop",
      railStyle(app) === "600px", railStyle(app));

    await app.setMobile(true);
    check("switching to mobile clears the collapsed presentation again",
      !app.$("#workspace").classList.contains("queue-collapsed")
        && app.$("#pane-separator").hidden === true);
  } finally {
    app.restore();
  }
}

async function viewportResizeReclampsWidth() {
  const app = await bootApp();
  try {
    await completeOnboarding(app);
    pressKey(app, "End");
    check("setup: the rail sits at the viewport maximum",
      railStyle(app) === RAIL_MAX + "px", railStyle(app));
    app.window.dispatchEvent(new app.window.Event("resize"));
    await app.settle();
    check("a viewport resize recomputes and re-clamps the width",
      railStyle(app) === RAIL_MAX + "px"
        && app.$("#pane-separator").getAttribute("aria-valuemax") === String(RAIL_MAX));
  } finally {
    app.restore();
  }
}

const suites = [
  boundsMathHoldsUp,
  separatorExposesSplitterSemantics,
  keyboardResizingPersistsAndClamps,
  pointerDraggingResizes,
  doubleClickRestoresDocumentedDefault,
  collapseAndRestorePersist,
  persistedValuesAreClampedOnBoot,
  mobileLayoutKeepsBothPanes,
  viewportResizeReclampsWidth
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
