import { test } from "node:test";
import assert from "node:assert/strict";
import {
  noteSummary,
  renderNote,
} from "../../packages/browser-extension/src/reader.ts";

class FakeNode {
  children: FakeNode[] = [];
  append(...nodes: FakeNode[]) {
    this.children.push(...nodes);
  }
  prepend(...nodes: FakeNode[]) {
    this.children.unshift(...nodes);
  }
}

class FakeText extends FakeNode {
  constructor(public value: string) {
    super();
  }
}

class FakeElement extends FakeNode {
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  className = "";
  textContent = "";
  href = "";
  target = "";
  rel = "";
  type = "";
  disabled = false;
  checked = false;
  tabIndex = -1;
  constructor(public tag: string) {
    super();
  }
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  querySelector(_selector: string): FakeElement | null {
    return null;
  }
}

class FakeFragment extends FakeNode {}

function fakeDocument() {
  return {
    createElement: (tag: string) => new FakeElement(tag),
    createTextNode: (text: string) => new FakeText(text),
    createDocumentFragment: () => new FakeFragment(),
  } as unknown as Document;
}

function serialize(node: FakeNode): string {
  if (node instanceof FakeText) return node.value;
  if (node instanceof FakeFragment)
    return node.children.map(serialize).join("");
  if (node instanceof FakeElement) {
    const attrs = [
      ...Object.entries(node.attrs).map(([k, v]) => ` ${k}="${v}"`),
      node.href ? ` href="${node.href}"` : "",
    ].join("");
    const body = node.textContent || node.children.map(serialize).join("");
    return `<${node.tag}${attrs}>${body}</${node.tag}>`;
  }
  return "";
}

test("extension reader summaries stay bounded and never claim remote content", async (t) => {
  await t.test("uses first block as title with 90-char bound", () => {
    const first = noteSummary("# Hello world\n\nSecond paragraph here.");
    assert.equal(first.title, "Hello world");
    assert.match(first.excerpt, /Second paragraph/);

    const empty = noteSummary("");
    assert.equal(empty.title, "Untitled note");

    const long = noteSummary(`# ${"a".repeat(200)}\n\nBody text.`);
    assert.equal(long.title.length, 90);
    assert.match(long.excerpt, /Body text/);
  });

  await t.test("skips html/definition blocks and collapses whitespace", () => {
    const summary = noteSummary(
      "<script>alert(1)</script>\n\n[ref]: https://example.com\n\nReal **content**  with\nspaces.",
    );
    assert.equal(summary.title, "Real content with spaces.");
  });

  await t.test("alt text stands in for images without fetching", () => {
    const summary = noteSummary(
      "![A diagram](https://example.com/img.png)\n\nNotes.",
    );
    assert.match(summary.title, /A diagram/);
  });

  await t.test(
    "rendered notes keep text, drop unsafe links and never fetch images",
    () => {
      const html = serialize(
        renderNote(
          "Hello **world**.\n\n[Unsafe](javascript:alert(1))\n\n![A diagram](https://example.com/img.png)",
          "https://usegrove.cloud",
          fakeDocument(),
        ) as unknown as FakeNode,
      );
      assert.match(html, /Hello/);
      assert.match(html, /world/);
      assert.ok(!html.includes("javascript:"));
      assert.ok(!html.includes("<img"));
      assert.match(html, /Image: A diagram/);
    },
  );

  await t.test(
    "rendered code and tables stay local with labelled regions",
    () => {
      const html = serialize(
        renderNote(
          "```js\nconst a = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |",
          "https://usegrove.cloud",
          fakeDocument(),
        ) as unknown as FakeNode,
      );
      assert.match(html, /<pre>/);
      assert.match(html, /const a = 1/);
      assert.match(html, /<table>/);
    },
  );
});
