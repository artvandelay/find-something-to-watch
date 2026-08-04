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
