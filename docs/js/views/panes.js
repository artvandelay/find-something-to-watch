/**
 * Splitter between the chat column and the picks rail.
 *
 * On viewports wider than 900px the visitor can drag #pane-separator (or use
 * ArrowLeft/ArrowRight, Home, End on it) to resize the rail, double-click it
 * to return to the documented default width, and hide the rail entirely with
 * #queue-collapse, restoring it with the #queue-restore edge strip. Width and
 * collapsed state persist through the store; a null width means "the CSS
 * default" (380px, 320px below 1100px), so a reset never resurrects a stale
 * custom width. At or below 900px the stacked layout keeps both panes
 * visible and the splitter stays inert.
 */
export const RAIL_DEFAULT_WIDE = 380; // mirrors --rail-w in app.css
export const RAIL_DEFAULT_NARROW = 320; // mirrors the <=1100px override
export const RAIL_MIN = 280;
export const CHAT_MIN = 360;
export const SEPARATOR_W = 9; // mirrors --separator-w in app.css

const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;

export function paneBounds(availableWidth) {
  const max = Math.max(0, Math.floor(availableWidth) - CHAT_MIN - SEPARATOR_W);
  return { min: Math.min(RAIL_MIN, max), max };
}

export function clampRailWidth(width, bounds) {
  if (!Number.isFinite(width)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)));
}

export function createPaneLayoutView(el, deps) {
  const mobileQuery = window.matchMedia("(max-width: 900px)");
  const narrowQuery = window.matchMedia("(max-width: 1100px)");
  const initial = deps.getLayout() || {};
  let width = Number.isFinite(initial.railWidth) ? initial.railWidth : null;
  let collapsed = initial.railCollapsed === true;

  function defaultWidth() {
    return narrowQuery.matches ? RAIL_DEFAULT_NARROW : RAIL_DEFAULT_WIDE;
  }

  // jsdom reports zero-size boxes, so fall back to the viewport width.
  function availableWidth() {
    const rect = el.workspace.getBoundingClientRect();
    if (rect && rect.width > 0) return rect.width;
    return window.innerWidth || RAIL_MIN + CHAT_MIN + SEPARATOR_W;
  }

  function bounds() {
    return paneBounds(availableWidth());
  }

  function effectiveWidth() {
    return clampRailWidth(width === null ? defaultWidth() : width, bounds());
  }

  function persist() {
    deps.setLayout({ railWidth: width, railCollapsed: collapsed });
  }

  function apply() {
    const mobile = mobileQuery.matches;
    // Collapsing is desktop-only; the stacked layout always shows the rail.
    const active = !mobile && collapsed;
    el.workspace.classList.toggle("queue-collapsed", active);
    el.paneSeparator.hidden = mobile || active;
    el.queueRestore.hidden = mobile || !active;

    if (mobile || width === null) {
      el.workspace.style.removeProperty("--rail-w");
    } else {
      el.workspace.style.setProperty("--rail-w", effectiveWidth() + "px");
    }

    const current = bounds();
    const now = effectiveWidth();
    el.paneSeparator.setAttribute("aria-valuemin", String(current.min));
    el.paneSeparator.setAttribute("aria-valuemax", String(current.max));
    el.paneSeparator.setAttribute("aria-valuenow", String(now));
    el.paneSeparator.setAttribute("aria-valuetext", "Picks panel " + now + " pixels wide");
    el.paneSeparator.setAttribute("aria-disabled", mobile ? "true" : "false");

    const label = active ? "Show picks panel" : "Hide picks panel";
    el.queueCollapse.setAttribute("aria-expanded", active ? "false" : "true");
    el.queueCollapse.setAttribute("aria-label", label);
    el.queueCollapse.title = label;
  }

  function setWidth(next, { save = true } = {}) {
    width = clampRailWidth(next, bounds());
    if (save) persist();
    apply();
  }

  let drag = null;
  el.paneSeparator.addEventListener("pointerdown", (event) => {
    if (mobileQuery.matches || collapsed) return;
    if (event.button !== undefined && event.button > 0) return;
    event.preventDefault();
    drag = { startX: event.clientX, startWidth: effectiveWidth() };
    try {
      if (typeof el.paneSeparator.setPointerCapture === "function") {
        el.paneSeparator.setPointerCapture(event.pointerId);
      }
    } catch (err) {
      // Pointer capture is best-effort; dragging still works without it.
    }
  });
  el.paneSeparator.addEventListener("pointermove", (event) => {
    if (!drag) return;
    // The rail sits on the right, so dragging right narrows it.
    setWidth(drag.startWidth - (event.clientX - drag.startX), { save: false });
  });
  function endDrag() {
    if (!drag) return;
    drag = null;
    persist();
  }
  el.paneSeparator.addEventListener("pointerup", endDrag);
  el.paneSeparator.addEventListener("pointercancel", endDrag);

  el.paneSeparator.addEventListener("dblclick", () => {
    if (mobileQuery.matches) return;
    width = null;
    persist();
    apply();
  });

  el.paneSeparator.addEventListener("keydown", (event) => {
    if (mobileQuery.matches || collapsed) return;
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    let next = null;
    if (event.key === "ArrowLeft") next = effectiveWidth() + step;
    else if (event.key === "ArrowRight") next = effectiveWidth() - step;
    else if (event.key === "Home") next = bounds().min;
    else if (event.key === "End") next = bounds().max;
    if (next === null) return;
    event.preventDefault();
    setWidth(next);
  });

  el.queueCollapse.addEventListener("click", () => {
    collapsed = true;
    persist();
    apply();
    if (!mobileQuery.matches) el.queueRestore.focus();
  });

  el.queueRestore.addEventListener("click", () => {
    collapsed = false;
    persist();
    apply();
    el.queueCollapse.focus();
  });

  window.addEventListener("resize", () => {
    if (!mobileQuery.matches && width !== null) {
      const clamped = effectiveWidth();
      if (clamped !== width) {
        width = clamped;
        persist();
      }
    }
    apply();
  });
  mobileQuery.addEventListener("change", apply);
  narrowQuery.addEventListener("change", apply);

  apply();

  return { apply };
}
