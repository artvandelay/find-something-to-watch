import { isUsefulReason } from "../recommendations.js";

/**
 * Right panel ("Your picks"): a vertically scrolling rail of horizontal cards —
 * poster on the left, title/metadata/synopsis/provider links on the right — so
 * roughly six picks are readable at once without paging. Has its own loading
 * and empty states, independent of the chat column's status note.
 */
export function createQueueView(el, deps) {
  let expanded = false;

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
      a.href = u[slug];
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
    for (const action of [
      { id: "like", label: "More like this" },
      { id: "pass", label: "Not for me" },
      { id: "seen", label: "Already seen" },
      { id: "tonight", label: "Not tonight" }
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "card-feedback-btn";
      button.dataset.feedback = action.id;
      button.textContent = action.label;
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

  function render(records, emptyText, source = null) {
    expanded = false;
    for (const group of [el.queueTopPick, el.queueAlternatives, el.queueMore]) {
      group.textContent = "";
      group.hidden = true;
    }
    el.queueSource.textContent = "";
    el.queueSource.hidden = true;
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

    const top = records.slice(0, 1);
    const alternatives = records.slice(1, 3);
    const more = records.slice(3);
    fillSection(el.queueTopPick, "Top pick", top, 1);
    fillSection(el.queueAlternatives, "Alternatives", alternatives, 2);
    if (more.length) {
      const group = el.queueMore;
      group.hidden = false;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "queue-more-toggle";
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggle.textContent = expanded ? "Hide more options" : "Show " + more.length + " more";
      const list = document.createElement("div");
      list.className = "queue-group-list";
      list.setAttribute("role", "list");
      list.hidden = !expanded;
      more.forEach((rec, index) => list.appendChild(buildCard(rec, index + 4)));
      toggle.addEventListener("click", () => {
        expanded = !expanded;
        toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
        toggle.textContent = expanded ? "Hide more options" : "Show " + more.length + " more";
        list.hidden = !expanded;
      });
      group.append(toggle, list);
    }
    el.queueViewport.scrollTop = 0;
  }

  return { render, setCatalogStatus, setFeedbackNote };
}
