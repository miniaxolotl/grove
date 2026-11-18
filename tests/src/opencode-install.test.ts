import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installIntegration } from "../../packages/mcp/src/install.ts";

test("install and remove edit only Grove plugin entries", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "grove-plugin-config-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
  });
  const directory = join(home, "opencode");
  await mkdir(directory);
  const path = join(directory, "opencode.jsonc");
  const other =
    '{ "package": "other", /* keep options */ "options": {"id":9007199254740993} }';
  const name = "@miniaxolotl/grove-opencode-plugin";
  await writeFile(path, `{"plugins": [${other} /* keep tail */]}`);
  await installIntegration("opencode");
  const added = await readFile(path, "utf8");
  assert(added.includes(other));
  assert(added.includes("/* keep tail */"));
  assert(added.includes(name));
  const pinned = `{"package":"${name}@1.2.3","options":{"private":true}}`;
  await writeFile(
    path,
    `{"plugins":[${pinned}, "${name}", /* keep next */ ${other}, "${name}",]}`,
  );
  await installIntegration("opencode");
  const deduped = await readFile(path, "utf8");
  assert(deduped.includes(pinned));
  assert.equal(deduped.split(name).length, 2);
  assert(deduped.indexOf(pinned) < deduped.indexOf(other));
  await installIntegration("opencode", true);
  const removed = await readFile(path, "utf8");
  assert(removed.includes(other));
  assert(removed.includes("/* keep next */"));
  assert(!removed.includes(name));
  await installIntegration("opencode", true);
  assert.equal(await readFile(path, "utf8"), removed);
  await writeFile(path, '{"plugins":{"not":"an array"}}');
  await assert.rejects(installIntegration("opencode"), {
    code: "invalid_config",
  });
  assert.equal(await readFile(path, "utf8"), '{"plugins":{"not":"an array"}}');
});
