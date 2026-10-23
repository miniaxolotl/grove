// Compare the production route entry sets, including shared runtime chunks.
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { gzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const build =
  process.env.PERF_BUILD_DIR || resolve(root, "packages/website/.next");
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const manifest = JSON.parse(
  await readFile(`${build}/build-manifest.json`, "utf8"),
);
const routes = [
  "app/page",
  "app/memories/[id]/page",
  "app/projects/[id]/page",
  "app/settings/page",
  "(marketing)/page",
];
const report = {
  source:
    process.env.PERF_SOURCE ||
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
  buildId: (await readFile(`${build}/BUILD_ID`, "utf8")).trim(),
  builtAt: (await stat(`${build}/BUILD_ID`)).mtime.toISOString(),
  routes: {},
};
for (const route of routes) {
  // Keep stable report keys while the editor shares a persistent route-group layout.
  const entryRoute =
    route === "app/memories/[id]/page"
      ? "app/(notes)/memories/[id]/page"
      : route;
  const context = {};
  runInNewContext(
    await readFile(
      `${build}/server/app/${entryRoute}_client-reference-manifest.js`,
      "utf8",
    ),
    context,
    { timeout: 1000 },
  );
  const reference = Object.values(context.__RSC_MANIFEST)[0];
  const entry =
    reference.entryJSFiles[`[project]/packages/website/src/app/${entryRoute}`];
  if (!entry) throw new Error(`Missing route entry: ${route}`);
  const files = [...new Set([...manifest.rootMainFiles, ...entry])].filter(
    (file) => file.endsWith(".js"),
  );
  const chunks = await Promise.all(
    files.map(async (file) => {
      const contents = await readFile(`${build}/${file}`);
      return {
        file,
        raw: contents.length,
        gzip: gzipSync(contents).length,
        // A diagnostic marker, not an assertion of individual package size.
        containsEditor: contents.includes("cm-editor"),
      };
    }),
  );
  report.routes[route] = {
    raw: chunks.reduce((sum, chunk) => sum + chunk.raw, 0),
    gzip: chunks.reduce((sum, chunk) => sum + chunk.gzip, 0),
    chunks: chunks.sort((a, b) => b.gzip - a.gzip),
  };
}
if (args.includes("--compare")) {
  const before = JSON.parse(await readFile(option("--compare"), "utf8"));
  report.change = Object.fromEntries(
    routes.map((route) => [
      route,
      {
        gzipBytes: report.routes[route].gzip - before.routes[route].gzip,
        gzipPercent: Number(
          (
            (report.routes[route].gzip / before.routes[route].gzip - 1) *
            100
          ).toFixed(1),
        ),
      },
    ]),
  );
}
if (args.includes("--output"))
  await writeFile(option("--output"), `${JSON.stringify(report, null, 2)}\n`);
if (args.includes("--check")) {
  const notes = report.routes["app/page"];
  if (notes.gzip > 513351 || notes.chunks.some((chunk) => chunk.containsEditor))
    throw new Error(
      `Notes entry budget failed: ${notes.gzip} gzip bytes; editor must remain deferred (baseline 684469).`,
    );
}
console.log(
  JSON.stringify(
    args.includes("--summary") || args.includes("--check")
      ? {
          ...report,
          routes: Object.fromEntries(
            Object.entries(report.routes).map(([route, data]) => [
              route,
              { gzip: data.gzip },
            ]),
          ),
        }
      : report,
    null,
    2,
  ),
);
