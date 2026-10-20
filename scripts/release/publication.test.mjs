import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import { assertRepository, waitForPublication } from "./publication.mjs";

test("every published artifact identifies the provenance repository", () => {
  for (const name of [
    "api",
    "mcp",
    "grove-opencode-plugin",
    "grove-claude-plugin",
    "grove-codex-plugin",
  ]) {
    const pkg = JSON.parse(
      readFileSync(
        new URL(`../../packages/${name}/package.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.doesNotThrow(() => assertRepository(pkg), name);
  }
  for (const repository of [
    undefined,
    { type: "git", url: "https://github.com/other/grove.git" },
  ]) {
    assert.throws(
      () => assertRepository({ name: "bad", repository }),
      /repository/,
    );
  }
});

test("registry readback tolerates propagation and fails closed on conflicts, provider errors and timeout", async () => {
  const artifact = { name: "package@1.2.0", integrity: "correct" };
  let reads = 0,
    waits = 0;
  await waitForPublication(artifact, {
    lookup: () => (++reads === 3 ? "correct" : null),
    wait: async () => {
      waits++;
    },
    attempts: 3,
  });
  assert.equal(reads, 3);
  assert.equal(waits, 2);
  const failWait = async () => {
    assert.fail("must not retry conflicts or provider errors");
  };
  await assert.rejects(
    waitForPublication(artifact, { lookup: () => "wrong", wait: failWait }),
    /differs/,
  );
  await assert.rejects(
    waitForPublication(artifact, {
      lookup: () => {
        throw new Error("unavailable");
      },
      wait: failWait,
    }),
    /unavailable/,
  );
  await assert.rejects(
    waitForPublication(artifact, {
      lookup: () => null,
      wait: async () => {},
      attempts: 2,
    }),
    /not visible/,
  );
});
