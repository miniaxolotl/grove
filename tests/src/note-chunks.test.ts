import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chunkNote,
  noteChunkCharacters,
} from "../../lib/memory/src/note-chunks.ts";

test("chunking preserves Markdown, code, whitespace and Unicode exactly", () => {
  for (const source of [
    "",
    "small note",
    "\r\n# Title\r\n\r\n" + "Evidence. ".repeat(5000),
    "😀".repeat(125_000),
    "日".repeat(250_000),
    "```ts\n" +
      "console.log('literal');\n".repeat(3000) +
      "```\n\nLast section.",
    "# Title\n\n" + "A short paragraph.\n\n".repeat(10_000),
  ]) {
    const chunks = chunkNote(source);
    assert.equal(chunks.map((c) => c.text).join(""), source);
    assert(
      chunks.every(
        (c) => c.text.length <= noteChunkCharacters && c.text.length > 0,
      ),
    );
    assert(
      chunks.every(
        (c, i) =>
          c.from === (chunks[i - 1]?.to ?? 0) &&
          source.slice(c.from, c.to) === c.text,
      ),
    );
    assert(chunks.every((c) => !/[\uD800-\uDFFF]/u.test(c.text)));
    assert.deepEqual(chunkNote(source), chunks);
  }
});

test("a paragraph insertion or edit preserves hashes for distant passages", () => {
  const paragraphs = Array.from(
    { length: 30 },
    (_, i) => `${i}: ${"Findings and analysis. ".repeat(70)}`,
  );
  const before = chunkNote(paragraphs.join("\n\n"));
  paragraphs.splice(10, 0, "New paragraph. ".repeat(60));
  const after = chunkNote(paragraphs.join("\n\n"));
  const hashes = new Set(after.map((c) => c.hash));
  assert(before.every((c) => hashes.has(c.hash)));
});
