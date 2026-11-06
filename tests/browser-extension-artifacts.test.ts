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
import { unzipSync } from "fflate";

const root = resolve(import.meta.dirname, "..");
const exec = promisify(execFile);

test("custom-port Firefox builds use supported hostname permissions and retain exact-port CSP and runtime hosts", async () => {
  const directory = await mkdtemp(
    join(process.env.CI ? tmpdir() : "/tmp/opencode", "grove-browser-ports-"),
  );
  await exec(
    process.execPath,
    [
      join(root, "scripts/build-browser-extension.mjs"),
      "--outdir",
      directory,
      "--apiOrigin",
      "https://localhost:4410",
      "--issuer",
      "https://localhost:4412",
    ],
    { cwd: root },
  );
  for (const target of ["chrome", "firefox", "edge"]) {
    const manifest = JSON.parse(
      await readFile(join(directory, target, "manifest.json"), "utf8"),
    );
    assert.deepEqual(
      manifest.host_permissions,
      target === "firefox"
        ? ["https://localhost/*"]
        : ["https://localhost:4410/*", "https://localhost:4412/*"],
    );
    assert.ok(
      manifest.content_security_policy.extension_pages.includes(
        "connect-src https://localhost:4410 https://localhost:4412;",
      ),
    );
    assert.ok(
      !manifest.content_security_policy.extension_pages.includes("localhost:*"),
    );
  }
});

test("browser packages preserve the isolated core, reproducible ZIPs, licenses and restricted manifests", async () => {
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
    "chrome",
    "core.build.json",
    "core.js",
    "edge",
    "firefox",
    "grove-chrome.zip",
    "grove-edge.zip",
    "grove-firefox.zip",
    "packages.build.json",
  ]);
  const second = await build("second");
  for (const target of ["chrome", "firefox", "edge"]) {
    const zip = await readFile(join(artifact.outdir, `grove-${target}.zip`));
    assert.deepEqual(
      zip,
      await readFile(join(second.outdir, `grove-${target}.zip`)),
    );
    const files = unzipSync(zip);
    const manifest = JSON.parse(
      new TextDecoder().decode(files["manifest.json"]),
    );
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, artifact.report.sourceVersion);
    assert.deepEqual(manifest.host_permissions, [
      "https://api.usegrove.cloud/*",
      "https://clerk.usegrove.cloud/*",
    ]);
    assert.equal(manifest.incognito, "not_allowed");
    assert.ok(
      !manifest.content_scripts &&
        !manifest.web_accessible_resources &&
        !manifest.externally_connectable,
    );
    assert.ok(
      !manifest.permissions.includes("tabs") &&
        manifest.permissions.includes("scripting"),
    );
    assert.deepEqual(manifest.optional_host_permissions, [
      "http://*/*",
      "https://*/*",
    ]);
    assert.ok(
      manifest.content_security_policy.extension_pages.includes(
        "object-src 'none'",
      ),
    );
    assert.ok(
      !manifest.content_security_policy.extension_pages.includes("unsafe"),
    );
    if (target === "firefox") {
      assert.deepEqual(manifest.background, { scripts: ["background.js"] });
      assert.equal(manifest.sidebar_action.default_panel, "panel.html");
      assert.ok(manifest.browser_specific_settings.gecko.id);
    } else {
      assert.equal(manifest.background.service_worker, "background.js");
      assert.equal(manifest.side_panel.default_path, "panel.html");
    }
    for (const required of [
      "background.js",
      "panel.js",
      "content.js",
      "panel.html",
      "panel.css",
      "wordmark.svg",
      "icon.png",
      "space-grotesk-400.woff2",
      "space-grotesk-OFL.txt",
      "GROVE-LICENSE.txt",
      "THIRD-PARTY-NOTICES.txt",
    ])
      assert.ok(files[required], required);
    const js = new TextDecoder().decode(files["background.js"]);
    assert.ok(!/node:|createRequire|process\.env|@sentry|posthog/.test(js));
  }
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

test("root build and quality scripts include the private browser package", async () => {
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
