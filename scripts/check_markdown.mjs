import assert from "node:assert/strict";
import { parseMarkdown, renderMarkdown } from "../docs/js/views/markdown.js";

class FakeNode {
  constructor(type, value = "") {
    this.type = type;
    this.value = value;
    this.children = [];
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }
}

const fakeDocument = {
  createDocumentFragment() {
    return new FakeNode("fragment");
  },
  createElement(tagName) {
    return new FakeNode(tagName);
  },
  createTextNode(value) {
    return new FakeNode("#text", value);
  }
};

function serialize(node) {
  if (node.type === "#text") return node.value;
  return node.children.map(serialize).join("");
}

{
  const ast = parseMarkdown("A **bold** *italic* and `code`.\n\n- First\n- Second\n\n1. One\n2. Two");
  assert.deepEqual(ast, {
    type: "document",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", value: "A " },
          { type: "strong", children: [{ type: "text", value: "bold" }] },
          { type: "text", value: " " },
          { type: "emphasis", children: [{ type: "text", value: "italic" }] },
          { type: "text", value: " and " },
          { type: "code", value: "code" },
          { type: "text", value: "." }
        ]
      },
      {
        type: "list",
        ordered: false,
        items: [
          { type: "listItem", children: [{ type: "text", value: "First" }] },
          { type: "listItem", children: [{ type: "text", value: "Second" }] }
        ]
      },
      {
        type: "list",
        ordered: true,
        items: [
          { type: "listItem", children: [{ type: "text", value: "One" }] },
          { type: "listItem", children: [{ type: "text", value: "Two" }] }
        ]
      }
    ]
  });
}

{
  const ast = parseMarkdown("Keep **this open and `that open.");
  assert.deepEqual(ast.children[0].children, [
    { type: "text", value: "Keep **this open and `that open." }
  ]);
}

{
  const source = "<script>alert('xss')</script> and <b>plain text</b>";
  const rendered = renderMarkdown(parseMarkdown(source), fakeDocument);
  assert.equal(serialize(rendered), source);
  assert.equal(rendered.children[0].type, "p");
  assert.equal(rendered.children[0].children[0].type, "fragment");
}

{
  const ast = parseMarkdown("*".repeat(40_000));
  assert.ok(ast.children.length <= 250);
  assert.ok(ast.children[0].children.length <= 2);
}

console.log("check_markdown: OK");
