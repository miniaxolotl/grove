import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { resolve, join } from "node:path";
import { parseArgs, TextEncoder } from "node:util";
import process from "node:process";
import { zipSync } from "fflate";

const root = fileURLToPath(new URL("..", import.meta.url));

function origin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.username ||
    url.password
  )
    throw new Error("Extension hosts must be exact HTTPS origins");
  return url.origin;
}

/** Shared product version, browser-only bundles and reproducible unsigned packages. */
export async function buildBrowserExtension({
  outdir = join(root, "packages/browser-extension/dist"),
  apiOrigin = "https://api.usegrove.cloud",
  siteOrigin = "https://usegrove.cloud",
  issuer = "https://clerk.usegrove.cloud",
} = {}) {
  [apiOrigin, siteOrigin, issuer].forEach(origin);
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["packages/browser-extension/src/index.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    minify: true,
    legalComments: "none",
    sourcemap: false,
    metafile: true,
    write: false,
    outfile: "core.js",
  });
  const code = result.outputFiles[0].contents;
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const report = {
    kind: "internal-browser-core",
    sourceVersion: pkg.version,
    targets: ["chrome", "firefox", "edge"],
    sha256: createHash("sha256").update(code).digest("hex"),
    bytes: code.byteLength,
    inputs: Object.keys(result.metafile.inputs).sort(),
    imports: Object.values(result.metafile.outputs).flatMap(
      (output) => output.imports,
    ),
  };
  await mkdir(outdir, { recursive: true });
  await writeFile(join(outdir, "core.js"), code);
  await writeFile(
    join(outdir, "core.build.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const assets = {
    "panel.html": "packages/browser-extension/src/panel.html",
    "panel.css": "packages/browser-extension/src/panel.css",
    "wordmark.svg": "packages/website/public/brand/wordmark-primary.svg",
    "icon.png": "packages/website/public/brand-kit/icons/icon-192.png",
    "space-grotesk-400.woff2":
      "packages/website/public/brand-kit/fonts/space-grotesk-400.woff2",
    "space-grotesk-600.woff2":
      "packages/website/public/brand-kit/fonts/space-grotesk-600.woff2",
  };
  const packages = [];
  for (const target of report.targets) {
    const config = { apiOrigin, siteOrigin, issuer, target };
    const runtime = await build({
      absWorkingDir: root,
      entryPoints: [
        "packages/browser-extension/src/background.ts",
        "packages/browser-extension/src/panel.ts",
      ],
      bundle: true,
      platform: "browser",
      format: "iife",
      target: "es2022",
      minify: true,
      legalComments: "none",
      sourcemap: false,
      metafile: true,
      define: { __GROVE_EXTENSION_CONFIG__: JSON.stringify(config) },
      write: false,
      outdir: "runtime",
    });
    const imports = Object.values(runtime.metafile.outputs).flatMap(
      (output) => output.imports,
    );
    if (
      imports.length ||
      Object.keys(runtime.metafile.inputs).some((input) =>
        /^(lib\/(database|memory|environment|providers)\/|packages\/mcp\/)/.test(
          input,
        ),
      )
    )
      throw new Error("Extension runtime contains unbundled or server imports");
    const manifest = {
      manifest_version: 3,
      name: "Grove — private notes",
      version: pkg.version,
      description:
        "Save reviewed notes and sources, search your Grove notebooks, and copy selected context.",
      homepage_url: siteOrigin,
      icons: { 192: "icon.png" },
      action: { default_title: "Open Grove", default_icon: "icon.png" },
      commands: {
        _execute_action: {
          suggested_key: { default: "Alt+Shift+G" },
          description: "Open Grove",
        },
      },
      permissions: [
        "storage",
        "identity",
        "activeTab",
        "contextMenus",
        "clipboardWrite",
        ...(target === "firefox" ? [] : ["sidePanel"]),
      ],
      host_permissions: [...new Set([apiOrigin, issuer])].map(
        (host) => `${host}/*`,
      ),
      incognito: "not_allowed",
      content_security_policy: {
        extension_pages: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src ${apiOrigin} ${issuer}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      },
      ...(target === "firefox"
        ? {
            background: { scripts: ["background.js"] },
            sidebar_action: {
              default_title: "Grove",
              default_panel: "panel.html",
              default_icon: "icon.png",
            },
            browser_specific_settings: {
              gecko: {
                id: "grove@usegrove.cloud",
                strict_min_version: "142.0",
                data_collection_permissions: {
                  required: [
                    "authenticationInfo",
                    "websiteContent",
                    "browsingActivity",
                    "searchTerms",
                  ],
                },
              },
            },
          }
        : {
            minimum_chrome_version: "127",
            background: { service_worker: "background.js" },
            side_panel: { default_path: "panel.html" },
          }),
    };
    const files = {
      "manifest.json": new TextEncoder().encode(
        `${JSON.stringify(manifest, null, 2)}\n`,
      ),
    };
    for (const [name, path] of Object.entries(assets))
      files[name] = await readFile(join(root, path));
    for (const file of runtime.outputFiles)
      files[file.path.split("/").at(-1)] = file.contents;
    await mkdir(join(outdir, target), { recursive: true });
    const zipFiles = {};
    for (const name of Object.keys(files).sort()) {
      await writeFile(join(outdir, target, name), files[name]);
      // ZIP encodes local wall-clock fields, not an instant. Keep them fixed in every TZ.
      zipFiles[name] = [files[name], { mtime: new Date(2000, 0, 1, 0, 0, 0) }];
    }
    const zip = zipSync(zipFiles, { level: 9 });
    await writeFile(join(outdir, `grove-${target}.zip`), zip);
    packages.push({
      target,
      sourceVersion: pkg.version,
      config,
      sha256: createHash("sha256").update(zip).digest("hex"),
      inputs: Object.keys(runtime.metafile.inputs).sort(),
      files: Object.fromEntries(
        Object.keys(files)
          .sort()
          .map((name) => [
            name,
            createHash("sha256").update(files[name]).digest("hex"),
          ]),
      ),
    });
  }
  await writeFile(
    join(outdir, "packages.build.json"),
    `${JSON.stringify(packages, null, 2)}\n`,
  );
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: Object.fromEntries(
      ["outdir", "apiOrigin", "siteOrigin", "issuer"].map((name) => [
        name,
        { type: "string" },
      ]),
    ),
  });
  await buildBrowserExtension(values);
}
