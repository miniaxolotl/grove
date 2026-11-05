import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createContext, runInContext } from "node:vm";
import { transform } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const exec = promisify(execFile);

test("extension core bundles without Node, server dependencies, credentials or installation claims", async () => {
  const script = join(root, "scripts/build-browser-extension.mjs");
  assert.ok(existsSync(script), "the browser-only build must exist");
  const base = process.env.CI ? tmpdir() : "/tmp/opencode";
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "grove-browser-core-"));
  const build = async (name: string) => {
    const outdir = join(directory, name);
    await exec(process.execPath, [script, "--outdir", outdir], { cwd: root });
    return {
      outdir,
      code: await readFile(join(outdir, "core.js"), "utf8"),
      report: JSON.parse(
        await readFile(join(outdir, "core.build.json"), "utf8"),
      ),
    };
  };
  const artifact = await build("first");
  assert.equal(artifact.report.kind, "internal-browser-core");
  assert.deepEqual(artifact.report.targets, ["chrome", "firefox", "edge"]);
  assert.deepEqual(artifact.report.imports, []);
  assert.equal(
    artifact.report.sha256,
    createHash("sha256").update(artifact.code).digest("hex"),
  );
  assert.equal(artifact.report.bytes, Buffer.byteLength(artifact.code));
  assert.ok(artifact.report.inputs.length > 0);
  assert.ok(
    artifact.report.inputs.every((file: string) =>
      /^(packages\/browser-extension\/src\/|lib\/shared\/src\/|node_modules\/.*\/zod\/)/.test(
        file,
      ),
    ),
    "browser bundle may only include reviewed core, shared contracts and Zod",
  );
  assert.ok(
    !/node:|process\.env|createRequire|@sentry|posthog|fetch\(/.test(
      artifact.code,
    ),
  );
  assert.deepEqual((await readdir(artifact.outdir)).sort(), [
    "core.build.json",
    "core.js",
  ]);
  const second = await build("second");
  assert.equal(
    second.code,
    artifact.code,
    "build output must not depend on output location/time",
  );

  // Run the bundled exports without Node globals, DOM, credentials or fetch.
  // This validates the internal core only, not native extension installation.
  const transformed = await transform(artifact.code, {
    format: "iife",
    globalName: "GroveCore",
  });
  const context = createContext(
    { URL, URLSearchParams },
    {
      codeGeneration: { strings: false, wasm: false },
    },
  );
  assert.throws(
    () => runInContext("new Function('return 1')()", context),
    /Code generation from strings disallowed/,
  );
  const core = runInContext(`${transformed.code}\nGroveCore`, context, {
    timeout: 5000,
  });
  assert.equal(
    core.normalizeWebUrl("https://example.com/?id=1&utm_source=test"),
    "https://example.com/?id=1",
  );
  assert.equal(core.formatWebCapture({ text: "A note" }), "A note");
  assert.equal(core.browserProfile("firefox").panelApi, "sidebarAction");
  assert.equal(typeof core.createCaptureDraft, "function");
  const now = 1;
  const scope = {
    origin: "https://api.example.com",
    accountId: "00000000-0000-4000-a000-000000000001",
    connectionId: "00000000-0000-4000-a000-000000000002",
  };
  const draft = core.createCaptureDraft({
    scope,
    text: "Sandbox note",
    projectId: null,
    now,
  });
  const prepared = core.prepareCaptureSave(
    draft,
    scope,
    "00000000-0000-4000-a000-000000000003",
    now,
  );
  assert.equal(prepared.save.request.content, "Sandbox note");
});

test("root build and quality scripts include the private browser core", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.ok(pkg.scripts.lint.includes("packages/browser-extension/src"));
  assert.ok(
    pkg.scripts["test:artifacts"].includes(
      "browser-extension-artifacts.test.ts",
    ),
  );
  assert.ok(
    existsSync(join(root, "packages/browser-extension/dist/core.js")),
    "run pnpm build before artifacts",
  );
  const browser = JSON.parse(
    await readFile(
      join(root, "packages/browser-extension/package.json"),
      "utf8",
    ),
  );
  assert.equal(browser.private, true);
  assert.equal(
    browser.version,
    undefined,
    "no independent product version authority",
  );
});
