import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import process from "node:process";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Internal ESM core only: no manifest, store identity, Node shim or provider config. */
export async function buildBrowserExtension({
  outdir = join(root, "packages/browser-extension/dist"),
} = {}) {
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
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({ options: { outdir: { type: "string" } } });
  await buildBrowserExtension(values);
}
