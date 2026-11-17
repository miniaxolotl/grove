import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import process from "node:process";
import { unzipSync } from "fflate";
import { assertCurrentRef, workflowContext } from "../ci/current-ref.mjs";
import { readGitHubJson } from "../ci/github-json.mjs";

const repository = "miniaxolotl/grove";
const start = "<!-- grove-downloads:start -->";
const end = "<!-- grove-downloads:end -->";
const labels = {
  "grove-chrome.zip": "Chrome",
  "grove-edge.zip": "Edge",
  "grove-firefox.zip": "Firefox",
  "packages.build.json": "Build manifest",
  "downloads.json": "Source and asset index",
  SHA256SUMS: "SHA-256 checksums",
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const validVersion = (version) =>
  assert.match(version ?? "", /^\d+\.\d+\.\d+$/, "Invalid release version");

export async function prepareAssets({ version, sourceSha, files }) {
  validVersion(version);
  assert.match(
    sourceSha ?? "",
    /^[a-f0-9]{40}$/,
    "Invalid immutable source SHA",
  );
  assert.ok(files["packages.build.json"], "Missing browser build manifest");
  const reports = JSON.parse(
    Buffer.from(files["packages.build.json"]).toString(),
  );
  assert.deepEqual(
    reports.map((report) => report.target).sort(),
    ["chrome", "edge", "firefox"],
    "Incomplete browser reports",
  );
  const assets = [];
  for (const target of ["chrome", "edge", "firefox"]) {
    const name = `grove-${target}.zip`;
    const bytes = files[name];
    const report = reports.find((item) => item.target === target);
    assert.equal(
      report.sourceVersion,
      version,
      "Browser source version mismatch",
    );
    assert.ok(bytes, `Missing ${name}`);
    assert.equal(sha256(bytes), report.sha256, `${name} integrity mismatch`);
    const packed = unzipSync(bytes, {
      filter: (entry) => {
        assert.ok(
          entry.originalSize <= 32 * 1024 * 1024,
          "Oversized browser asset",
        );
        return true;
      },
    });
    assert.deepEqual(
      Object.keys(packed).sort(),
      Object.keys(report.files).sort(),
      `${name} file inventory mismatch`,
    );
    for (const [file, hash] of Object.entries(report.files))
      assert.equal(
        sha256(packed[file]),
        hash,
        `${name}/${file} integrity mismatch`,
      );
    assert.equal(
      JSON.parse(Buffer.from(packed["manifest.json"]).toString()).version,
      version,
      "Packaged version mismatch",
    );
    assets.push({ name, bytes, label: labels[name] });
  }
  assets.push({
    name: "packages.build.json",
    bytes: files["packages.build.json"],
    label: labels["packages.build.json"],
  });
  assets.push({
    name: "downloads.json",
    label: labels["downloads.json"],
    bytes: jsonBytes({
      repository,
      version,
      tag: `v${version}`,
      sourceSha,
      assets: assets.map(({ name, bytes, label }) => ({
        name,
        label,
        bytes: bytes.length,
        sha256: sha256(bytes),
      })),
    }),
  });
  assets.push({
    name: "SHA256SUMS",
    label: labels.SHA256SUMS,
    bytes: Buffer.from(
      assets
        .map(({ name, bytes }) => `${sha256(bytes)}  ${name}`)
        .sort()
        .join("\n") + "\n",
    ),
  });
  return assets;
}

export function downloadsSection({ version, assets }) {
  validVersion(version);
  const links = assets.map(({ name }) => {
    assert.ok(Object.hasOwn(labels, name), "Unknown release asset");
    return `- [${labels[name]}](https://github.com/${repository}/releases/download/v${version}/${name})`;
  });
  return [
    start,
    "## Downloads",
    "",
    ...links,
    "",
    "Browser ZIPs are unsigned local-install builds. Firefox requires temporary installation unless separately signed. A compatible deployed Grove server is required; downloads alone do not establish production or store readiness.",
    end,
  ].join("\n");
}

function updateSection(body, section) {
  body ??= "";
  const starts = body.split(start).length - 1;
  const ends = body.split(end).length - 1;
  assert.ok(
    (starts === 0 && ends === 0) ||
      (starts === 1 && ends === 1 && body.indexOf(end) > body.indexOf(start)),
    "Malformed owned Downloads section markers",
  );
  return starts
    ? body.slice(0, body.indexOf(start)) +
        section +
        body.slice(body.indexOf(end) + end.length)
    : body + (body.endsWith("\n") ? "\n" : "\n\n") + section + "\n";
}

function existingAsset(release, name) {
  const matches = release.assets.filter((asset) => asset.name === name);
  assert.ok(matches.length <= 1, `Duplicate existing asset ${name}`);
  return matches[0];
}

async function verifyExisting(existing, wanted, download) {
  const digest =
    existing.digest ??
    (download ? `sha256:${sha256(await download(existing))}` : null);
  assert.equal(
    digest,
    `sha256:${sha256(wanted.bytes)}`,
    `Existing release asset ${wanted.name} has different bytes; never overwrite it`,
  );
}

export async function publishAssets({
  version,
  assets,
  readRelease,
  upload,
  updateBody,
  assertCurrent,
  downloadExisting,
}) {
  const section = downloadsSection({ version, assets });
  assert.equal(
    new Set(assets.map((asset) => asset.name)).size,
    assets.length,
    "Duplicate planned assets",
  );
  await assertCurrent();
  const initial = await readRelease();
  updateSection(initial.body, section);
  // Check every conflict before the first mutation, not halfway through upload.
  for (const asset of assets) {
    const existing = existingAsset(initial, asset.name);
    if (existing) await verifyExisting(existing, asset, downloadExisting);
  }
  for (const asset of assets) {
    await assertCurrent();
    let existing = existingAsset(await readRelease(), asset.name);
    if (!existing) {
      let failure;
      try {
        await upload(asset);
      } catch (error) {
        failure = error;
      }
      // A transport failure may follow provider acceptance. Read actual state;
      // never blindly repeat an upload or use --clobber.
      existing = existingAsset(await readRelease(), asset.name);
      if (!existing)
        throw failure ?? new Error(`Upload not confirmed for ${asset.name}`);
    }
    await verifyExisting(existing, asset, downloadExisting);
  }
  const current = await readRelease();
  const next = updateSection(current.body, section);
  if (next !== current.body) {
    await assertCurrent();
    try {
      await updateBody(next, { expectedBody: current.body });
    } catch (error) {
      if ((await readRelease()).body !== next) throw error;
    }
    assert.equal(
      (await readRelease()).body,
      next,
      "Release notes update not confirmed",
    );
  }
}

async function main() {
  const context = workflowContext();
  assert.equal(context.repository, repository);
  assert.equal(
    process.env.GITHUB_ACTIONS,
    "true",
    "Upload only through protected production Deploy",
  );
  const guard = () => assertCurrentRef(context);
  guard();
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const { version } = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const tag = `v${version}`;
  assert.equal(process.env.RELEASE_TAG, tag);
  const sourceSha = process.env.RELEASE_SOURCE_SHA;
  assert.match(sourceSha ?? "", /^[a-f0-9]{40}$/);
  const command = (args, options = {}) =>
    execFileSync("gh", args, {
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    });
  const git = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  assert.equal(
    git(["rev-parse", "HEAD"]),
    sourceSha,
    "Checkout must be admitted source",
  );
  assert.equal(
    git(["rev-parse", `${tag}^{}`]),
    sourceSha,
    "Tag must retain admitted source",
  );
  const files = Object.fromEntries(
    await Promise.all(
      [
        "grove-chrome.zip",
        "grove-edge.zip",
        "grove-firefox.zip",
        "packages.build.json",
      ].map(async (name) => [
        name,
        await readFile(join(root, "packages/browser-extension/dist", name)),
      ]),
    ),
  );
  const assets = await prepareAssets({ version, sourceSha, files });
  const readRelease = async () => {
    const release = readGitHubJson(`repos/${repository}/releases/tags/${tag}`);
    assert.equal(release.tag_name, tag);
    assert.equal(release.draft, false, "Source release must already exist");
    assert.equal(
      release.target_commitish,
      sourceSha,
      "Release source mismatch",
    );
    const all = [];
    for (let page = 1; ; page++) {
      assert.ok(page <= 100, "Release asset pagination exceeded bound");
      const items = readGitHubJson(
        `repos/${repository}/releases/${release.id}/assets?per_page=100&page=${page}`,
      );
      all.push(...items);
      if (items.length < 100) break;
    }
    return { ...release, assets: all };
  };
  const directory = await mkdtemp(
    join(process.env.CI ? tmpdir() : "/tmp/opencode", "grove-release-assets-"),
  );
  try {
    for (const asset of assets)
      await writeFile(join(directory, asset.name), asset.bytes);
    await publishAssets({
      version,
      assets,
      readRelease,
      assertCurrent: guard,
      upload: (asset) =>
        command([
          "release",
          "upload",
          tag,
          join(directory, asset.name),
          "--repo",
          repository,
        ]),
      downloadExisting: (asset) =>
        command(
          [
            "api",
            `repos/${repository}/releases/assets/${asset.id}`,
            "-H",
            "Accept: application/octet-stream",
          ],
          { encoding: null },
        ),
      updateBody: async (body, { expectedBody }) => {
        const release = await readRelease();
        assert.equal(
          release.body,
          expectedBody,
          "Release notes changed concurrently; retry without overwriting owner edits",
        );
        command(
          [
            "api",
            "--method",
            "PATCH",
            `repos/${repository}/releases/${release.id}`,
            "--input",
            "-",
          ],
          { input: JSON.stringify({ body }) },
        );
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
