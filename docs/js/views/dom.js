import { providerLabel, subscriptionOffer } from "../providers.js";

function appendProviderOption(container, slug, selectedSet) {
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

export function renderProviderOptions(container, order, selected = [], region = "IN") {
  const picked = Array.isArray(selected) ? selected : [];
  const offer = subscriptionOffer({ region, catalogOrder: order, selected: picked });
  const selectedSet = new Set(picked);
  container.textContent = "";

  const visible = document.createElement("div");
  visible.className = "provider-picks";
  for (const slug of offer.visible) appendProviderOption(visible, slug, selectedSet);
  container.appendChild(visible);

  if (offer.more.length === 0) return;

  const details = document.createElement("details");
  details.className = "provider-more";
  const summary = document.createElement("summary");
  summary.textContent = offer.moreLabel;
  details.appendChild(summary);
  const rest = document.createElement("div");
  rest.className = "provider-picks";
  for (const slug of offer.more) appendProviderOption(rest, slug, selectedSet);
  details.appendChild(rest);
  container.appendChild(details);
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
