import assert from "node:assert/strict";
import { test } from "node:test";

import * as extraction from "../../packages/api/src/document-extraction.ts";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

// Tiny real PDF; no generated or customer fixtures required.
function pdf(pages = ["Gardening notes", "Water seedlings"]): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let i = 0; i < pages.length; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    const text = `BT /F1 12 Tf 50 700 Td (${pages[i]}) Tj ET`;
    objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

test("document extraction exposes bounded text decoding and lossless segmentation", () => {
  assert.equal(typeof extraction.decodeDocumentText, "function");
  assert.equal(typeof extraction.segmentDocument, "function");
});

test("UTF-8 decoding handles BOM and CRLF without accepting binary or invalid bytes", () => {
  assert.equal(
    extraction.decodeDocumentText(
      Buffer.from("\uFEFF# Title\r\n\r\nText\rMore"),
    ),
    "# Title\n\nText\nMore",
  );
  for (const bytes of [
    Buffer.from([0xff, 0xfe]),
    Buffer.from("a\0b"),
    Buffer.from(" \n\t"),
  ])
    assert.throws(() => extraction.decodeDocumentText(bytes));
});

test("long documents preserve every normalized character and stable source ranges", () => {
  const text =
    "# Gardening\n\n" + "Plant trees and water seedlings. 🌱\n\n".repeat(400);
  const parts = extraction.segmentDocument([{ page: 1, text }]);
  assert(parts.length > 1);
  assert.equal(parts.map((p: { content: string }) => p.content).join(""), text);
  let offset = 0;
  for (const part of parts) {
    assert(part.content.length <= 6000);
    assert.equal(part.start, offset);
    offset += part.content.length;
    assert.equal(part.end, offset);
    assert.equal(part.pageStart, 1);
    assert.equal(part.pageEnd, 1);
    assert(!/[\uD800-\uDBFF]$/.test(part.content));
  }
  assert.deepEqual(extraction.segmentDocument([{ page: 1, text }]), parts);
});

test("PDF page provenance survives chunking and empty pages are explicit warnings", () => {
  const pages = [
    { page: 1, text: "A".repeat(5900) },
    { page: 2, text: "" },
    { page: 3, text: "B".repeat(6001) },
  ];
  const parts = extraction.segmentDocument(pages);
  assert.equal(
    parts.map((p: { content: string }) => p.content).join(""),
    pages.map((p) => p.text).join("\n\n"),
  );
  assert.equal(parts[0].pageStart, 1);
  assert.equal(parts.at(-1)!.pageEnd, 3);
  assert(parts.every((p: { content: string }) => p.content.length <= 6000));
});

test("segmentation bounds pages and expanded text before creating drafts", () => {
  assert.throws(() =>
    extraction.segmentDocument(
      Array.from({ length: 101 }, (_, i) => ({ page: i + 1, text: "hello" })),
    ),
  );
  assert.throws(() =>
    extraction.segmentDocument([
      { page: 1, text: "x".repeat(1024 * 1024 + 1) },
    ]),
  );
});

test("real PDFs extract in an abortable bounded process with original hash and page warnings", async () => {
  assert.equal(typeof extraction.extractDocument, "function");
  const bytes = pdf(["Gardening notes", "", "Water seedlings"]);
  const result = await extraction.extractDocument(
    bytes,
    "garden.pdf",
    new AbortController().signal,
  );
  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(result.mime, "application/pdf");
  assert.equal(result.pages.length, 3);
  assert.match(result.pages[0].text, /Gardening notes/);
  assert.deepEqual(result.emptyPages, [2]);
});

test("file validation rejects disguised types, malformed/empty PDFs and oversized input", async () => {
  assert.equal(typeof extraction.extractDocument, "function");
  const run = (bytes: Buffer, name: string) =>
    extraction.extractDocument(bytes, name, new AbortController().signal);
  await assert.rejects(run(Buffer.from("hello"), "a.exe"));
  await assert.rejects(run(Buffer.from("hello"), "a.pdf"));
  await assert.rejects(run(pdf(), "a.txt"));
  await assert.rejects(run(Buffer.from("%PDF-broken"), "a.pdf"));
  await assert.rejects(run(pdf([""]), "a.pdf"));
  await assert.rejects(run(Buffer.alloc(3 * 1024 * 1024 + 1), "a.pdf"));
  await assert.rejects(
    extraction.extractDocument(pdf(), "a.pdf", AbortSignal.abort()),
  );
});

test("password and permission-encrypted PDFs are refused even if readable without a password", async () => {
  const require = createRequire(
    new URL("../../packages/website/package.json", import.meta.url),
  );
  const make = require("pdfmake/build/pdfmake.js");
  make.addVirtualFileSystem(require("pdfmake/build/vfs_fonts.js"));
  for (const userPassword of ["fixture-password", undefined]) {
    const bytes = Buffer.from(
      await make
        .createPdf({
          content: "Synthetic private fixture",
          ownerPassword: "fixture-owner",
          ...(userPassword ? { userPassword } : {}),
          permissions: { copying: false },
        })
        .getBuffer(),
    );
    await assert.rejects(
      extraction.extractDocument(
        bytes,
        "encrypted.pdf",
        new AbortController().signal,
      ),
      /Password-protected/,
    );
  }
});
