import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertReleaseIntent,
  assertManifestVersion,
  reconcileGroveReleaseHistory,
} from "./release-intent.mjs";
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
test("a previously generated minor or major PR cannot bypass the explicit version decision", () => {
  assert.doesNotThrow(() => assertManifestVersion("1.2.3", "1.2.3", null));
  assert.doesNotThrow(() => assertManifestVersion("1.2.3", "1.2.4", null));
  assert.doesNotThrow(() => assertManifestVersion("1.2.3", "1.3.0", "1.3.0"));
  for (const version of ["1.3.0", "2.0.0", "1.2.5", "1.2.2"])
    assert.throws(() => assertManifestVersion("1.2.3", version, null));
  assert.throws(() => assertManifestVersion("1.2.3", "1.3.0", "2.0.0"));
});

const source16 = "0ee29d9c96b532af6ebfadc7c38026843c122029";
const source19 = "7b36ba690553437a3d1c987db8d9b104f4f175fe";
const superseded = {
  sha: "27eed31fad3269be923ecfe57ac04cd42b92e39a",
  message: "chore: prepare\n\nRelease-As: 1.11.18",
};
const selected19 = {
  sha: "a30ec65fc6b72dfc60855a4bfaa24502d6415c78",
  message: "chore: select\n\nRelease-As: 1.11.19",
};
const generated19 = {
  sha: source19,
  message: "chore(release): release 1.11.19 (#196)",
};
const later = { sha: "a".repeat(40), message: "feat(ui): follow-up" };

test("reconciles Grove's superseded v1.11.18 decision before the v1.11.19 tag", () => {
  const messages = reconcileGroveReleaseHistory("v1.11.16", source16, [
    later,
    selected19,
    generated19,
    superseded,
  ]);
  assert.deepEqual(messages, [
    later.message,
    selected19.message,
    generated19.message,
    "chore: prepare\n\n",
  ]);
  const selected = assertReleaseIntent(messages, "1.11.16");
  assert.equal(selected, "1.11.19");
  assertManifestVersion("1.11.16", "1.11.19", selected);
  assert.throws(() => assertManifestVersion("1.11.16", "1.11.20", selected));
});

test("allows the next patch after Release Please tags the older generated release commit", () => {
  const messages = reconcileGroveReleaseHistory("v1.11.19", source19, [
    later,
    selected19,
  ]);
  assert.deepEqual(messages, [later.message, "chore: select\n\n"]);
  const selected = assertReleaseIntent(messages, "1.11.19");
  assert.equal(selected, null);
  assertManifestVersion("1.11.19", "1.11.20", selected);
});

test("reconciliation does not accept a different tag target, missing decision, or a new conflicting footer", () => {
  for (const [tag, source, history] of [
    ["v1.11.16", source19, [selected19, generated19, superseded]],
    ["v1.11.16", source16, [selected19, superseded]],
    ["v1.11.16", source16, [superseded, selected19]],
    ["v1.11.16", source16, [{ ...selected19, sha: later.sha }, superseded]],
    [
      "v1.11.16",
      source16,
      [
        selected19,
        generated19,
        {
          ...superseded,
          message: superseded.message + "\nRelease-As: 1.11.18",
        },
      ],
    ],
    [
      "v1.11.16",
      source16,
      [
        { ...later, message: "chore: new\n\nRelease-As: 1.11.20" },
        selected19,
        generated19,
        superseded,
      ],
    ],
    ["v1.11.19", source16, [selected19]],
    ["v1.11.19", source19, [{ ...selected19, sha: later.sha }]],
  ]) {
    assert.throws(() =>
      assertReleaseIntent(
        reconcileGroveReleaseHistory(tag, source, history),
        tag.slice(1),
      ),
    );
  }
});
