import assert from "node:assert/strict";
import test from "node:test";
import { renderEmail } from "../../packages/api/src/email-template.ts";

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
