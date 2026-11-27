import { test } from "node:test";
import assert from "node:assert/strict";
import { apiOrigin } from "../../packages/website/src/lib/api-origin.ts";
import { sharedNoteDocument } from "../../packages/website/src/lib/shared-note-document.ts";
import { boundedRequestBody } from "../../packages/website/src/lib/request-body.ts";

test("shared API-origin validation rejects credentials, path prefixes and non-loopback plaintext", () => {
  for (const value of [
    undefined,
    "",
    "https://user:secret@example.test",
    "https://example.test/prefix",
    "https://example.test/?q=1",
    "https://example.test/#fragment",
    "http://remote.example.test",
    "file:///tmp/test",
  ])
    assert.throws(() => apiOrigin(value));
  for (const value of [
    "https://example.test",
    "http://127.0.0.1:8888",
    "http://[::1]:8888",
  ])
    assert.equal(apiOrigin(value).origin, value);
});
test("one outline projection retains duplicate anchors and excludes nested child text from a parent point", () => {
  const doc = sharedNoteDocument(
    "# Café\n\n## Café\n\n- Parent\n  - Child\n\n```md\n# Hidden\n```",
    "Café",
  );
  assert.equal(doc.titleAnchor, "section-café");
  assert.equal(doc.headings[0].id, "section-café-2");
  assert.equal(doc.headings[1].title, "Parent");
  assert.equal(doc.headings[1].id, "point-1");
  assert(!doc.targets.some((target) => target.title === "Hidden"));
});
test("bounded public read requests count actual multibyte chunks", async () => {
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("ééé"));
        controller.close();
      },
    });
  assert.equal(await boundedRequestBody(stream(), 5), null);
  assert.equal(await boundedRequestBody(stream(), 6), "ééé");
});
test("a maximum-size note keeps late-section targets without changing the over-limit fallback", () => {
  const content = Array.from(
    { length: 105 },
    (_, index) =>
      `## Section ${index}\n\n${"Useful context. ".repeat(100)}\n\n- Review this point\n\n`,
  )
    .join("")
    .padEnd(250000, " ");
  const doc = sharedNoteDocument(content, "Title");
  assert(doc.targets.some((target) => target.id === "section-section-104"));
  assert.equal(doc.targets.filter((target) => target.point).length, 105);
  assert.deepEqual(sharedNoteDocument(content + "x", "Title").targets, []);
});
