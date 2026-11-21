import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
  access,
} from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { join } from "node:path";
import { pythonExecutable, isolatedPythonArgs } from "./python.mjs";
import { sha } from "./operator-control.mjs";
import { verifyOperatorRoot } from "../../scripts/release/held-operator-bootstrap.mjs";

const script = (name) => fileURLToPath(new URL("./" + name, import.meta.url));
function python(executable, args) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function fixture(run) {
  const root = await mkdtemp(process.cwd() + "/.python-isolation-");
  try {
    const venv = join(root, "venv");
    python(pythonExecutable, [
      "-I",
      "-S",
      "-B",
      "-m",
      "venv",
      "--without-pip",
      "--symlinks",
      venv,
    ]);
    const executable = join(venv, "bin/python3");
    const purelib = python(executable, [
      "-I",
      "-B",
      "-c",
      'import sysconfig;print(sysconfig.get_path("purelib"))',
    ]).trim();
    assert(purelib.startsWith(venv + "/"));
    const marker = join(root, "site-ran"),
      hook = join(purelib, "grove_operator_fixture_hook.py");
    await writeFile(
      hook,
      `from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text("hook executed")\n`,
    );
    // A system hook can win before the virtualenv's sitecustomize. Model that
    // ordering in this disposable prefix without modifying the OS installation.
    await writeFile(
      join(purelib, "00-preexisting-site-hook.pth"),
      'import sys, types; sys.modules["sitecustomize"] = types.ModuleType("sitecustomize")\n',
    );
    await writeFile(
      join(purelib, "10-grove-fixture-hook.pth"),
      "import grove_operator_fixture_hook\n",
    );
    await run({ root, executable, marker, hook });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("the old isolated launch executes a prefix startup hook even when sitecustomize is shadowed", async () =>
  fixture(async ({ root, executable, marker, hook }) => {
    const toolchain = JSON.parse(
      python(executable, ["-I", "-B", script("authority.py"), "--toolchain"]),
    );
    assert.equal(await readFile(marker, "utf8"), "hook executed");
    assert(toolchain.files.includes(await realpath(hook)));
    const code = join(root, "code");
    await mkdir(code, { mode: 0o700 });
    const bytes = "export const syntheticFixture = true;\n";
    await writeFile(code + "/operator-plan.mjs", bytes);
    const closure = JSON.stringify({
      schema: 1,
      files: { "operator-plan.mjs": sha(bytes) },
      toolFiles: [
        { path: await realpath(hook), sha256: sha(await readFile(hook)) },
      ],
    });
    await writeFile(code + "/qualified-code.json", closure);
    await assert.rejects(
      verifyOperatorRoot(
        code,
        { schema: 1, closureSha256: sha(closure) },
        { fixtureOnly: true },
      ),
      /UNTRUSTED_OS_TOOL_PATH/,
    );
  }));

test("actual operational Python arguments disable site before stdlib imports or either toolchain discovery", async () =>
  fixture(async ({ executable, marker }) => {
    assert.equal(
      pythonExecutable,
      "/usr/bin/python3",
      "no mutable interpreter admission option",
    );
    const probe = JSON.parse(
      python(
        executable,
        isolatedPythonArgs(
          "-c",
          'import sys,json,sqlite3,ctypes,subprocess,selectors;print(json.dumps({"site":"site" in sys.modules,"sitecustomize":"sitecustomize" in sys.modules,"isolated":sys.flags.isolated,"no_site":sys.flags.no_site,"dont_write_bytecode":sys.dont_write_bytecode}))',
        ),
      ),
    );
    assert.deepEqual(probe, {
      site: false,
      sitecustomize: false,
      isolated: 1,
      no_site: 1,
      dont_write_bytecode: true,
    });
    for (const name of ["authority.py", "subprocess.py"]) {
      const toolchain = JSON.parse(
        python(executable, isolatedPythonArgs(script(name), "--toolchain")),
      );
      assert(toolchain.files.length > 5);
      assert(
        toolchain.files.every((path) => path.startsWith("/usr/")),
        "discovery included code outside the permitted OS closure",
      );
      assert(
        toolchain.files.every(
          (path) =>
            !/(?:sitecustomize|usercustomize|\/site\.py|\/site-packages\/)/.test(
              path,
            ),
        ),
      );
    }
    await assert.rejects(access(marker), { code: "ENOENT" });
  }));

test("the fixed system interpreter can import every operational stdlib dependency without site", () => {
  const probe = JSON.parse(
    python(
      pythonExecutable,
      isolatedPythonArgs(
        "-c",
        'import sys,json,sqlite3,ctypes,fcntl,selectors,subprocess;print(json.dumps({"site":"site" in sys.modules,"no_site":sys.flags.no_site}))',
      ),
    ),
  );
  assert.deepEqual(probe, { site: false, no_site: 1 });
});
