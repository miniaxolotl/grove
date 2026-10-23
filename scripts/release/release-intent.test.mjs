import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReleaseIntent } from "./release-intent.mjs";
test("routine changes remain patch-first and explicit higher versions are retained", () => {
  assert.equal(
    assertReleaseIntent(["feat(api): capability", "fix(api): repair"], "1.2.3"),
    null,
  );
  assert.equal(
    assertReleaseIntent(
      ["feat(api): capability\n\nRelease-As: 1.3.0"],
      "1.2.3",
    ),
    "1.3.0",
  );
  assert.equal(assertReleaseIntent([], "1.2.3"), null);
});
test("breaking changes require an explicit version decision before source automation", () => {
  for (const message of [
    "feat(api)!: incompatible",
    "fix: change\n\nBREAKING CHANGE: incompatible",
    "fix: change\n\nBREAKING-CHANGE: incompatible",
  ])
    assert.throws(() => assertReleaseIntent([message], "1.2.3"), /explicit/);
  assert.equal(
    assertReleaseIntent(
      [
        "feat(api)!: incompatible",
        "chore(release): select version\n\nRelease-As: 2.0.0",
      ],
      "1.2.3",
    ),
    "2.0.0",
  );
});
test("malformed, conflicting and non-increasing explicit versions fail closed", () => {
  for (const value of ["1.2.3", "1.2.2", "v1.3.0", "1.3.0-beta.1", "invalid"])
    assert.throws(() =>
      assertReleaseIntent([`chore: decision\n\nRelease-As: ${value}`], "1.2.3"),
    );
  assert.throws(() =>
    assertReleaseIntent(
      ["feat: one\n\nRelease-As: 1.3.0", "feat: two\n\nRelease-As: 2.0.0"],
      "1.2.3",
    ),
  );
});
