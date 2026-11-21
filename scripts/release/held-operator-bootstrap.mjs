// Trusted product bootstrap: no caller-selected module is imported here.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open, lstat, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join, dirname } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { createRequire } from "node:module";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const readTrustedPin = async () =>
  JSON.parse(
    await readFile(new URL("./held-operator-trust.json", import.meta.url)),
  );
export async function assertImmutableCode(path) {
  assert(
    process.getuid() !== 0,
    "IMMUTABLE_CODE_REQUIRES_UNPRIVILEGED_OPERATOR",
  );
  for (let p = resolve(path); ; p = dirname(p)) {
    const s = await lstat(p);
    assert(
      !s.isSymbolicLink() && s.uid === 0 && (s.mode & 0o022) === 0,
      "IMMUTABLE_CODE_INSTALL_REQUIRED",
    );
    if (p === "/") break;
  }
}
export async function verifyOperatorRoot(
  root,
  pin,
  { fixtureOnly = false } = {},
) {
  assert(
    pin?.schema === 1 && /^[a-f0-9]{64}$/.test(pin.closureSha256 ?? ""),
    "OPERATOR_CODE_NOT_PINNED",
  );
  root = resolve(root);
  if (!fixtureOnly) await assertImmutableCode(root);
  const f = await open(
    join(root, "qualified-code.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let bytes;
  try {
    const s = await f.stat();
    assert(s.isFile() && s.nlink === 1 && s.size <= 8 * 1024 * 1024);
    bytes = await f.readFile();
  } finally {
    await f.close();
  }
  assert.equal(hash(bytes), pin.closureSha256, "OPERATOR_CLOSURE_DRIFT");
  const closure = JSON.parse(bytes);
  assert.equal(closure.schema, 1);
  assert([".", "../.."].includes(closure.base ?? "."));
  const base = resolve(root, closure.base ?? ".");
  assert(Object.keys(closure.files ?? {}).length > 0);
  for (const [name, expected] of Object.entries(closure.files)) {
    assert(
      !name.startsWith("/") &&
        !name.split("/").some((p) => p === ".." || p === "." || !p),
    );
    const path = join(base, name);
    if (!fixtureOnly) await assertImmutableCode(path);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      assert((await file.stat()).isFile());
      assert.equal(
        hash(await file.readFile()),
        expected,
        "OPERATOR_CODE_DRIFT",
      );
    } finally {
      await file.close();
    }
  }
  for (const file of closure.toolFiles ?? []) {
    assert(file.path.startsWith("/usr/"), "UNTRUSTED_OS_TOOL_PATH");
    if (!fixtureOnly) await assertImmutableCode(file.path);
    assert.equal(
      hash(await readFile(file.path)),
      file.sha256,
      "OPERATOR_TOOL_DRIFT",
    );
  }
  for (const item of closure.resolutions ?? []) {
    assert(
      !item.from.split("/").includes("..") &&
        !item.target.split("/").includes(".."),
    );
    const entry = createRequire(join(base, item.from)).resolve(item.specifier);
    let owner = dirname(await realpath(entry));
    for (;;) {
      try {
        if (
          JSON.parse(await readFile(owner + "/package.json")).name ===
          item.specifier
        )
          break;
      } catch {
        /* find package boundary */
      }
      assert.notEqual(owner, dirname(owner));
      owner = dirname(owner);
    }
    assert.equal(
      owner,
      join(base, dirname(item.target)),
      "OPERATOR_DEPENDENCY_RESOLUTION_DRIFT",
    );
  }
  if (!fixtureOnly) {
    assert(
      closure.resolutions?.length &&
        closure.toolFiles?.length &&
        closure.tools?.nodeSha256,
      "OPERATOR_COMPLETE_CLOSURE_REQUIRED",
    );
    const executable = await realpath(process.execPath);
    await assertImmutableCode(executable);
    assert.equal(
      hash(await readFile(executable)),
      closure.tools.nodeSha256,
      "OPERATOR_NODE_DRIFT",
    );
  }
  // Root-owned immutable ancestry is an explicit OS privilege boundary. This
  // does not claim protection against root/admin changing the installation.
  return root;
}
