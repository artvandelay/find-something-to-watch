/**
 * Right-bottom recommendation display: a 2x3 grid (6 cards visible) that
 * horizontally pages through up to 20 queued items. Has its own loading and
 * empty states, independent of the chat region's own status note.
 */
export function createQueueView(el, deps) {
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
    if (rec.r !== null && rec.r !== undefined) parts.push("TMDB " + rec.r);
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

  function buildCard(rec) {
    const card = document.createElement("article");
    card.className = "card";
    card.setAttribute("role", "listitem");
    card.appendChild(buildPoster(rec));

    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = rec.t || rec.id || "Untitled";
    body.appendChild(title);

    const meta = metaLine(rec);
    if (meta) body.appendChild(meta);

    const links = linkRow(rec);
    if (links) body.appendChild(links);
    else {
      const noLink = document.createElement("p");
      noLink.className = "card-meta";
      noLink.textContent = "No link available on your subscriptions right now.";
      body.appendChild(noLink);
    }

    card.appendChild(body);
    return card;
  }

  function render(records, emptyText) {
    el.queueTrack.textContent = "";
    if (!records || records.length === 0) {
      el.queueEmpty.hidden = false;
      el.queueEmpty.textContent = emptyText || "Nothing queued yet.";
      el.queueStatus.textContent = "";
      updateControls();
      return;
    }
    el.queueEmpty.hidden = true;
    el.queueStatus.textContent = records.length + " title" + (records.length === 1 ? "" : "s");
    for (const rec of records) el.queueTrack.appendChild(buildCard(rec));
    el.queueViewport.scrollLeft = 0;
    requestAnimationFrame(updateControls);
  }

  function scrollByPage(direction) {
    const width = el.queueViewport.clientWidth;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.queueViewport.scrollBy({
      left: direction * width,
      behavior: reducedMotion ? "auto" : "smooth"
    });
  }

  function updateControls() {
    const max = Math.max(0, el.queueViewport.scrollWidth - el.queueViewport.clientWidth);
    el.queuePrev.disabled = max === 0 || el.queueViewport.scrollLeft <= 1;
    el.queueNext.disabled = max === 0 || el.queueViewport.scrollLeft >= max - 1;
  }

  el.queuePrev.addEventListener("click", () => scrollByPage(-1));
  el.queueNext.addEventListener("click", () => scrollByPage(1));
  el.queueViewport.addEventListener("scroll", updateControls, { passive: true });
  window.addEventListener("resize", updateControls);
  updateControls();

  return { render };
}
