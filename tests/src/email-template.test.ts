import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderEmail,
  type EmailEvent,
} from "../../packages/api/src/email-template.ts";

const letters: { event: EmailEvent; heading: string; action: string }[] = [
  {
    event: { kind: "welcome" },
    heading: "Welcome to Grove",
    action: "Open Grove",
  },
  {
    event: { kind: "connection_approved" },
    heading: "Connection approved",
    action: "Review connections",
  },
  {
    event: { kind: "connection_revoked" },
    heading: "Connection revoked",
    action: "Review connections",
  },
  {
    event: { kind: "deletion_requested" },
    heading: "Account deletion requested",
    action: "Contact support",
  },
  {
    event: {
      kind: "export_ready",
      taskId: "0123",
      expiresAt: "2030-02-01T17:00:00Z",
    },
    heading: "Your export is ready",
    action: "View export",
  },
];

test("all letters use the app's quiet system type, paper and single-action hierarchy", () => {
  for (const { event, heading, action } of letters) {
    const { html, text } = renderEmail(event, "https://grovenote.app");
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, event.kind);
    assert.match(html, /<h1[^>]*font-size:24px/);
    assert.match(html, new RegExp(`>${heading}</h1>`));
    assert(text.includes(heading));
    assert.match(
      html,
      /font-family:system-ui,-apple-system,BlinkMacSystemFont/,
    );
    for (const color of ["#fbfcfb", "#284c38", "#535f57", "#dce2dc"])
      assert(html.includes(color), `${event.kind}: ${color}`);
    assert.equal((html.match(/class="email-action"/g) ?? []).length, 1);
    assert.match(html, new RegExp(`>${action}</a>`));
    assert.match(html, /max-width:560px/);
    assert.doesNotMatch(html, /Georgia|border-top:4px|#f7f6f0/);
    assert.doesNotMatch(
      html,
      /Your workspace|Account security|Your account|Your data/,
    );
    assert.doesNotMatch(html, /<script|<img|<form|@font-face|url\(/i);
    assert.equal(
      (html.match(/<table\b/g) ?? []).length,
      (html.match(/<table role="presentation"/g) ?? []).length,
    );
  }
});

test("security and deletion letters retain guidance without guessing cleanup completion", () => {
  const approved = renderEmail(
    { kind: "connection_approved" },
    "https://grove.example",
  );
  const revoked = renderEmail(
    { kind: "connection_revoked" },
    "https://grove.example",
  );
  const deletion = renderEmail(
    { kind: "deletion_requested" },
    "https://grove.example",
  );
  for (const part of [approved.html, approved.text]) {
    assert.match(part, /If you didn’t approve this/);
    assert.match(part, /revoke any access you don’t recognize/);
  }
  for (const part of [revoked.html, revoked.text])
    assert.match(part, /Revoking a connection does not delete your notes/);
  for (const part of [deletion.html, deletion.text]) {
    assert.match(part, /Access to your Grove account is off/);
    assert.match(part, /does not confirm that cleanup is complete/);
    assert.match(part, /If you didn’t request this, contact support/);
    assert.doesNotMatch(
      part,
      /cleanup is still in progress|account has been deleted/i,
    );
  }
});

test("every preview is clearly a sample and real letters omit sample notices", () => {
  for (const { event } of letters) {
    const preview = renderEmail(event, "https://grove.example", true);
    const real = renderEmail(event, "https://grove.example");
    assert.match(preview.subject, /^\[Preview\] /);
    for (const part of [preview.html, preview.text])
      assert.match(
        part,
        /Preview only\. This is a sample email; no account action took place\./,
      );
    assert.doesNotMatch(
      real.subject + real.html + real.text,
      /Preview only|\[Preview\]/,
    );
  }
});

test("long export IDs stay encoded in identical action and fallback links", () => {
  const taskId = `"><img src=x onerror=alert(1)>&${"a".repeat(300)}`;
  const { html, text } = renderEmail(
    { kind: "export_ready", taskId, expiresAt: "2030-02-01T17:00:00Z" },
    "https://grove.example/ignored-path?ignored=true",
  );
  const link = `https://grove.example/app/settings/data?export=${encodeURIComponent(taskId)}`;
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(links, [link, link]);
  assert(text.includes(link));
  assert.match(html, /overflow-wrap:anywhere/);
  assert.doesNotMatch(html, /<img|onerror=/i);
});

test("email origins reject credentials and nonlocal insecure or executable schemes", () => {
  for (const origin of [
    "https://user:password@grove.example",
    "http://grove.example",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "ftp://grove.example",
  ])
    assert.throws(() => renderEmail({ kind: "welcome" }, origin));
  for (const origin of [
    "http://localhost:4398",
    "http://127.0.0.1:4398",
    "http://[::1]:4398",
  ])
    assert(
      renderEmail({ kind: "welcome" }, origin).text.includes(`${origin}/app`),
    );
});

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
