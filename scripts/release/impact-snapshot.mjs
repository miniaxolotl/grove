// Run on reviewed source in a credential-free build environment. All mutations
// (including version normalization and build-generated skills) stay in scratch.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { packArtifact } from "./pack.mjs";
import { prepareAssets } from "./assets.mjs";

const packages = [
  "api",
  "mcp",
  "grove-claude-plugin",
  "grove-codex-plugin",
  "grove-opencode-plugin",
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", ...opts });

function files(dir, prefix = "") {
  const result = {};
  for (const name of readdirSync(join(dir, prefix))) {
    const path = join(prefix, name),
      full = join(dir, path),
      stat = statSync(full);
    if (stat.isDirectory()) Object.assign(result, files(dir, path));
    else result[path] = `${stat.mode & 0o777}:${sha(readFileSync(full))}`;
  }
  return result;
}

function normalize(dir) {
  const version = json(join(dir, "package.json")).version;
  // An independently edited install pin stays visible. Only neutralize the
  // fields currently stamped to the coordinated product version.
  for (const path of [
    "package.json",
    ...packages.map((p) => `packages/${p}/package.json`),
    "packages/grove-claude-plugin/.claude-plugin/plugin.json",
    "packages/grove-codex-plugin/plugin.json",
    ".agents/plugins/marketplace.json",
    ".claude-plugin/marketplace.json",
  ]) {
    const full = join(dir, path),
      data = json(full);
    const field = path.endsWith("marketplace.json")
      ? data.plugins[0].source
      : data;
    if (field.version === version) field.version = "0.0.0";
    writeFileSync(full, JSON.stringify(data, null, 2) + "\n");
  }
}

export function inputBucket(path, docs) {
  if (
    docs.has(path) ||
    /^packages\/website\/(src\/|public\/|package\.json$|next\.config\.|postcss\.config\.|tsconfig\.json$|vercel\.json$)/.test(
      path,
    ) ||
    /^lib\/(shared|typescript-config)\//.test(path)
  )
    return "website";
  if (
    /^(Dockerfile$|\.dockerignore$|\.do\/|scripts\/deploy-digitalocean\.mjs$)/.test(
      path,
    )
  )
    return "service";
  // These inputs are represented by actual packed files (including LICENSE),
  // or are validation/bookkeeping. New config and library roots need review.
  if (
    /^(LICENSE$|lib\/(ai|config|database|environment|integration-core|memory|telemetry)\/src\/|packages\/(api|mcp|browser-extension|grove-(claude|codex|opencode)-plugin)\/|packages\/website\/(tests\/|playwright\.|README\.md$|AGENTS\.md$)|documentation\/|tests\/|CHANGELOG\.md$|\.release-please-manifest\.json$|scripts\/release\/impact-|scripts\/.*\.test\.mjs$)/.test(
      path,
    )
  )
    return null;
  return "watch";
}

async function sourceInputs(dir, source) {
  const buckets = { website: {}, service: {}, watch: {} };
  const { documentation } = await import(
    pathToFileURL(join(dir, "packages/website/src/content/documentation.ts"))
  );
  const docs = new Set(
    documentation.map((doc) => `documentation/${doc.source}`),
  );
  const paths = run("git", ["ls-tree", "--name-only", "-rz", source])
    .split("\0")
    .filter(Boolean);
  for (const path of paths) {
    const bucket = inputBucket(path, docs);
    if (bucket)
      buckets[bucket][path] =
        `${statSync(join(dir, path)).mode & 0o111}:${sha(readFileSync(join(dir, path)))}`;
  }
  return buckets;
}

export async function snapshot(ref, stamped = false) {
  const source = run("git", [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${ref}^{commit}`,
  ]).trim();
  const tmp = mkdtempSync(join(tmpdir(), "grove-impact-")),
    dir = join(tmp, "source");
  try {
    mkdirSync(dir);
    run("git", ["archive", "--output", join(tmp, "source.tar"), source]);
    run("tar", ["-xf", join(tmp, "source.tar"), "-C", dir]);
    if (!stamped) normalize(dir);
    const { website, service, watch } = await sourceInputs(dir, source);
    const targets = { website, service, downloads: {} },
      integrity = {};
    const opts = {
      cwd: dir,
      stdio: ["ignore", 2, 2],
      env: {
        ...process.env,
        CI: "true",
        ONNXRUNTIME_NODE_INSTALL_CUDA: "skip",
        GROVE_TELEMETRY_BUILD: stamped
          ? process.env.GROVE_TELEMETRY_BUILD
          : "comparison",
        RELEASE_SOURCE_SHA: source,
      },
    };
    run("pnpm", ["install", "--frozen-lockfile", "--offline"], opts);
    run("node", ["scripts/build.mjs"], opts);
    for (const pkg of packages) {
      const out = join(tmp, pkg),
        workspace = join(dir, "packages", pkg);
      const archive = packArtifact(workspace, out);
      const name =
        "npm:" + json(join(workspace, "package.json")).name.split("/")[1];
      run("tar", ["-xzf", archive, "-C", out]);
      targets[name] = files(join(out, "package"));
      if (pkg === "api") {
        // The final image contains pnpm's production deploy, not the build context.
        Object.assign(
          service,
          Object.fromEntries(
            Object.entries(targets[name]).filter(
              ([path]) => path.startsWith("dist/") || path === "package.json",
            ),
          ),
        );
      }
      integrity[name] =
        "sha512-" +
        createHash("sha512").update(readFileSync(archive)).digest("base64");
    }
    const dist = join(dir, "packages/browser-extension/dist");
    const assets = Object.fromEntries(
      [
        "packages.build.json",
        ...["chrome", "edge", "firefox"].map((b) => `grove-${b}.zip`),
      ].map((name) => [name, readFileSync(join(dist, name))]),
    );
    for (const { name, bytes } of await prepareAssets({
      version: json(join(dir, "package.json")).version,
      sourceSha: source,
      files: assets,
    }))
      integrity[name] = "sha256:" + sha(bytes);
    for (const { target, files } of JSON.parse(assets["packages.build.json"])) {
      for (const [path, digest] of Object.entries(files))
        targets.downloads[`${target}/${path}`] = digest;
    }
    return {
      policy: 1,
      mode: stamped ? "stamped" : "comparison",
      source,
      toolchain: [
        process.version,
        process.platform,
        process.arch,
        run("pnpm", ["-v"], { cwd: dir }).trim(),
        run("npm", ["-v"]).trim(),
      ].join("/"),
      targets,
      watch,
      integrity,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [, , ref, flag] = process.argv;
  assert(
    ref && (!flag || flag === "--stamped"),
    "Usage: impact-snapshot.mjs <commit> [--stamped]",
  );
  process.stdout.write(
    JSON.stringify(await snapshot(ref, Boolean(flag)), null, 2) + "\n",
  );
}
