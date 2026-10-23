import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
test("source release guards intent and preserves its authenticated generated-PR CI path", () => {
  const text = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(
    text,
    /github.repository == '[^']+' && github.ref == 'refs\/heads\/development' && github.ref_protected == true/,
  );
  const fern = JSON.parse(readFileSync("package.json", "utf8")).name === "fern";
  if (fern) {
    assert.match(text, /token: \$\{\{ secrets.RELEASE_PLEASE_TOKEN \}\}/);
    assert.match(text, /RELEASE_PLEASE_TOKEN must be provisioned/);
    assert.doesNotMatch(text, /contents: write/);
  } else {
    assert.match(
      text,
      /contents: write\s+pull-requests: write\s+actions: write/,
    );
    assert.match(text, /token: \$\{\{ github.token \}\}/);
    assert.doesNotMatch(text, /secrets\.RELEASE_PLEASE_TOKEN/);
    assert.match(text, /run: node scripts\/release\/dispatch-ci.mjs/);
  }
  assert.match(text, /fetch-depth: 0/);
  assert.ok(
    text.indexOf("actions/checkout@") <
      text.indexOf("run: node scripts/release/release-intent.mjs"),
  );
  assert.ok(
    text.indexOf("run: node scripts/release/release-intent.mjs") <
      text.indexOf("googleapis/release-please-action@"),
  );
  assert.match(
    text,
    /googleapis\/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7/,
  );
});
