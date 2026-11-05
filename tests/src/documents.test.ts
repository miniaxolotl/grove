import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { build } from "esbuild";
import {
  createDocument,
  validateDocument,
  serializeDocument,
  applyDocumentPatch,
  compareDocuments,
  diffDocumentText,
  documentLimits,
  type StructuredDocument,
  type DocumentOperation,
  type DocumentEditScope,
} from "@lib/shared/documents";

const noteId = randomUUID();
const create = (source: string) =>
  createDocument({ noteId, revision: 7, source });
const scopeFor = (doc: StructuredDocument): DocumentEditScope => ({
  nodeIds: doc.blocks.map((b) => b.id),
  insertions: [
    { afterId: null, beforeId: doc.blocks[0]?.id ?? null },
    ...doc.blocks.map((b, i) => ({
      afterId: b.id,
      beforeId: doc.blocks[i + 1]?.id ?? null,
    })),
  ],
});
const batch = (doc: StructuredDocument, operations: DocumentOperation[]) => ({
  noteId: doc.noteId,
  baseRevision: doc.revision,
  baseHash: doc.hash,
  operationId: randomUUID(),
  operations,
});
const replace = (
  doc: StructuredDocument,
  index: number,
  oldText: string,
  text: string,
): DocumentOperation => ({
  type: "replace_text",
  nodeId: doc.blocks[index].id,
  expectedHash: doc.blocks[index].hash,
  from: doc.blocks[index].source.indexOf(oldText),
  to: doc.blocks[index].source.indexOf(oldText) + oldText.length,
  oldText,
  text,
});
const rejects = (run: () => Promise<unknown>, code: string) =>
  assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === code,
  );

test("document corpus roundtrips exact Markdown without normalization", async () => {
  const corpus = [
    "  \r\n# Heading\r\n\r\nA paragraph.  \r\n\r\n",
    "# Same\n\nSame\n\nSame\n\n# Same\n",
    "- [ ] first\n  - [x] nested\n\n> quote\n> continuation\n",
    "| A | B |\n| --- | --- |\n| x | y |\n\n~~old~~ **new**\n",
    "```html\n<div>literal</div>\n```\n\n<div>opaque HTML</div>\n",
    "[link][ref]\n\n[ref]: https://example.test/ 'title'\n\n---\n",
    `![image](grove-media:${randomUUID()})\n\n[recording](grove-media:${randomUUID()})`,
    "😀 e\u0301 日本語\n\n\tindented\n",
    " \t\r\n\r\n",
    "text".repeat(1500),
  ];
  for (const source of corpus) {
    const doc = await create(source);
    assert.equal(serializeDocument(doc), source);
    assert.equal(new Set(doc.blocks.map((b) => b.id)).size, doc.blocks.length);
    assert.deepEqual(
      await validateDocument(JSON.parse(JSON.stringify(doc))),
      doc,
    );
  }
  const table = await create(corpus[3]);
  assert.equal(table.blocks[0].kind, "table");
  const dense = await create("---\n\n".repeat(1000));
  assert.equal(dense.blocks.length, 1);
  assert.equal(dense.blocks[0].kind, "opaque");
  assert.equal(serializeDocument(dense), "---\n\n".repeat(1000));
});

test("snapshot schemas reject tampering, duplicates, unknown fields and false structure", async () => {
  const doc = await create("# Title\n\nBody\n");
  for (const value of [
    { ...doc, schemaVersion: 2 },
    { ...doc, extra: true },
    {
      ...doc,
      blocks: [{ ...doc.blocks[0], source: "changed" }, doc.blocks[1]],
    },
    { ...doc, hash: "0".repeat(64) },
    { ...doc, blocks: [doc.blocks[0], doc.blocks[0]] },
    { ...doc, blocks: [{ ...doc.blocks[0], kind: "code" }, doc.blocks[1]] },
  ])
    await rejects(() => validateDocument(value), "invalid_document");
  await rejects(() => create("x".repeat(6001)), "invalid_document");
  await rejects(() => create(""), "invalid_document");
});

test("sentence patch preserves unrelated blocks, exact whitespace and metadata", async () => {
  const doc = await create(
    "# Title\r\n\r\nKeep **facts**. Old sentence.\r\n\r\n- [x] done\r\n",
  );
  const before = JSON.stringify(doc);
  const result = await applyDocumentPatch(
    doc,
    batch(doc, [replace(doc, 1, "Old sentence.", "New sentence.")]),
    { nodeIds: [doc.blocks[1].id], insertions: [] },
  );
  assert.equal(JSON.stringify(doc), before, "input snapshot is never mutated");
  assert.equal(result.document.revision, 8);
  assert.equal(result.document.noteId, doc.noteId);
  assert.equal(result.document.blocks[1].id, doc.blocks[1].id);
  assert.deepEqual(result.document.blocks[0], doc.blocks[0]);
  assert.deepEqual(result.document.blocks[2], doc.blocks[2]);
  assert.equal(
    serializeDocument(result.document),
    serializeDocument(doc).replace("Old sentence.", "New sentence."),
  );
  assert.deepEqual(
    result.diff.changes.map((c) => c.type),
    ["edit"],
  );
});

test("exact scope/version/hash/text preconditions fail closed", async () => {
  const doc = await create("Same\n\nSame\n");
  const patch = batch(doc, [replace(doc, 1, "Same", "Different")]);
  await rejects(
    () =>
      applyDocumentPatch(doc, patch, {
        nodeIds: [doc.blocks[0].id],
        insertions: [],
      }),
    "out_of_scope",
  );
  for (const p of [
    { ...patch, baseRevision: 6 },
    { ...patch, baseHash: "0".repeat(64) },
  ])
    await rejects(
      () => applyDocumentPatch(doc, p, scopeFor(doc)),
      "version_conflict",
    );
  await rejects(
    () =>
      applyDocumentPatch(
        doc,
        { ...patch, noteId: randomUUID() },
        scopeFor(doc),
      ),
    "document_mismatch",
  );
  for (const op of [
    { ...patch.operations[0], nodeId: randomUUID() },
    { ...patch.operations[0], expectedHash: "0".repeat(64) },
    { ...patch.operations[0], oldText: "wrong" },
    { ...patch.operations[0], from: -1 },
    { ...patch.operations[0], to: 999 },
    { ...patch.operations[0], replaceAll: true },
  ])
    await assert.rejects(() =>
      applyDocumentPatch(doc, { ...patch, operations: [op] }, scopeFor(doc)),
    );
  const result = await applyDocumentPatch(doc, patch, scopeFor(doc));
  assert.equal(result.document.blocks[0].source, doc.blocks[0].source);
  assert.equal(result.document.blocks[1].source, "Different\n");
});

test("patch batches are sequential and atomic, including structural rejection", async () => {
  const doc = await create("First\n\nSecond\n");
  const first = replace(doc, 0, "First", "Changed");
  const changed = (
    await applyDocumentPatch(doc, batch(doc, [first]), scopeFor(doc))
  ).document;
  const second = replace(changed, 0, "Changed", "Final");
  const result = await applyDocumentPatch(
    doc,
    batch(doc, [first, second]),
    scopeFor(doc),
  );
  assert.equal(result.document.revision, 8, "one revision for an atomic batch");
  assert.equal(result.document.blocks[0].source, "Final\n\n");
  await rejects(
    () =>
      applyDocumentPatch(
        doc,
        batch(doc, [first, replace(doc, 1, "missing", "bad")]),
        scopeFor(doc),
      ),
    "invalid_patch",
  );
  await rejects(
    () =>
      applyDocumentPatch(
        doc,
        batch(doc, [replace(doc, 0, "First", "One\n\nTwo")]),
        scopeFor(doc),
      ),
    "structure_conflict",
  );
  assert.equal(serializeDocument(doc), "First\n\nSecond\n");
});

test("text patches protect UTF-16 boundaries and do not normalize Unicode", async () => {
  const doc = await create("😀 e\u0301\n");
  const valid = replace(doc, 0, "😀", "🌿");
  const result = await applyDocumentPatch(
    doc,
    batch(doc, [valid]),
    scopeFor(doc),
  );
  assert.equal(serializeDocument(result.document), "🌿 e\u0301\n");
  for (const op of [
    { ...valid, from: 1, to: 2, oldText: "\ude00" },
    { ...valid, from: 0, to: 1, oldText: "\ud83d" },
    { ...valid, text: "\ud83d" },
  ])
    await rejects(
      () => applyDocumentPatch(doc, batch(doc, [op]), scopeFor(doc)),
      "invalid_patch",
    );
});

test("inserts have deterministic scoped IDs and guarded authorized anchors", async () => {
  const doc = await create("First\n\nLast\n");
  const anchor = { afterId: doc.blocks[0].id, beforeId: doc.blocks[1].id };
  const patch = batch(doc, [
    { type: "insert_block", anchor, source: "New\n\n" },
  ]);
  const scope = { nodeIds: [], insertions: [anchor] };
  const a = await applyDocumentPatch(doc, patch, scope);
  const b = await applyDocumentPatch(doc, patch, scope);
  assert.deepEqual(
    a,
    b,
    "uncertain retries can reproduce the same pure result",
  );
  assert.equal(a.document.blocks.length, 3);
  assert.deepEqual(a.document.blocks[0], doc.blocks[0]);
  assert.deepEqual(a.document.blocks[2], doc.blocks[1]);
  assert.deepEqual(
    a.diff.changes.map((c) => c.type),
    ["insert"],
  );
  await rejects(
    () => applyDocumentPatch(doc, patch, { nodeIds: [], insertions: [] }),
    "out_of_scope",
  );
  await rejects(
    () =>
      applyDocumentPatch(
        doc,
        batch(doc, [
          {
            type: "insert_block",
            source: "New\n\n",
            anchor: { afterId: doc.blocks[1].id, beforeId: doc.blocks[0].id },
          },
        ]),
        scopeFor(doc),
      ),
    "target_conflict",
  );
  await rejects(
    () =>
      applyDocumentPatch(
        doc,
        batch(doc, [{ type: "insert_block", anchor, source: "will merge" }]),
        scope,
      ),
    "structure_conflict",
  );
});

test("delete and move preserve surviving IDs/source and distinguish moves from edits", async () => {
  const doc = await create("First\n\nSecond\n\nThird\n\n");
  const node = doc.blocks[1];
  const anchor = { afterId: doc.blocks[2].id, beforeId: null };
  const move: DocumentOperation = {
    type: "move_block",
    nodeId: node.id,
    expectedHash: node.hash,
    anchor,
  };
  const moved = await applyDocumentPatch(
    doc,
    batch(doc, [move]),
    scopeFor(doc),
  );
  assert.deepEqual(
    moved.document.blocks.map((b) => b.source),
    ["First\n\n", "Third\n\n", "Second\n\n"],
  );
  assert.deepEqual(
    new Set(moved.document.blocks.map((b) => b.id)),
    new Set(doc.blocks.map((b) => b.id)),
  );
  assert.equal(moved.diff.changes.filter((c) => c.type === "move").length, 1);
  assert.equal(moved.diff.changes[0].beforeIndex, 1);
  assert.equal(moved.diff.changes[0].afterIndex, 2);
  assert.equal(moved.diff.beforeHash, doc.hash);
  assert.equal(moved.diff.afterHash, moved.document.hash);
  assert(
    !moved.diff.changes.some((c) =>
      ["insert", "delete", "edit"].includes(c.type),
    ),
  );
  const deleted = await applyDocumentPatch(
    doc,
    batch(doc, [
      { type: "delete_block", nodeId: node.id, expectedHash: node.hash },
    ]),
    scopeFor(doc),
  );
  assert.deepEqual(deleted.document.blocks, [doc.blocks[0], doc.blocks[2]]);
  assert.deepEqual(
    deleted.diff.changes.map((c) => c.type),
    ["delete"],
  );
  await rejects(
    () =>
      applyDocumentPatch(doc, batch(doc, [move]), {
        nodeIds: [node.id],
        insertions: [],
      }),
    "out_of_scope",
  );
});

test("bounded batches reject no-ops, oversize results, unknown operations and exhausted revisions", async () => {
  const doc = await create("One\n\nTwo\n");
  for (const operations of [
    [],
    [{ type: "replace_document", source: "wrong" }],
    Array.from({ length: documentLimits.operations + 1 }, () =>
      replace(doc, 0, "One", "One"),
    ),
  ])
    await rejects(
      () =>
        applyDocumentPatch(
          doc,
          batch(doc, operations as DocumentOperation[]),
          scopeFor(doc),
        ),
      "invalid_patch",
    );
  await rejects(
    () =>
      applyDocumentPatch(
        doc,
        batch(doc, [replace(doc, 0, "One", "One")]),
        scopeFor(doc),
      ),
    "no_change",
  );
  await rejects(
    () =>
      applyDocumentPatch(
        doc,
        batch(doc, [replace(doc, 0, "One", "x".repeat(6000))]),
        scopeFor(doc),
      ),
    "invalid_patch",
  );
  const max = { ...doc, revision: Number.MAX_SAFE_INTEGER };
  await rejects(
    () =>
      applyDocumentPatch(
        max,
        batch(max, [replace(max, 0, "One", "New")]),
        scopeFor(max),
      ),
    "invalid_patch",
  );
});

test("source diffs reconstruct both sides, including syntax, whitespace and bounded fallback", () => {
  for (const [before, after] of [
    ["", "new"],
    ["old", ""],
    ["same", "same"],
    ["A **bold** word", "A _bold_ sentence"],
    ["- [ ] item\r\n", "- [x] item\r\n"],
    ["😀 e\u0301", "🌿 é"],
    ["a ".repeat(2900), "b ".repeat(2900)],
  ]) {
    const diff = diffDocumentText(before, after);
    assert.equal(
      diff.parts
        .filter((p) => p.type !== "insert")
        .map((p) => p.text)
        .join(""),
      before,
    );
    assert.equal(
      diff.parts
        .filter((p) => p.type !== "delete")
        .map((p) => p.text)
        .join(""),
      after,
    );
    for (const part of diff.parts) assert(!/[\uD800-\uDFFF]/u.test(part.text));
    assert.deepEqual(diffDocumentText(before, after), diff);
  }
  assert.equal(
    diffDocumentText("a ".repeat(2900), "b ".repeat(2900)).mode,
    "bounded",
  );
  assert.throws(() => diffDocumentText("x".repeat(6001), ""));
});

test("document comparisons reject foreign snapshots and report formatting-only changes", async () => {
  const doc = await create("- [ ] item\n");
  const result = await applyDocumentPatch(
    doc,
    batch(doc, [replace(doc, 0, "[ ]", "[x]")]),
    scopeFor(doc),
  );
  const diff = await compareDocuments(doc, result.document);
  assert.equal(diff.changes[0].type, "edit");
  assert.deepEqual((await compareDocuments(doc, doc)).changes, []);
  const other = await createDocument({
    noteId: randomUUID(),
    revision: 1,
    source: "foreign",
  });
  await rejects(() => compareDocuments(doc, other), "document_mismatch");
});

test("synthetic edit corpus preserves every untouched block over repeated revisions", async () => {
  let doc = await create(
    "# Title\n\nAlpha\n\nBeta\n\n```ts\nconst a = 1;\n```\n",
  );
  for (let i = 0; i < 40; i++) {
    const original = structuredClone(doc);
    const index = (i % 2) + 1;
    const old = doc.blocks[index].source.split("\n")[0];
    doc = (
      await applyDocumentPatch(
        doc,
        batch(doc, [replace(doc, index, old, `Value ${i} 😀`)]),
        { nodeIds: [doc.blocks[index].id], insertions: [] },
      )
    ).document;
    for (let j = 0; j < doc.blocks.length; j++) {
      assert.equal(doc.blocks[j].id, original.blocks[j].id);
      if (j !== index) assert.deepEqual(doc.blocks[j], original.blocks[j]);
    }
    assert.deepEqual(await validateDocument(doc), doc);
  }
});

test("passage scope cannot edit another sentence or delete the containing block", async () => {
  const doc = await create("Keep this. Edit this. Keep that.\n");
  const from = doc.blocks[0].source.indexOf("Edit this.");
  const scope: DocumentEditScope = {
    nodeIds: [],
    insertions: [],
    ranges: [
      { nodeId: doc.blocks[0].id, from, to: from + "Edit this.".length },
    ],
  };
  const op = replace(doc, 0, "Edit this.", "Longer revised sentence.");
  const result = await applyDocumentPatch(doc, batch(doc, [op]), scope);
  assert.equal(
    serializeDocument(result.document),
    "Keep this. Longer revised sentence. Keep that.\n",
  );
  const next = replace(result.document, 0, "revised", "new");
  const sequential = await applyDocumentPatch(
    doc,
    batch(doc, [op, next]),
    scope,
  );
  assert.equal(
    serializeDocument(sequential.document),
    "Keep this. Longer new sentence. Keep that.\n",
  );
  await rejects(
    () =>
      applyDocumentPatch(
        doc,
        batch(doc, [replace(doc, 0, "Keep this.", "lost")]),
        scope,
      ),
    "out_of_scope",
  );
  await rejects(
    () =>
      applyDocumentPatch(
        doc,
        batch(doc, [
          {
            type: "delete_block",
            nodeId: doc.blocks[0].id,
            expectedHash: doc.blocks[0].hash,
          },
        ]),
        scope,
      ),
    "out_of_scope",
  );
  await rejects(
    () =>
      applyDocumentPatch(doc, batch(doc, [op]), {
        ...scope,
        ranges: [{ nodeId: doc.blocks[0].id, from: 9000, to: 9001 }],
      }),
    "invalid_patch",
  );
});

test("disjoint passage scope offsets follow earlier authorized edits without widening", async () => {
  const doc = await create("A. Untouched. B.\n");
  const block = doc.blocks[0];
  const scope: DocumentEditScope = {
    nodeIds: [],
    insertions: [],
    ranges: [
      { nodeId: block.id, from: 0, to: 2 },
      { nodeId: block.id, from: 14, to: 16 },
    ],
  };
  const first = replace(doc, 0, "A.", "Long first.");
  const current = (await applyDocumentPatch(doc, batch(doc, [first]), scope))
    .document;
  const second = replace(current, 0, "B.", "New last.");
  const result = await applyDocumentPatch(
    doc,
    batch(doc, [first, second]),
    scope,
  );
  assert.equal(
    serializeDocument(result.document),
    "Long first. Untouched. New last.\n",
  );
  await rejects(
    () =>
      applyDocumentPatch(
        doc,
        batch(doc, [first, replace(current, 0, "Untouched.", "bad")]),
        scope,
      ),
    "out_of_scope",
  );
});

test("bounded deterministic diff reconstructs a seeded repeated-token corpus", () => {
  let seed = 42;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const tokens = ["same", " ", "\r\n", "**", "🌿", "[x]", "e\u0301", "\t"];
  for (let i = 0; i < 300; i++) {
    const text = () =>
      Array.from(
        { length: random() % 35 },
        () => tokens[random() % tokens.length],
      ).join("");
    const before = text(),
      after = text();
    const diff = diffDocumentText(before, after);
    assert.equal(
      diff.parts
        .filter((p) => p.type !== "insert")
        .map((p) => p.text)
        .join(""),
      before,
    );
    assert.equal(
      diff.parts
        .filter((p) => p.type !== "delete")
        .map((p) => p.text)
        .join(""),
      after,
    );
  }
});

test("shared core bundles for browser consumers without Node-only dependencies", async () => {
  const result = await build({
    entryPoints: [
      new URL("../../lib/shared/src/documents/index.ts", import.meta.url)
        .pathname,
    ],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  assert.equal(result.outputFiles.length, 1);
  assert(result.outputFiles[0].text.includes("applyDocumentPatch"));
});
