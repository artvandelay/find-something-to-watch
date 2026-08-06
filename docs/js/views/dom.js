import { providerLabel } from "../providers.js";

export function renderProviderOptions(container, order, selected = []) {
  container.textContent = "";
  const selectedSet = new Set(selected);
  for (const slug of order) {
    const wrap = document.createElement("label");
    wrap.className = "provider-opt";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = slug;
    input.checked = selectedSet.has(slug);
    wrap.appendChild(input);

    const text = document.createElement("span");
    text.textContent = providerLabel(slug);
    wrap.appendChild(text);
    container.appendChild(wrap);
  }
}

export function selectedProviders(container) {
  return Array.from(container.querySelectorAll("input:checked"), (input) => input.value);
}

function savedSelection(container) {
  try {
    const parsed = JSON.parse(container.dataset.selectedProviders || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string" && value) : []);
  } catch {
    return new Set();
  }
}

/**
 * A compact, searchable multi-select for Settings. Unlike onboarding's static
 * checkbox list, this keeps the full catalog behind an explicit "Add services"
 * control and displays chosen providers as removable chips.
 */
export function renderSubscriptionPicker(container, order, selected = []) {
  container.textContent = "";
  const choices = Array.from(new Set(Array.isArray(order) ? order.filter(Boolean) : []));
  const selectedSet = new Set((Array.isArray(selected) ? selected : []).filter((slug) => choices.includes(slug)));
  let panelOpen = false;

  const controls = document.createElement("div");
  controls.className = "subscription-picker-controls";

  const summary = document.createElement("p");
  summary.className = "subscription-picker-summary";
  controls.appendChild(summary);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "subscription-picker-trigger";
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", "settings-provider-options");
  trigger.textContent = "Add services";
  controls.appendChild(trigger);
  container.appendChild(controls);

  const selectedList = document.createElement("div");
  selectedList.className = "subscription-picker-selected";
  selectedList.setAttribute("aria-label", "Selected subscriptions");
  container.appendChild(selectedList);

  const panel = document.createElement("div");
  panel.id = "settings-provider-options";
  panel.className = "subscription-picker-panel";
  panel.hidden = true;

  const search = document.createElement("input");
  search.type = "search";
  search.className = "subscription-picker-search";
  search.placeholder = "Search streaming services";
  search.autocomplete = "off";
  search.setAttribute("aria-label", "Search streaming services");
  panel.appendChild(search);

  const options = document.createElement("div");
  options.className = "subscription-picker-options";
  options.setAttribute("role", "listbox");
  options.setAttribute("aria-label", "Streaming services");
  options.setAttribute("aria-multiselectable", "true");
  panel.appendChild(options);
  container.appendChild(panel);

  function persistSelection() {
    container.dataset.selectedProviders = JSON.stringify(choices.filter((slug) => selectedSet.has(slug)));
  }

  function renderSelection() {
    persistSelection();
    selectedList.textContent = "";
    summary.textContent = selectedSet.size === 0
      ? "No services selected"
      : selectedSet.size + " service" + (selectedSet.size === 1 ? "" : "s") + " selected";
    if (selectedSet.size === 0) return;
    for (const slug of choices) {
      if (!selectedSet.has(slug)) continue;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "subscription-chip";
      chip.textContent = providerLabel(slug);
      chip.setAttribute("aria-label", "Remove " + providerLabel(slug));
      chip.title = "Remove " + providerLabel(slug);
      chip.addEventListener("click", () => {
        selectedSet.delete(slug);
        renderSelection();
        renderOptions();
      });
      selectedList.appendChild(chip);
    }
  }

  function renderOptions() {
    const query = search.value.trim().toLocaleLowerCase();
    options.textContent = "";
    const filtered = choices.filter((slug) => providerLabel(slug).toLocaleLowerCase().includes(query));
    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "subscription-picker-empty";
      empty.textContent = "No matching services.";
      options.appendChild(empty);
      return;
    }
    for (const slug of filtered) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "subscription-option";
      option.setAttribute("role", "option");
      option.dataset.providerSlug = slug;
      const isSelected = selectedSet.has(slug);
      option.setAttribute("aria-selected", isSelected ? "true" : "false");
      option.setAttribute("aria-pressed", isSelected ? "true" : "false");
      option.classList.toggle("is-selected", isSelected);

      const label = document.createElement("span");
      label.textContent = providerLabel(slug);
      option.appendChild(label);

      const mark = document.createElement("span");
      mark.className = "subscription-option-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = isSelected ? "Selected" : "";
      option.appendChild(mark);

      option.addEventListener("click", () => {
        if (selectedSet.has(slug)) selectedSet.delete(slug);
        else selectedSet.add(slug);
        renderSelection();
        renderOptions();
      });
      options.appendChild(option);
    }
  }

  function setPanelOpen(nextOpen) {
    panelOpen = nextOpen;
    panel.hidden = !panelOpen;
    trigger.setAttribute("aria-expanded", panelOpen ? "true" : "false");
    trigger.textContent = panelOpen ? "Done" : "Add services";
    if (panelOpen) {
      renderOptions();
      queueMicrotask(() => search.focus());
    }
  }

  trigger.addEventListener("click", () => setPanelOpen(!panelOpen));
  search.addEventListener("input", renderOptions);
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setPanelOpen(false);
    trigger.focus();
  });

  renderSelection();
  renderOptions();
}

export function selectedSubscriptionProviders(container) {
  return Array.from(savedSelection(container));
}

export function downloadText(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function isAbsoluteHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
