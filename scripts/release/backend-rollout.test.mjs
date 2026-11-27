import assert from "node:assert/strict";
import test from "node:test";
import { backendArguments, checkerReleaseEnabled } from "./backend-rollout.mjs";

const digest = `sha256:${"c".repeat(64)}`;
test("strict production flag carries only the verified digest into proposal and waited deployment", () => {
  const env = {
    GROVE_LANGUAGETOOL_DEPLOY: "true",
    GROVE_LANGUAGETOOL_DIGEST: digest,
  };
  assert.equal(checkerReleaseEnabled(env), true);
  assert.deepEqual(backendArguments("propose", env), [
    "--propose",
    "--release-checker",
    digest,
  ]);
  assert.deepEqual(backendArguments("deploy", env), [
    "--wait",
    "--release-checker",
    digest,
  ]);
  for (const value of [undefined, "", "false"]) {
    assert.equal(
      checkerReleaseEnabled({ GROVE_LANGUAGETOOL_DEPLOY: value }),
      false,
    );
    assert.deepEqual(
      backendArguments("deploy", { GROVE_LANGUAGETOOL_DEPLOY: value }),
      ["--wait"],
    );
  }
  for (const value of ["TRUE", "yes", "1", " "])
    assert.throws(() =>
      checkerReleaseEnabled({ GROVE_LANGUAGETOOL_DEPLOY: value }),
    );
  for (const value of [undefined, "latest", "sha-abc"])
    assert.throws(() =>
      backendArguments("deploy", { ...env, GROVE_LANGUAGETOOL_DIGEST: value }),
    );
  assert.throws(() => backendArguments("anything", env));
});
