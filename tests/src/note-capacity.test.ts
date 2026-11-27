import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { rememberSchema, recallSchema } from "@lib/shared/contracts";
import { memoryUpdateSchema } from "@lib/shared/memory-tools";
import { importRecordSchema } from "@lib/shared/jobs";
import {
  applySourceEdits,
  sourceEditsBetween,
} from "@lib/shared/document-edits";
import {
  createDocument,
  validateDocument,
  serializeDocument,
  diffDocumentText,
  documentLimits,
} from "@lib/shared/documents";
import { NOTE_CONTENT_MAX } from "@lib/shared/limits";
import { formatWebCapture } from "@lib/shared/web-capture";
import { requestBodyLimit } from "@lib/shared/limits";

const maximum = 250_000;
const content = "Essay paragraph. ".repeat(15_625).slice(0, maximum);

test("notes accept exactly 250,000 characters across create, update, import and capture", () => {
  assert.equal(NOTE_CONTENT_MAX, maximum);
  for (const body of [
    content,
    "日".repeat(maximum),
    "😀".repeat(maximum / 2),
  ]) {
    assert.equal(body.length, maximum);
    assert.equal(
      rememberSchema.parse({ operationId: randomUUID(), content: body })
        .content,
      body,
    );
    assert.equal(
      memoryUpdateSchema.parse({
        operationId: randomUUID(),
        id: randomUUID(),
        expectedVersion: 1,
        content: body,
      }).content,
      body,
    );
    assert.equal(
      importRecordSchema.parse({ sourceId: "essay", content: body }).content,
      body,
    );
    assert.equal(formatWebCapture({ text: body }), body);
  }
});

test("every note write contract rejects 250,001 characters without truncation", () => {
  const body = "a".repeat(maximum + 1);
  assert.equal(
    rememberSchema.safeParse({ operationId: randomUUID(), content: body })
      .success,
    false,
  );
  assert.equal(
    memoryUpdateSchema.safeParse({
      operationId: randomUUID(),
      id: randomUUID(),
      expectedVersion: 1,
      content: body,
    }).success,
    false,
  );
  assert.equal(
    importRecordSchema.safeParse({ sourceId: "essay", content: body }).success,
    false,
  );
  assert.throws(() => formatWebCapture({ text: body }));
});

test("passage edits reach the end of long notes and preserve exact content", () => {
  const revised = content.slice(0, -1) + "!";
  assert.equal(
    applySourceEdits(content, sourceEditsBetween(content, revised)),
    revised,
  );
  assert.throws(() =>
    applySourceEdits(content, [
      { from: maximum, to: maximum, oldText: "", text: "!" },
    ]),
  );
  const replacement = "b".repeat(maximum);
  assert.equal(
    applySourceEdits(content, sourceEditsBetween(content, replacement)),
    replacement,
  );
});

test("structured long documents roundtrip exactly and use the existing bounded diff", async () => {
  assert.equal(documentLimits.characters, maximum);
  assert.equal(documentLimits.diffCells, 262144);
  const doc = await createDocument({
    noteId: randomUUID(),
    revision: 1,
    source: content,
  });
  assert.equal(serializeDocument(await validateDocument(doc)), content);
  const after = content.slice(0, -1) + "!";
  const diff = diffDocumentText(content, after);
  assert.equal(diff.mode, "bounded");
  assert.equal(
    diff.parts
      .filter((p) => p.type !== "insert")
      .map((p) => p.text)
      .join(""),
    content,
  );
  assert.equal(
    diff.parts
      .filter((p) => p.type !== "delete")
      .map((p) => p.text)
      .join(""),
    after,
  );
  await assert.rejects(
    createDocument({
      noteId: randomUUID(),
      revision: 1,
      source: content + "!",
    }),
  );
});

test("raising storage capacity does not expand automatic recall context", () => {
  assert.equal(recallSchema.parse({}).maxCharacters, 6000);
  assert.equal(recallSchema.safeParse({ maxCharacters: 6001 }).success, false);
});

test("large request envelopes apply only to note-writing routes", () => {
  for (const path of [
    "/v1/memories",
    "memories/00000000-0000-4000-8000-000000000000/edit",
    "/mcp",
    "browser/captures",
    "imports",
  ])
    assert.equal(requestBodyLimit(path), 4 * 1024 * 1024, path);
  for (const path of [
    "/v1/recall",
    "proofing/check",
    "conversations/id/turns",
    "account/settings",
  ])
    assert.equal(requestBodyLimit(path), 128 * 1024, path);
});
