import {
  filterModelGroups,
  findModelInGroups,
  formatContextLength,
  formatPricingSuffix,
  formatReasoningBadge
} from "../openrouter-models.js";

export function createModelPicker(el) {
  let groups = { recommended: [], popular: [] };
  let selectedId = "";
  let customMode = false;
  let open = false;
  let query = "";
  let activeId = "";
  let activeRow = null;

  function getValue() {
    if (customMode) return String(el.llmModelCustom?.value || "").trim();
    return String(selectedId || "").trim();
  }

  function setCustomVisible(visible) {
    el.llmModelCustom.hidden = !visible;
    el.llmModelCustom.disabled = !visible;
  }

  function modelMeta(model) {
    return {
      badge: formatReasoningBadge(model) || model.note || "",
      price: formatPricingSuffix(model.pricing)
    };
  }

  function updateTrigger() {
    const nameEl = el.llmModelTriggerName;
    const metaEl = el.llmModelTriggerMeta;

    if (customMode) {
      const custom = el.llmModelCustom.value.trim();
      nameEl.textContent = custom || "Other model ID…";
      metaEl.textContent = custom ? "custom" : "";
      return;
    }

    const model = findModelInGroups(groups, selectedId);
    if (model) {
      nameEl.textContent = model.name;
      metaEl.textContent = Object.values(modelMeta(model)).filter(Boolean).join(" · ");
      return;
    }

    if (selectedId) {
      nameEl.textContent = selectedId;
      metaEl.textContent = "custom";
      return;
    }

    nameEl.textContent = "Choose a model";
    metaEl.textContent = "";
  }

  function renderDetail(model) {
    const detail = el.llmModelDetail;
    detail.textContent = "";
    if (!model) {
      const empty = document.createElement("p");
      empty.className = "model-picker-detail-empty";
      empty.textContent = "Hover a model for details.";
      detail.appendChild(empty);
      return;
    }

    const title = document.createElement("h3");
    title.className = "model-picker-detail-title";
    title.textContent = model.name;
    detail.appendChild(title);

    if (model.note) {
      const note = document.createElement("p");
      note.className = "model-picker-detail-note";
      note.textContent = model.note;
      detail.appendChild(note);
    }

    if (model.description) {
      const description = document.createElement("p");
      description.className = "model-picker-detail-body";
      description.textContent = model.description;
      detail.appendChild(description);
    }

    const specs = document.createElement("ul");
    specs.className = "model-picker-detail-specs";
    const context = formatContextLength(model.contextLength);
    const price = formatPricingSuffix(model.pricing);
    const reasoning = formatReasoningBadge(model);
    for (const [label, value] of [
      ["Context", context],
      ["Price", price ? price + " per 1M tokens" : ""],
      ["Reasoning", reasoning ? "Supported" + (reasoning !== "reasoning" ? ` · default ${reasoning}` : "") : "Not indicated"]
    ]) {
      if (!value) continue;
      const item = document.createElement("li");
      const key = document.createElement("span");
      key.textContent = label;
      const val = document.createElement("span");
      val.textContent = value;
      item.append(key, val);
      specs.appendChild(item);
    }
    if (specs.childElementCount > 0) detail.appendChild(specs);

    const slug = document.createElement("p");
    slug.className = "model-picker-detail-slug";
    slug.textContent = model.id;
    detail.appendChild(slug);
  }

  function createRow(model) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "model-picker-option";
    row.setAttribute("role", "option");
    row.dataset.modelId = model.id;
    row.setAttribute("aria-selected", model.id === selectedId && !customMode ? "true" : "false");
    if (model.id === selectedId && !customMode) row.classList.add("is-selected");
    if (model.id === activeId) row.classList.add("is-active");

    const main = document.createElement("span");
    main.className = "model-picker-option-main";
    const name = document.createElement("span");
    name.className = "model-picker-option-name";
    name.textContent = model.name;
    main.appendChild(name);
    if (model.note) {
      const note = document.createElement("span");
      note.className = "model-picker-option-note";
      note.textContent = model.note;
      main.appendChild(note);
    }

    const meta = document.createElement("span");
    meta.className = "model-picker-option-meta";
    const { badge, price } = modelMeta(model);
    if (badge) {
      const badgeEl = document.createElement("span");
      badgeEl.className = "model-picker-badge";
      badgeEl.textContent = badge;
      meta.appendChild(badgeEl);
    }
    if (price) {
      const priceEl = document.createElement("span");
      priceEl.className = "model-picker-price";
      priceEl.textContent = price;
      meta.appendChild(priceEl);
    }

    row.append(main, meta);

    function activate() {
      if (activeId === model.id && activeRow === row) return;
      activeRow?.classList.remove("is-active");
      activeId = model.id;
      activeRow = row;
      row.classList.add("is-active");
      renderDetail(model);
    }
    row.addEventListener("mouseenter", activate);
    row.addEventListener("focus", activate);
    row.addEventListener("click", () => {
      selectedId = model.id;
      customMode = false;
      setCustomVisible(false);
      closePanel();
      updateTrigger();
    });

    return row;
  }

  function renderList() {
    const list = el.llmModelList;
    list.textContent = "";
    activeRow = null;
    const filtered = filterModelGroups(groups, query);
    const sections = [
      ["Recommended", filtered.recommended],
      ["Popular on OpenRouter", filtered.popular]
    ];
    let count = 0;
    for (const [label, items] of sections) {
      if (!items.length) continue;
      const heading = document.createElement("div");
      heading.className = "model-picker-group";
      heading.textContent = label;
      list.appendChild(heading);
      for (const item of items) {
        list.appendChild(createRow(item));
        count += 1;
      }
    }
    if (count === 0) {
      const empty = document.createElement("p");
      empty.className = "model-picker-empty";
      empty.textContent = query ? "No models match that search." : "No models available yet.";
      list.appendChild(empty);
      renderDetail(null);
      return;
    }
    const active = findModelInGroups(filtered, activeId)
      || findModelInGroups(filtered, selectedId)
      || filtered.recommended[0]
      || filtered.popular[0]
      || null;
    activeId = active?.id || "";
    renderDetail(active);
  }

  function openPanel() {
    open = true;
    el.llmModelPanel.hidden = false;
    el.llmModelTrigger.setAttribute("aria-expanded", "true");
    el.llmModelPicker.classList.add("is-open");
    renderList();
    queueMicrotask(() => el.llmModelSearch.focus());
  }

  function closePanel() {
    open = false;
    el.llmModelPanel.hidden = true;
    el.llmModelTrigger.setAttribute("aria-expanded", "false");
    el.llmModelPicker.classList.remove("is-open");
    el.llmModelSearch.value = query = "";
  }

  function togglePanel() {
    if (open) closePanel();
    else openPanel();
  }

  function setGroups(nextGroups, { selectedModel = "" } = {}) {
    groups = {
      recommended: Array.isArray(nextGroups?.recommended) ? nextGroups.recommended : [],
      popular: Array.isArray(nextGroups?.popular) ? nextGroups.popular : []
    };
    const saved = String(selectedModel || "").trim();
    const known = findModelInGroups(groups, saved);
    if (known) {
      selectedId = known.id;
      customMode = false;
      setCustomVisible(false);
    } else if (saved) {
      selectedId = "";
      customMode = true;
      el.llmModelCustom.value = saved;
      setCustomVisible(true);
    } else if (groups.recommended[0]) {
      selectedId = groups.recommended[0].id;
      customMode = false;
      setCustomVisible(false);
    } else {
      selectedId = "";
      customMode = true;
      setCustomVisible(true);
    }
    activeId = selectedId || groups.recommended[0]?.id || groups.popular[0]?.id || "";
    updateTrigger();
    if (open) renderList();
  }

  function wire() {
    el.llmModelTrigger.addEventListener("click", () => togglePanel());
    el.llmModelSearch.addEventListener("input", () => {
      query = el.llmModelSearch.value || "";
      renderList();
    });
    el.llmModelOther.addEventListener("click", () => {
      customMode = true;
      selectedId = "";
      setCustomVisible(true);
      closePanel();
      updateTrigger();
      queueMicrotask(() => el.llmModelCustom.focus());
    });
    el.llmModelCustom.addEventListener("input", () => {
      if (!customMode) return;
      updateTrigger();
    });
    document.addEventListener("click", (event) => {
      if (!open) return;
      if (el.llmModelPicker.contains(event.target)) return;
      closePanel();
    });
    document.addEventListener("keydown", (event) => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
        el.llmModelTrigger.focus();
      }
    });
  }

  wire();
  setCustomVisible(false);
  updateTrigger();
  renderDetail(null);

  return {
    setGroups,
    getValue,
    close: closePanel,
    isCustomMode() {
      return customMode;
    }
  };
}
