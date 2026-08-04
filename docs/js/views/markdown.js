const MAX_INPUT_LENGTH = 20_000;
const MAX_BLOCKS = 250;
const MAX_LIST_ITEMS = 250;
const MAX_INLINE_DEPTH = 8;
const MAX_INLINE_NODES = 2_000;

function appendText(children, value) {
  if (!value) return;
  const previous = children[children.length - 1];
  if (previous && previous.type === "text") {
    previous.value += value;
    return;
  }
  children.push({ type: "text", value });
}

function findClosing(source, marker, start, singleMarker) {
  let index = source.indexOf(marker, start);
  while (index !== -1) {
    if (!singleMarker || (source[index - 1] !== "*" && source[index + 1] !== "*")) return index;
    index = source.indexOf(marker, index + marker.length);
  }
  return -1;
}

function parseInline(source, depth, budget) {
  const children = [];
  let cursor = 0;

  while (cursor < source.length) {
    if (budget.nodes >= MAX_INLINE_NODES) {
      appendText(children, source.slice(cursor));
      break;
    }

    const char = source[cursor];
    const marker = char === "`" ? "`" : source.startsWith("**", cursor) ? "**" : char === "*" ? "*" : "";
    if (!marker) {
      const next = source.slice(cursor + 1).search(/[`*]/);
      const end = next === -1 ? source.length : cursor + next + 1;
      appendText(children, source.slice(cursor, end));
      cursor = end;
      continue;
    }

    const close = findClosing(source, marker, cursor + marker.length, marker === "*");
    if (close === -1 || close === cursor + marker.length) {
      appendText(children, marker);
      cursor += marker.length;
      continue;
    }

    const value = source.slice(cursor + marker.length, close);
    if (marker === "`") {
      children.push({ type: "code", value });
    } else if (depth >= MAX_INLINE_DEPTH) {
      appendText(children, source.slice(cursor, close + marker.length));
    } else {
      children.push({
        type: marker === "**" ? "strong" : "emphasis",
        children: parseInline(value, depth + 1, budget)
      });
    }
    budget.nodes += 1;
    cursor = close + marker.length;
  }

  return children;
}

function listMatch(line) {
  const unordered = line.match(/^\s{0,3}[-+*]\s+(.+)$/);
  if (unordered) return { ordered: false, content: unordered[1] };
  const ordered = line.match(/^\s{0,3}\d+[.)]\s+(.+)$/);
  if (ordered) return { ordered: true, content: ordered[1] };
  return null;
}

/**
 * Parse the small, deliberately safe Markdown subset accepted from the agent.
 * The result contains only document, paragraph, list, listItem, text, strong,
 * emphasis, and code nodes.
 */
export function parseMarkdown(value) {
  const raw = String(value ?? "").replace(/\r\n?/g, "\n");
  const source = raw.length > MAX_INPUT_LENGTH ? raw.slice(0, MAX_INPUT_LENGTH) + "\n\n…" : raw;
  const lines = source.split("\n");
  const children = [];
  const budget = { nodes: 0 };
  let lineIndex = 0;

  while (lineIndex < lines.length && children.length < MAX_BLOCKS) {
    if (lines[lineIndex].trim() === "") {
      lineIndex += 1;
      continue;
    }

    const firstListItem = listMatch(lines[lineIndex]);
    if (firstListItem) {
      const items = [];
      const ordered = firstListItem.ordered;
      while (lineIndex < lines.length && items.length < MAX_LIST_ITEMS) {
        const item = listMatch(lines[lineIndex]);
        if (!item || item.ordered !== ordered) break;
        items.push({ type: "listItem", children: parseInline(item.content, 0, budget) });
        lineIndex += 1;
      }
      children.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines = [];
    while (lineIndex < lines.length && lines[lineIndex].trim() !== "" && !listMatch(lines[lineIndex])) {
      paragraphLines.push(lines[lineIndex]);
      lineIndex += 1;
    }
    children.push({ type: "paragraph", children: parseInline(paragraphLines.join(" "), 0, budget) });
  }

  if (lineIndex < lines.length) {
    children.push({ type: "paragraph", children: [{ type: "text", value: "…" }] });
  }

  return { type: "document", children };
}

function renderInline(nodes, documentLike) {
  const fragment = documentLike.createDocumentFragment();
  for (const node of nodes) {
    if (node.type === "text") {
      fragment.appendChild(documentLike.createTextNode(node.value));
      continue;
    }
    const tagName = node.type === "strong" ? "strong" : node.type === "emphasis" ? "em" : "code";
    const element = documentLike.createElement(tagName);
    if (node.type === "code") {
      element.appendChild(documentLike.createTextNode(node.value));
    } else {
      element.appendChild(renderInline(node.children, documentLike));
    }
    fragment.appendChild(element);
  }
  return fragment;
}

/**
 * Turn a Markdown AST into DOM nodes without interpreting any source as HTML.
 */
export function renderMarkdown(ast, documentLike = globalThis.document) {
  const fragment = documentLike.createDocumentFragment();
  const blocks = ast && ast.type === "document" && Array.isArray(ast.children) ? ast.children : [];

  for (const block of blocks) {
    if (block.type === "paragraph") {
      const paragraph = documentLike.createElement("p");
      paragraph.appendChild(renderInline(block.children, documentLike));
      fragment.appendChild(paragraph);
      continue;
    }
    if (block.type === "list") {
      const list = documentLike.createElement(block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        const listItem = documentLike.createElement("li");
        listItem.appendChild(renderInline(item.children, documentLike));
        list.appendChild(listItem);
      }
      fragment.appendChild(list);
    }
  }

  return fragment;
}
