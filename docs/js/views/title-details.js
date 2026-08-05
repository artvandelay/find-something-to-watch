/**
 * Shared, catalog-faithful title details dialog. The coordinator owns catalog
 * resolution; this view only renders the frozen details model with DOM nodes.
 */
export function createTitleDetailsView(el, { resolveDetails }) {
  let restoreFocusTo = null;
  let restoreTitleId = "";

  function text(tag, value, className = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  }

  function appendField(parent, label, value) {
    if (value === null || value === undefined || value === "" || value.length === 0) return;
    const row = document.createElement("p");
    row.className = "title-details-meta";
    const strong = text("strong", label + ": ");
    row.append(strong, document.createTextNode(String(value)));
    parent.appendChild(row);
  }

  function appendProviderGroup(parent, heading, providers) {
    const section = document.createElement("section");
    section.className = "title-details-providers";
    section.appendChild(text("h3", heading));
    if (providers.length === 0) {
      section.appendChild(text("p", "None recorded in this catalog snapshot.", "note"));
      parent.appendChild(section);
      return;
    }

    const list = document.createElement("ul");
    for (const provider of providers) {
      const item = document.createElement("li");
      if (provider.url && provider.cta) {
        const link = document.createElement("a");
        link.href = provider.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = provider.cta;
        item.appendChild(link);
      } else {
        item.textContent = provider.label;
      }
      list.appendChild(item);
    }
    section.appendChild(list);
    parent.appendChild(section);
  }

  function renderMissing(model) {
    el.titleDetailsTitle.textContent = "Title unavailable";
    el.titleDetailsContent.appendChild(text(
      "p",
      "This saved title is not present in the current catalog snapshot.",
      "note"
    ));
    appendField(el.titleDetailsContent, "Catalog ID", model.id);
  }

  function renderAvailable(model) {
    const title = model.title;
    el.titleDetailsTitle.textContent = title.t;

    const overview = document.createElement("div");
    overview.className = "title-details-overview";
    if (title.img) {
      const poster = document.createElement("img");
      poster.className = "title-details-poster";
      poster.src = title.img;
      poster.alt = "";
      overview.appendChild(poster);
    }

    const summary = document.createElement("div");
    summary.className = "title-details-summary";
    const typeParts = [];
    if (title.y !== null && title.y !== undefined) typeParts.push(String(title.y));
    if (title.k) typeParts.push(title.k);
    if (title.rt !== null && title.rt !== undefined) typeParts.push(title.rt + " min");
    if (typeParts.length) summary.appendChild(text("p", typeParts.join(" · "), "title-details-meta"));
    if (title.r !== null && title.r !== undefined) {
      const rating = "TMDB " + title.r + (title.v !== null && title.v !== undefined
        ? " · " + title.v + " votes"
        : "");
      summary.appendChild(text("p", rating, "title-details-meta"));
    } else if (title.v !== null && title.v !== undefined) {
      summary.appendChild(text("p", title.v + " votes", "title-details-meta"));
    }
    appendField(summary, "Language", title.l);
    appendField(summary, "Genres", Array.isArray(title.g) ? title.g.join(", ") : "");
    if (title.im) {
      const imdb = document.createElement("a");
      imdb.href = "https://www.imdb.com/title/" + encodeURIComponent(title.im) + "/";
      imdb.target = "_blank";
      imdb.rel = "noopener noreferrer";
      imdb.textContent = "View on IMDb";
      summary.appendChild(imdb);
    }
    overview.appendChild(summary);
    el.titleDetailsContent.appendChild(overview);

    if (title.s) el.titleDetailsContent.appendChild(text("p", title.s, "title-details-synopsis"));

    const availability = Array.isArray(model.availability) ? model.availability : [];
    appendProviderGroup(
      el.titleDetailsContent,
      "On your subscriptions",
      availability.filter((provider) => provider.subscribed)
    );
    appendProviderGroup(
      el.titleDetailsContent,
      "Other known platforms",
      availability.filter((provider) => !provider.subscribed)
    );

    const provenance = document.createElement("section");
    provenance.className = "title-details-provenance";
    provenance.appendChild(text("h3", "Catalog snapshot"));
    appendField(provenance, "Region", model.catalog?.region);
    appendField(provenance, "Source", model.catalog?.source);
    appendField(provenance, "Built", model.catalog?.builtAt);
    el.titleDetailsContent.appendChild(provenance);
  }

  function render(model) {
    el.titleDetailsContent.textContent = "";
    if (!model || model.status !== "available" || !model.title) {
      renderMissing(model || { id: "" });
      return;
    }
    renderAvailable(model);
  }

  function currentModel(id) {
    return typeof resolveDetails === "function"
      ? resolveDetails(String(id || ""))
      : { status: "missing", id: String(id || ""), title: null, availability: [], catalog: {} };
  }

  function open(id, trigger = document.activeElement) {
    if (!el.titleDetailsDialog.open) {
      restoreFocusTo = trigger;
      restoreTitleId = String(id || "");
    }
    el.titleDetailsDialog.dataset.titleId = String(id || "");
    render(currentModel(id));
    if (!el.titleDetailsDialog.open) {
      el.titleDetailsDialog.showModal();
      el.titleDetailsClose.focus();
    }
  }

  function refresh() {
    if (!el.titleDetailsDialog.open) return;
    render(currentModel(el.titleDetailsDialog.dataset.titleId || ""));
  }

  function close() {
    if (el.titleDetailsDialog.open) el.titleDetailsDialog.close();
  }

  function restoreFocus() {
    const trigger = restoreFocusTo;
    restoreFocusTo = null;
    const fallback = [...document.querySelectorAll("[data-title-id]")]
      .find((node) => node.dataset.titleId === restoreTitleId);
    restoreTitleId = "";
    const target = trigger?.isConnected ? trigger : fallback;
    if (target && typeof target.focus === "function") target.focus();
  }

  el.titleDetailsClose.addEventListener("click", close);
  el.titleDetailsDialog.addEventListener("close", restoreFocus);

  return { open, refresh, close };
}
