import { providerHref, isFreeRecord } from "../providers.js";
import { isUsefulReason } from "../recommendations.js";

/**
 * Right panel ("Your picks"): a vertically scrolling rail of horizontal cards —
 * poster on the left, title/metadata/synopsis/provider links on the right — so
 * roughly six picks are readable at once without paging. Has its own loading
 * and empty states, independent of the chat column's status note.
 */
const SVG_NS = "http://www.w3.org/2000/svg";

// 24px grid, currentColor, 1.8 stroke: the same drawing rules as the nav icons in index.html.
const FEEDBACK_ICONS = {
  like: ["M12 20.2S4.5 15.7 4.5 9.9A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.3c0 5.8-7.5 10.3-7.5 10.3z"],
  pass: ["M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z", "M6 6l12 12"],
  seen: ["M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z", "M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z"],
  tonight: ["M6 6l12 12", "M18 6L6 18"],
  blocked: ["M10.2 13.8a3.6 3.6 0 0 0 5 0l2.6-2.6a3.6 3.6 0 0 0-5-5L11.7 7.3", "M13.8 10.2a3.6 3.6 0 0 0-5 0l-2.6 2.6a3.6 3.6 0 0 0 5 5l1.1-1.1", "M4 4l16 16"]
};

function buildFeedbackIcon(id) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "feedback-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of FEEDBACK_ICONS[id] || []) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  }
  return svg;
}

export function createQueueView(el, deps) {
  let expanded = false;
  let busy = false;

  // One persistent "More" button at the end of the rail. It is a dumb hook: it sends a
  // short chat message through deps.onShowMore. The agent decides what comes back.
  const requestMore = document.createElement("button");
  requestMore.type = "button";
  requestMore.className = "queue-more-request";
  requestMore.textContent = "Ask for more picks";
  requestMore.setAttribute("aria-label", "Ask for more picks");
  requestMore.hidden = true;
  requestMore.addEventListener("click", () => deps.onShowMore?.());
  el.queueTrack.appendChild(requestMore);

  function syncRequestMore(count) {
    requestMore.hidden = !(typeof deps.onShowMore === "function" && count > 0);
    requestMore.disabled = busy;
  }

  function titleInitials(title) {
    const words = String(title || "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    const first = words[0].charAt(0);
    const second = words.length > 1 ? words[1].charAt(0) : "";
    return (first + second).toUpperCase();
  }

  function buildPoster(rec) {
    if (rec.img) {
      const img = document.createElement("img");
      img.className = "card-poster";
      img.src = rec.img;
      img.loading = "lazy";
      img.alt = "";
      return img;
    }
    const fallback = document.createElement("div");
    fallback.className = "poster-fallback";
    fallback.textContent = titleInitials(rec.t || rec.id);
    return fallback;
  }

  function metaLine(rec) {
    if (isFreeRecord(rec)) {
      const kind = rec.k === "podcast" ? "Podcast" : rec.k === "audiobook" ? "Audiobook" : "Film";
      const parts = [kind];
      if (rec.y !== null && rec.y !== undefined) parts.push(String(rec.y));
      const line = document.createElement("p");
      line.className = "card-meta";
      const badge = document.createElement("span");
      badge.className = "badge-free";
      badge.textContent = "Free";
      line.append(badge, document.createTextNode(" · " + parts.join(" · ")));
      return line;
    }
    const parts = [];
    if (rec.y !== null && rec.y !== undefined) parts.push(String(rec.y));
    if (rec.k) parts.push(rec.k);
    if (rec.rt !== null && rec.rt !== undefined) parts.push(rec.rt + " min");
    if (rec.r !== null && rec.r !== undefined) parts.push("★ " + Number(rec.r).toFixed(1));
    if (parts.length === 0) return null;
    const p = document.createElement("p");
    p.className = "card-meta";
    p.textContent = parts.join(" · ");
    return p;
  }

  function linkRow(rec) {
    const u = rec.u;
    if (!u || typeof u !== "object") return null;
    const slugs = Object.keys(u).filter((slug) => u[slug]);
    if (slugs.length === 0) return null;
    const row = document.createElement("div");
    row.className = "card-links";
    for (const slug of slugs) {
      const a = document.createElement("a");
      a.href = providerHref(slug, u[slug]);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = deps.watchCta(slug, u[slug]);
      row.appendChild(a);
    }
    return row;
  }

  function buildCard(rec, rank) {
    const card = document.createElement("article");
    card.className = "card card-rank-" + rank;
    card.setAttribute("role", "listitem");
    card.appendChild(buildPoster(rec));

    const body = document.createElement("div");
    body.className = "card-body";

    const heading = document.createElement("h3");
    heading.className = "card-title";
    const title = document.createElement("button");
    title.type = "button";
    title.className = "card-title-button";
    title.dataset.titleId = rec.id;
    title.textContent = rec.t || rec.id || "Untitled";
    title.addEventListener("click", (event) => {
      event.stopPropagation();
      deps.onOpenTitleDetails?.(rec.id, title);
    });
    heading.appendChild(title);
    body.appendChild(heading);

    const meta = metaLine(rec);
    if (meta) body.appendChild(meta);

    const usefulReason = isUsefulReason(rec.reason) ? String(rec.reason).trim() : "";
    if (usefulReason) {
      const reason = document.createElement("p");
      reason.className = "card-reason";
      reason.textContent = usefulReason;
      body.appendChild(reason);
    } else if (rank === 1 && rec.s) {
      // Top pick keeps one short plot line when the model gave no real reason.
      const description = document.createElement("p");
      description.className = "card-description";
      description.textContent = rec.s;
      body.appendChild(description);
    } else if (rank > 1 && rec.s) {
      const description = document.createElement("p");
      description.className = "card-description card-description-compact";
      description.textContent = rec.s;
      body.appendChild(description);
    }

    const save = document.createElement("button");
    save.type = "button";
    save.className = "card-save";
    save.textContent = "+";
    save.setAttribute("aria-label", "Save " + (rec.t || rec.id || "title") + " to a playlist");
    save.title = "Save to playlist";
    save.setAttribute("aria-haspopup", "dialog");
    save.addEventListener("click", (event) => {
      event.stopPropagation();
      deps.onOpenPlaylistPicker(rec.id, rec.t);
    });
    body.appendChild(save);

    const links = linkRow(rec);
    if (links) body.appendChild(links);
    else {
      const noLink = document.createElement("p");
      noLink.className = "card-meta";
      noLink.textContent = "Not on your subscriptions right now.";
      body.appendChild(noLink);
    }

    const feedback = document.createElement("div");
    feedback.className = "card-feedback";
    feedback.setAttribute("role", "group");
    feedback.setAttribute("aria-label", "Taste feedback for " + (rec.t || rec.id || "title"));
    const actions = [
      { id: "like", label: "More like this" },
      { id: "pass", label: "Not for me" },
      { id: "seen", label: "Already seen" },
      { id: "tonight", label: "Dismiss" }
    ];
    if (isFreeRecord(rec)) actions.push({ id: "blocked", label: "Can't open it" });
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "card-feedback-btn";
      button.dataset.feedback = action.id;
      // Icon only. The full words stay in the accessible name; data-label feeds the CSS tooltip.
      button.setAttribute("aria-label", action.label);
      button.dataset.label = action.label;
      button.appendChild(buildFeedbackIcon(action.id));
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        deps.onFeedback?.(rec.id, action.id, rec);
      });
      feedback.appendChild(button);
    }
    body.appendChild(feedback);

    card.appendChild(body);
    return card;
  }

  function fillSection(group, title, records, startRank) {
    group.textContent = "";
    group.hidden = records.length === 0;
    if (records.length === 0) return;
    const heading = document.createElement("h3");
    heading.className = "queue-group-title";
    heading.textContent = title;
    group.appendChild(heading);
    const list = document.createElement("div");
    list.className = "queue-group-list";
    list.setAttribute("role", "list");
    records.forEach((rec, index) => list.appendChild(buildCard(rec, startRank + index)));
    group.appendChild(list);
  }

  function setCatalogStatus(text) {
    el.catalogStatus.textContent = text;
  }

  let feedbackTimer = 0;

  function setFeedbackNote(text) {
    if (!el.queueFeedback) return;
    const value = typeof text === "string" ? text.trim() : "";
    el.queueFeedback.textContent = value;
    el.queueFeedback.hidden = value === "";
    if (feedbackTimer) window.clearTimeout(feedbackTimer);
    if (value) {
      feedbackTimer = window.setTimeout(() => {
        el.queueFeedback.textContent = "";
        el.queueFeedback.hidden = true;
        feedbackTimer = 0;
      }, 4200);
    }
  }

  // A short rail shows everything. A long one folds after the first few, unless the
  // agent said showAll. The fold follows the queue length; it is not a fixed three.
  const FOLD_WHEN_LONGER_THAN = 6;
  const FOLD_AFTER = 5;

  /**
   * opts.showAll: agent hook, no fold. opts.revealFrom: index of the first title the
   * agent just appended; the fold opens and that card scrolls into view.
   */
  function render(records, emptyText, source = null, opts = {}) {
    const showAll = opts?.showAll === true;
    const revealFrom = Number.isInteger(opts?.revealFrom) ? opts.revealFrom : null;
    expanded = false;
    for (const group of [el.queueTopPick, el.queueAlternatives, el.queueMore]) {
      group.textContent = "";
      group.hidden = true;
    }
    el.queueSource.textContent = "";
    el.queueSource.hidden = true;
    requestMore.hidden = true;
    if (!records || records.length === 0) {
      el.queueEmpty.hidden = false;
      el.queueEmpty.textContent = emptyText || "Nothing queued yet.";
      el.queueStatus.textContent = "";
      return;
    }
    el.queueEmpty.hidden = true;
    el.queueStatus.textContent = records.length + " title" + (records.length === 1 ? "" : "s");
    if (source?.query) {
      el.queueSource.textContent = "For “" + source.query + "”";
      el.queueSource.hidden = false;
    }

    const foldAfter = showAll || records.length <= FOLD_WHEN_LONGER_THAN ? records.length : FOLD_AFTER;
    const top = records.slice(0, 1);
    const alternatives = records.slice(1, 3);
    const more = records.slice(3, foldAfter);
    const folded = records.slice(foldAfter);
    fillSection(el.queueTopPick, "Top pick", top, 1);
    fillSection(el.queueAlternatives, "Alternatives", alternatives, 2);
    if (more.length || folded.length) {
      const group = el.queueMore;
      group.hidden = false;
      if (more.length) {
        const heading = document.createElement("h3");
        heading.className = "queue-group-title";
        heading.textContent = "More picks";
        const list = document.createElement("div");
        list.className = "queue-group-list";
        list.setAttribute("role", "list");
        more.forEach((rec, index) => list.appendChild(buildCard(rec, index + 4)));
        group.append(heading, list);
      }
      if (folded.length) {
        // Appended titles run to the end of the list, so they always reach into the fold.
        expanded = revealFrom !== null;
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "queue-more-toggle";
        const label = () => (expanded ? "Hide more options" : "Show " + folded.length + " more");
        toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
        toggle.textContent = label();
        const list = document.createElement("div");
        list.className = "queue-group-list";
        list.setAttribute("role", "list");
        list.hidden = !expanded;
        folded.forEach((rec, index) => list.appendChild(buildCard(rec, foldAfter + index + 1)));
        toggle.addEventListener("click", () => {
          expanded = !expanded;
          toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
          toggle.textContent = label();
          list.hidden = !expanded;
        });
        group.append(toggle, list);
      }
    }
    syncRequestMore(records.length);
    el.queueViewport.scrollTop = 0;
    if (revealFrom !== null) {
      const cards = el.queueTrack.querySelectorAll(".card");
      cards[Math.min(revealFrom, cards.length - 1)]?.scrollIntoView?.({ block: "start" });
    }
  }

  function renderInline(recs) {
    if (!Array.isArray(recs) || recs.length === 0) return null;
    const list = document.createElement("div");
    list.className = "chat-picks";
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", "Picks from this reply");
    recs.forEach((rec, index) => {
      const card = buildCard(rec, index + 1);
      card.classList.add("card-compact");
      // Same box as the other chat cards. The ticket stub stays on the rail.
      if (index === 0) card.classList.add("card-chat-lead");
      list.appendChild(card);
    });
    return list;
  }

  function setBusy(value) {
    busy = Boolean(value);
    requestMore.disabled = busy;
  }

  return { render, renderInline, setCatalogStatus, setFeedbackNote, setBusy };
}
