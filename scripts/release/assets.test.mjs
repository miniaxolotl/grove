import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { zipSync } from "fflate";

const sourceSha = "a".repeat(40);
const version = "1.2.3";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function helper() {
  const path = new URL("./assets.mjs", import.meta.url);
  assert.ok(existsSync(path), "release downloads need a verified asset helper");
  return import(path);
}
function fixture() {
  const reports = [];
  const files = {};
  for (const target of ["chrome", "firefox", "edge"]) {
    const contents = {
      "manifest.json": Buffer.from(JSON.stringify({ version })),
    };
    const zip = zipSync(contents, { mtime: new Date(2000, 0, 1) });
    files[`grove-${target}.zip`] = zip;
    reports.push({
      target,
      sourceVersion: version,
      sha256: digest(zip),
      files: { "manifest.json": digest(contents["manifest.json"]) },
    });
  }
  files["packages.build.json"] = Buffer.from(JSON.stringify(reports));
  return { version, sourceSha, files };
}

test("release downloads include installable browser ZIPs and a deterministic integrity index", async () => {
  const { prepareAssets, downloadsSection } = await helper();
  const input = fixture();
  const assets = await prepareAssets(input);
  assert.deepEqual(
    assets.map((a) => a.name),
    [
      "grove-chrome.zip",
      "grove-edge.zip",
      "grove-firefox.zip",
      "packages.build.json",
      "downloads.json",
      "SHA256SUMS",
    ],
  );
  assert.deepEqual(assets, await prepareAssets(input));
  const index = JSON.parse(
    Buffer.from(assets.find((a) => a.name === "downloads.json").bytes),
  );
  assert.equal(index.sourceSha, sourceSha);
  assert.equal(index.version, version);
  for (const entry of index.assets) {
    const asset = assets.find((a) => a.name === entry.name);
    assert.equal(entry.sha256, digest(asset.bytes));
  }
  const section = downloadsSection({ version, assets });
  for (const label of ["Chrome", "Edge", "Firefox"])
    assert.ok(section.includes(label), label);
  assert.ok(
    section.includes(
      "https://github.com/miniaxolotl/grove/releases/download/v1.2.3/grove-chrome.zip",
    ),
  );
  assert.match(section, /unsigned/i);
  assert.doesNotMatch(
    section,
    /\.tgz|CLI & MCP|Server|OpenCode|Claude Code|Codex/,
  );
});

test("asset preparation rejects wrong versions, tampered browser files and incomplete manifests", async () => {
  const { prepareAssets } = await helper();
  const wrong = fixture();
  const reports = JSON.parse(wrong.files["packages.build.json"]);
  reports[0].sourceVersion = "9.9.9";
  wrong.files["packages.build.json"] = Buffer.from(JSON.stringify(reports));
  await assert.rejects(() => prepareAssets(wrong), /version/i);
  const zip = fixture();
  zip.files["grove-chrome.zip"] = Buffer.from("changed");
  await assert.rejects(() => prepareAssets(zip), /integrity|digest|hash/i);
  const absent = fixture();
  delete absent.files["grove-edge.zip"];
  await assert.rejects(() => prepareAssets(absent), /missing|incomplete/i);
  await assert.rejects(
    () => prepareAssets({ ...fixture(), sourceSha: "moving-head" }),
    /source/i,
  );
});

test("release uploads reuse identical assets, refuse conflicts before writes and preserve current user notes", async () => {
  const { publishAssets } = await helper();
  const assets = [
    { name: "grove-chrome.zip", bytes: Buffer.from("zip"), label: "Chrome" },
  ];
  const calls = [];
  let body = "Owner notes\n";
  let existing = [
    { name: assets[0].name, digest: `sha256:${digest(assets[0].bytes)}` },
  ];
  const api = {
    version,
    assets,
    assertCurrent: async () => calls.push("guard"),
    readRelease: async () => ({ body, assets: existing }),
    upload: async () => calls.push("upload"),
    updateBody: async (next) => {
      calls.push("body");
      body = next;
    },
  };
  await publishAssets(api);
  assert.equal(calls.includes("upload"), false);
  assert.ok(body.startsWith("Owner notes\n"));
  body += "\nA later owner edit.";
  await publishAssets(api);
  assert.ok(body.endsWith("A later owner edit."));
  assert.equal((body.match(/## Downloads/g) || []).length, 1);
  existing = [{ name: assets[0].name, digest: "sha256:" + "0".repeat(64) }];
  calls.length = 0;
  await assert.rejects(
    () => publishAssets(api),
    /existing|conflict|different/i,
  );
  assert.equal(
    calls.some((c) => ["upload", "body"].includes(c)),
    false,
  );
});

test("uncertain uploads reconcile actual bytes before another mutation and malformed owned notes fail closed", async () => {
  const { publishAssets } = await helper();
  const asset = {
    name: "grove-chrome.zip",
    bytes: Buffer.from("zip"),
    label: "Chrome",
  };
  let existing = [];
  let uploads = 0;
  let body = "Release notes";
  const api = {
    version,
    assets: [asset],
    assertCurrent: async () => {},
    readRelease: async () => ({ body, assets: existing }),
    upload: async () => {
      uploads++;
      existing = [
        { name: asset.name, digest: `sha256:${digest(asset.bytes)}` },
      ];
      throw new Error("connection lost after acceptance");
    },
    updateBody: async (next) => {
      body = next;
    },
  };
  await publishAssets(api);
  assert.equal(uploads, 1);
  assert.match(body, /## Downloads/);
  body = "Owner notes\n<!-- grove-downloads:start -->broken";
  await assert.rejects(() => publishAssets(api), /marker|section/i);
  assert.equal(uploads, 1);
  existing = [{ name: asset.name, digest: null }];
  body = "Owner notes";
  await publishAssets({ ...api, downloadExisting: async () => asset.bytes });
  assert.equal(uploads, 1);
});

test("production attaches release downloads after coordinated publication with job-scoped write access", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /publish:[\s\S]*?permissions:\s+contents: write/);
  assert.ok(
    workflow.indexOf("node scripts/release/assets.mjs") >
      workflow.indexOf("node scripts/publish.mjs\n"),
  );
  assert.match(workflow, /node scripts\/release\/assets.mjs/);
});

test("unconfirmed uploads and superseded operations stop without repeated writes", async () => {
  const { publishAssets } = await helper();
  const assets = ["chrome", "edge"].map((browser) => ({
    name: `grove-${browser}.zip`,
    bytes: Buffer.from(browser),
  }));
  let uploads = 0;
  let writes = 0;
  const api = {
    version,
    assets,
    assertCurrent: async () => {},
    readRelease: async () => ({ body: "notes", assets: [] }),
    upload: async () => {
      uploads++;
      throw new Error("not confirmed");
    },
    updateBody: async () => {
      writes++;
    },
  };
  await assert.rejects(() => publishAssets(api), /not confirmed/);
  assert.equal(uploads, 1);
  assert.equal(writes, 0);
  uploads = 0;
  await assert.rejects(
    () =>
      publishAssets({
        ...api,
        assertCurrent: async () => {
          throw new Error("superseded");
        },
      }),
    /superseded/,
  );
  assert.equal(uploads, 0);
});

test("a confirmed notes write is reconciled after transport failure and existing user assets remain untouched", async () => {
  const { publishAssets } = await helper();
  const asset = { name: "grove-chrome.zip", bytes: Buffer.from("zip") };
  let body = "Owner's original release notes";
  let edits = 0;
  const existing = [
    { name: asset.name, digest: `sha256:${digest(asset.bytes)}` },
    { name: "owner-document.pdf", digest: null },
  ];
  await publishAssets({
    version,
    assets: [asset],
    assertCurrent: async () => {},
    readRelease: async () => ({ body, assets: existing }),
    upload: async () =>
      assert.fail("existing verified ZIP must not be uploaded again"),
    updateBody: async (next) => {
      edits++;
      body = next;
      throw new Error("accepted before disconnect");
    },
  });
  assert.equal(edits, 1);
  assert.ok(body.startsWith("Owner's original release notes"));
  assert.equal(existing[1].name, "owner-document.pdf");
});
