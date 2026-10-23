import assert from "node:assert/strict";
import { URL } from "node:url";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("workflow lint bootstrap bounds transient reads without weakening archive integrity", () => {
  const script = readFileSync(
    new URL("./run-actionlint.sh", import.meta.url),
    "utf8",
  );
  assert.match(script, /--retry 2/);
  assert.match(script, /--retry-max-time 20/);
  assert.match(script, /--connect-timeout 5/);
  assert.match(script, /--max-time 10/);
  assert.doesNotMatch(script, /--retry-all-errors|--insecure/);
  assert.equal(
    [...script.matchAll(/expected_sha256="[a-f0-9]{64}"/g)].length,
    4,
  );
  assert.ok(
    script.indexOf('"$actual_sha256" != "$expected_sha256"') <
      script.indexOf("tar -xzf"),
  );
  assert.match(script, /checksum mismatch[\s\S]*exit 1/);
});
