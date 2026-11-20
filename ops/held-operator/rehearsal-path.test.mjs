import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { createRequire } from "node:module";
import { runRehearsalToolTests } from "./rehearsal.mjs";

test("rehearsal launches real dependency checks from installed source, not a distinct empty output parent", async () => {
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  const outputParent = await mkdtemp(
    resolve(repository, "..") + "/.rehearsal-output-",
  );
  try {
    assert.deepEqual(await readdir(outputParent), []);
    const pg = createRequire(repository + "lib/database/package.json").resolve(
      "pg",
    );
    assert(
      pg.startsWith(repository),
      "test must use this installation, never an old dependency tree",
    );
    const evidence = await runRehearsalToolTests({
      repository,
      outputParent,
      tests: [
        fileURLToPath(new URL("./qualification.test.mjs", import.meta.url)),
      ],
    });
    const text = evidence.toString();
    assert.match(text, /qualification binds installed dependency source bytes/);
    assert.match(text, /(?:#|ℹ) fail 0/);
    assert.deepEqual(
      await readdir(outputParent),
      ["authority-window-install.tap"],
      "artifact parent must contain evidence only, not dependencies or test roots",
    );
    assert.deepEqual(
      await readFile(outputParent + "/authority-window-install.tap"),
      evidence,
    );
  } finally {
    await rm(outputParent, { recursive: true, force: true });
  }
});
