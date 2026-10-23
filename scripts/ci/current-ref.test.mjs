import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCurrentRef } from "./current-ref.mjs";
const context = {
  repository: "bramble-labs/website",
  ref: "refs/heads/production",
  sha: "a".repeat(40),
  protected: "true",
};
test("mutation fence reads the exact protected repository and branch", () => {
  assert.equal(
    assertCurrentRef(context, (path) => {
      assert.equal(path, "repos/bramble-labs/website/git/ref/heads/production");
      return { object: { sha: context.sha } };
    }),
    context.sha,
  );
});
test("superseded, missing, unprotected and unsupported operations fail closed", () => {
  assert.throws(() =>
    assertCurrentRef(context, () => ({ object: { sha: "b".repeat(40) } })),
  );
  assert.throws(() => assertCurrentRef(context, () => ({})));
  for (const change of [
    { protected: "false" },
    { ref: "refs/heads/development" },
    { repository: "foreign/repo" },
    { sha: "HEAD" },
  ])
    assert.throws(() =>
      assertCurrentRef({ ...context, ...change }, () =>
        assert.fail("invalid context must not read"),
      ),
    );
});
