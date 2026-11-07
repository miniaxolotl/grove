import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOTE_CONTENT_MAX,
  NOTE_TITLE_MAX,
  SHARE_CURSOR_MAX,
  WEB_URL_MAX,
} from "@lib/shared/limits";
import { noteTitle } from "@lib/shared/search";
import {
  parsePublicShareUrl,
  sharedNoteTitle,
  shareDurations,
} from "@lib/shared/sharing";
import { parseNoteMarkdown } from "@lib/shared/markdown";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("shared limits are the single source of truth", () => {
  assert.equal(NOTE_CONTENT_MAX, 6000);
  assert.equal(NOTE_TITLE_MAX, 110);
  assert.equal(WEB_URL_MAX, 4096);
  assert.equal(SHARE_CURSOR_MAX, 2048);
  assert.deepEqual(Object.keys(shareDurations), [
    "1h",
    "4h",
    "1d",
    "1w",
    "2w",
    "1mo",
  ]);
});

test("public titles delegate to the shared title resolver", () => {
  assert.equal(sharedNoteTitle("# Hello\nbody"), noteTitle("# Hello\nbody"));
  assert.equal(sharedNoteTitle(""), "Untitled note");
  assert.equal(sharedNoteTitle("# Hi"), "Hi");
  // Surrogate pairs are not split at the limit.
  const content = `${"a".repeat(109)}\uD83D`;
  assert.equal(noteTitle(content).length, 109);
});

test("public share URLs validate origin, path, token and query", () => {
  const site = "https://grove.example.test";
  const token = `gsh_${"a".repeat(43)}`;
  assert.equal(
    parsePublicShareUrl(`${site}/s/${token}`, site),
    `${site}/s/${token}`,
  );
  assert.equal(parsePublicShareUrl(`https://evil.test/s/${token}`, site), null);
  assert.equal(parsePublicShareUrl(`${site}/s/bad`, site), null);
  assert.equal(parsePublicShareUrl(`${site}/s/${token}?x=1`, site), null);
  assert.equal(parsePublicShareUrl(`${site}/s/${token}#x`, site), null);
});

test("markdown parsing enforces the shared note limit", () => {
  assert.throws(() => parseNoteMarkdown("a".repeat(NOTE_CONTENT_MAX + 1)));
  assert.doesNotThrow(() =>
    parseNoteMarkdown("a".repeat(100_000), { maxCharacters: 100_000 }),
  );
});

test("webapp and extension use shared markdown and limits", () => {
  const bannedDirect = [
    "packages/website/src/lib/note-headings.ts",
    "packages/website/src/lib/note-pdf.ts",
    "packages/website/src/components/dashboard/note-context-menu.tsx",
  ];
  for (const path of bannedDirect) {
    const text = source(path);
    assert.ok(
      text.includes("@lib/shared/markdown"),
      `${path} must import parseNoteMarkdown from @lib/shared/markdown`,
    );
    assert.ok(
      !text.includes("mdast-util-from-markdown"),
      `${path} must not import mdast-util-from-markdown directly`,
    );
  }
  for (const path of [
    "packages/website/src/components/dashboard/markdown-editor.tsx",
    "packages/website/src/components/dashboard/ask-composer.tsx",
    "packages/website/src/components/dashboard/import-notes-panel.tsx",
    "packages/browser-extension/src/drafts.ts",
    "packages/browser-extension/src/background.ts",
    "packages/browser-extension/src/content.ts",
    "packages/browser-extension/src/platform.ts",
  ]) {
    const text = source(path);
    assert.ok(
      !/\b6000\b/.test(text.replaceAll("NOTE_CONTENT_MAX", "")),
      `${path} must use NOTE_CONTENT_MAX instead of a hardcoded 6000`,
    );
  }
  // Extension share validation must delegate to the shared helper.
  const sharing = source("packages/browser-extension/src/sharing.ts");
  assert.ok(
    sharing.includes("parsePublicShareUrl"),
    "extension sharing.ts must use parsePublicShareUrl",
  );
  assert.ok(
    !sharing.includes("shareTokenSchema"),
    "extension sharing.ts must not re-implement token validation",
  );
  void readdirSync;
});
