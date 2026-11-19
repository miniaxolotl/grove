import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderEmail } from "../../packages/api/src/email-template.ts";

test("offline email previews default to the canonical Grove website", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "grove-domain-preview-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    ["scripts/testing/email-previews.mjs", "render", directory],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, SITE_URL: "", RESEND_API_KEY: "" },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const files = readdirSync(directory);
  assert.equal(files.length, 10);
  for (const file of files) {
    const content = readFileSync(join(directory, file), "utf8");
    assert.match(content, /https:\/\/grovenote\.app\//);
    assert.doesNotMatch(content, /usegrove\.cloud/);
  }
});

test("export HTML and text agree on the authorized landing page and absolute deadline", () => {
  const { html, text } = renderEmail(
    { kind: "export_ready", taskId: "0123", expiresAt: "2030-02-01T17:00:00Z" },
    "https://grove.example",
  );
  for (const part of [html, text]) {
    assert.match(part, /February 1, 2030/);
    assert.match(part, /UTC/);
    assert.match(
      part,
      /https:\/\/grove.example\/app\/settings\/data\?export=0123/,
    );
    assert.doesNotMatch(part, /\/download|<img/i);
  }
});
test("deletion receipts link to public support and samples cannot be mistaken for real receipts", () => {
  const m = renderEmail(
    { kind: "deletion_requested" },
    "https://grove.example",
    true,
  );
  assert.match(m.subject, /^\[Preview\]/);
  for (const part of [m.html, m.text]) {
    assert.match(part, /Preview only/);
    assert.match(part, /https:\/\/grove.example\/support/);
    assert.doesNotMatch(part, /https:\/\/grove.example\/app/);
  }
  assert.throws(() => renderEmail({ kind: "welcome" }, "javascript:alert(1)"));
});
