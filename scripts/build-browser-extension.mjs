import { build } from "esbuild";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { resolve, join, dirname } from "node:path";
import { parseArgs, TextEncoder } from "node:util";
import process from "node:process";
import { createRequire } from "node:module";
import { zipSync } from "fflate";

const root = fileURLToPath(new URL("..", import.meta.url));
const extensionRequire = createRequire(
  new URL("../packages/browser-extension/package.json", import.meta.url),
);

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
    "GROVE-LICENSE.txt": "LICENSE",
    "space-grotesk-OFL.txt":
      "packages/website/public/brand-kit/licenses/space-grotesk-OFL.txt",
    "space-grotesk-LICENSE.txt":
      "packages/website/public/brand-kit/licenses/space-grotesk-LICENSE.txt",
    "panel.html": "packages/browser-extension/src/panel.html",
    "panel.css": "packages/browser-extension/src/panel.css",
    "wordmark.svg": "packages/website/public/brand/wordmark-primary.svg",
    "space-grotesk-400.woff2":
      "packages/website/public/brand-kit/fonts/space-grotesk-400.woff2",
    "space-grotesk-600.woff2":
      "packages/website/public/brand-kit/fonts/space-grotesk-600.woff2",
  };
  const iconDirectory = "packages/browser-extension/assets/icons";
  const iconSource = JSON.parse(
    await readFile(join(root, iconDirectory, "source.json"), "utf8"),
  );
  for (const name of [...Object.keys(iconSource.files), "source.json"])
    assets[`icons/${name}`] = join(iconDirectory, name);
  const listingIcons = Object.fromEntries(
    [96, 128, 300, 512].map((size) => [size, `icons/store-${size}.png`]),
  );
  const themeIcons = [16, 20, 24, 32, 40, 48, 64, 96].map((size) => ({
    light: `icons/light-${size}.png`,
    dark: `icons/dark-${size}.png`,
    size,
  }));
  const packages = [];
  // Read the pinned data files, never bundle dictionary-en's Node fs loader.
  const dictionaryDirectory = resolve(
    extensionRequire.resolve("dictionary-en"),
    "..",
  );
  const dictionary = {
    aff: await readFile(join(dictionaryDirectory, "index.aff"), "utf8"),
    dic: await readFile(join(dictionaryDirectory, "index.dic"), "utf8"),
  };
  for (const target of report.targets) {
    const config = { apiOrigin, siteOrigin, issuer, target };
    const runtime = await build({
      absWorkingDir: root,
      // Prefer upstream DOM-free entity decoding in both the panel and worker.
      // The default browser decoder assigns innerHTML, which this reader avoids.
      conditions: ["worker"],
      entryPoints: [
        "packages/browser-extension/src/background.ts",
        "packages/browser-extension/src/panel.ts",
        "packages/browser-extension/src/content.ts",
      ],
      bundle: true,
      platform: "browser",
      format: "iife",
      target: "es2022",
      minify: true,
      legalComments: "none",
      sourcemap: false,
      metafile: true,
      plugins: [
        {
          name: "bundled-english-dictionary",
          setup(builder) {
            builder.onResolve({ filter: /^grove:english$/ }, () => ({
              path: "english",
              namespace: "grove-dictionary",
            }));
            builder.onLoad(
              { filter: /.*/, namespace: "grove-dictionary" },
              () => ({ contents: JSON.stringify(dictionary), loader: "json" }),
            );
          },
        },
      ],
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
      icons: listingIcons,
      action: {
        default_title: "Open Grove",
        // The supplied backed mark stays legible when Chromium's toolbar theme
        // cannot be selected natively. Firefox uses its native glyph variants.
        default_icon: "icons/store-128.png",
        ...(target === "firefox" ? { theme_icons: themeIcons } : {}),
      },
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
        "tabs",
        "contextMenus",
        "clipboardWrite",
        "scripting",
        ...(target === "firefox" ? [] : ["sidePanel"]),
      ],
      // Firefox match patterns cannot contain a port. CSP and runtime validation
      // still restrict every request to the exact configured HTTPS origins.
      host_permissions: [
        ...new Set(
          [apiOrigin, issuer].map(
            (host) =>
              `${target === "firefox" ? `https://${new URL(host).hostname}` : host}/*`,
          ),
        ),
        "http://*/*",
        "https://*/*",
      ],
      incognito: "not_allowed",
      content_scripts: [
        {
          matches: ["http://*/*", "https://*/*"],
          js: ["content.js"],
          run_at: "document_idle",
          all_frames: false,
        },
      ],
      content_security_policy: {
        extension_pages: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src ${apiOrigin} ${issuer}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      },
      ...(target === "firefox"
        ? {
            background: { scripts: ["background.js"] },
            sidebar_action: {
              default_title: "Grove",
              default_panel: "panel.html",
              default_icon: "icons/store-128.png",
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
    const dependencies = [
      ...new Set(
        Object.keys(runtime.metafile.inputs)
          .filter((input) => input.startsWith("node_modules/"))
          .map(
            (input) =>
              input.match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1],
          ),
      ),
    ].sort();
    const notices = [
      `dictionary-en 4.0.0 — SCOWL-derived en_US dictionary (MIT AND BSD)\n\n${await readFile(join(dictionaryDirectory, "license"), "utf8")}`,
    ];
    for (const directory of dependencies) {
      if (!directory) throw new Error("Unrecognized extension dependency path");
      const dependency = JSON.parse(
        await readFile(join(root, directory, "package.json"), "utf8"),
      );
      const license = (await readdir(join(root, directory))).find((name) =>
        /^licen[sc]e(?:\.(?:md|txt))?$/i.test(name),
      );
      if (!license)
        throw new Error(
          `Missing extension dependency license: ${dependency.name}`,
        );
      notices.push(
        `${dependency.name} ${dependency.version}\n\n${await readFile(join(root, directory, license), "utf8")}`,
      );
    }
    files["THIRD-PARTY-NOTICES.txt"] = new TextEncoder().encode(
      notices.join("\n\n---\n\n"),
    );
    for (const [name, path] of Object.entries(assets))
      files[name] = await readFile(join(root, path));
    for (const file of runtime.outputFiles)
      files[file.path.split("/").at(-1)] = file.contents;
    await mkdir(join(outdir, target), { recursive: true });
    const zipFiles = {};
    for (const name of Object.keys(files).sort()) {
      await mkdir(join(outdir, target, dirname(name)), { recursive: true });
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
