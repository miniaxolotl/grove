import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import {
  mkdtemp,
  mkdir,
  rename,
  symlink,
  writeFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
const api = await import("./pinned-path.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});
test("pinned directory detects ancestor replacement; fd-relative cleanup never touches the replacement", async () => {
  assert.equal(typeof api.pinDirectory, "function");
  const base = await mkdtemp(process.cwd() + "/.pinned-");
  try {
    await mkdir(base + "/root", { mode: 0o700 });
    await mkdir(base + "/other", { mode: 0o700 });
    const pin = await api.pinDirectory(base + "/root");
    try {
      await writeFile(pin.path + "/owned", "old");
      await rename(base + "/root", base + "/moved");
      await symlink(base + "/other", base + "/root");
      await assert.rejects(pin.assert(), /PINNED|SYMLINK|ENOTDIR/);
      assert.equal(await readFile(pin.path + "/owned", "utf8"), "old");
      assert.deepEqual(await readdir(base + "/other"), []);
    } finally {
      await pin.close();
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
