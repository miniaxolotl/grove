import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  rename,
  mkdir,
  symlink,
  readdir,
  realpath,
} from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { runProcess } from "./operator-io.mjs";
import { sourceInventory } from "./qualification.mjs";
import { verifyOperatorRoot } from "../../scripts/release/held-operator-bootstrap.mjs";
const api = await import("./trusted-install.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});
test(
  "real staged install materializes pnpm closure without symlink escapes and resolves source + operator dependencies",
  { timeout: 120000 },
  async () => {
    assert.equal(typeof api.stageTrustedInstall, "function");
    const repository = fileURLToPath(new URL("../../", import.meta.url)),
      base = await mkdtemp(process.cwd() + "/.trusted-install-");
    try {
      const source = "bae8decfd3865db837299b1ad81af9b71d67c158",
        inventory = sourceInventory(repository, source);
      const result = await api.stageTrustedInstall({
        repository,
        inventory,
        destination: base + "/bundle",
      });
      const operator = result.root + "/ops/held-operator";
      await verifyOperatorRoot(
        operator,
        { schema: 1, closureSha256: result.closureSha256 },
        { fixtureOnly: true },
      );
      const output = await runProcess(process.execPath, [
        "--input-type=module",
        "-e",
        `import {createRequire} from 'node:module';const r=createRequire(${JSON.stringify(result.root + "/package.json")});for(const n of ['pg','knex','objection','fflate'])r(n);const d=await import(${JSON.stringify("file://" + result.sourceRoot + "/lib/database/src/index.ts")});console.log(typeof d.createDatabase);`,
      ]);
      assert.match(output.toString(), /function/);
      const closure = JSON.parse(
        await readFile(operator + "/qualified-code.json"),
      );
      assert(closure.resolutions.length > 10);
      assert(closure.toolFiles.length > 5);
      assert.equal(closure.tools.pythonPath, await realpath("/usr/bin/python3"));
      assert(
        closure.toolFiles.some((file) => file.path === closure.tools.pythonPath),
      );
      const entry = Object.keys(closure.files).find((n) =>
        n.endsWith("node_modules/pg/lib/client.js"),
      );
      assert(entry);
      await writeFile(
        result.root + "/" + entry,
        'throw Error("tampered dependency")',
      );
      await assert.rejects(
        verifyOperatorRoot(
          operator,
          { schema: 1, closureSha256: result.closureSha256 },
          { fixtureOnly: true },
        ),
        /CODE_DRIFT/,
      );
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  },
);
test("staging vetoes replaced destination ancestry before extraction and never writes through replacement", async () => {
  const repository = fileURLToPath(new URL("../../", import.meta.url)),
    base = await mkdtemp(process.cwd() + "/.stage-race-");
  try {
    await mkdir(base + "/outside", { mode: 0o700 });
    let tar = false;
    const run = async (tool) => {
      if (tool === "git") {
        await rename(base + "/bundle", base + "/moved");
        await symlink(base + "/outside", base + "/bundle");
        return new Uint8Array();
      }
      tar = true;
      throw Error("unexpected extraction");
    };
    await assert.rejects(
      api.stageTrustedInstall({
        repository,
        inventory: sourceInventory(
          repository,
          "bae8decfd3865db837299b1ad81af9b71d67c158",
        ),
        destination: base + "/bundle",
        run,
      }),
      /PINNED|ENOTDIR/,
    );
    assert.equal(tar, false);
    assert.deepEqual(await readdir(base + "/outside"), []);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
