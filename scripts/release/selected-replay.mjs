// Offline fixtures only. Model Release Please's GitHub reads using a disposable checkout.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { Manifest, setLogger } from "release-please";
import { stageRelease } from "./selected-writer.mjs";

export async function writeProposal(cwd, git, message, files) {
  setLogger({ info() {}, warn() {}, error() {}, debug() {}, trace() {} });
  const get = (path) => readFileSync(join(cwd, path), "utf8");
  const tag = "v" + JSON.parse(get("package.json")).version,
    sha = git("rev-parse", tag + "^{commit}");
  async function* iter(items) {
    yield* items;
  }
  const github = {
    repository: {
      owner: "miniaxolotl",
      repo: "grove",
      defaultBranch: "development",
    },
    async getFileContentsOnBranch(path) {
      if (!existsSync(join(cwd, path)))
        throw Object.assign(new Error(path), { status: 404 });
      const parsedContent = get(path);
      return {
        parsedContent,
        content: Buffer.from(parsedContent).toString("base64"),
        sha: git("rev-parse", `HEAD:${path}`),
      };
    },
    async getFileJson(path) {
      return JSON.parse(get(path));
    },
    releaseIterator: () => iter([{ tagName: tag, sha, notes: "previous" }]),
    tagIterator: () => iter([{ name: tag, sha }]),
    pullRequestIterator: () => iter([]),
    mergeCommitIterator: () =>
      iter([
        { sha: git("rev-parse", "HEAD"), message, files },
        { sha, message: "chore: previous", files: [] },
      ]),
  };
  const releases = await (
    await Manifest.fromManifest(github, "development")
  ).buildPullRequests();
  assert.equal(releases.length, 1);
  for (const { path, updater, createIfMissing } of releases[0].updates) {
    const dest = join(cwd, path);
    if (createIfMissing || existsSync(dest))
      writeFileSync(
        dest,
        updater.updateContent(existsSync(dest) ? get(path) : undefined),
      );
  }
  return releases[0].title.toString();
}

async function replay() {
  const tool = fileURLToPath(new URL(".", import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), "grove-two-release-")),
    cwd = join(tmp, "repo");
  try {
    execFileSync("git", [
      "clone",
      "-q",
      "--shared",
      "--no-checkout",
      process.cwd(),
      cwd,
    ]);
    const git = (...args) =>
      execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    git(
      "checkout",
      "--detach",
      "-q",
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    );
    const commit = (msg) => {
      git("add", "-A");
      git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=replay@example.invalid",
        "commit",
        "-qm",
        msg,
      );
      return git("rev-parse", "HEAD");
    };
    const ledger = JSON.parse(readFileSync(join(tool, "impact-receipts.json")));
    const snapshot = (ref) => {
      const file = join(tmp, ref + ".json");
      writeFileSync(
        file,
        execFileSync(
          process.execPath,
          [join(tool, "impact-snapshot.mjs"), ref],
          { cwd, stdio: ["ignore", "pipe", "inherit"] },
        ),
      );
      return file;
    };
    const base = snapshot(ledger.targets.service.source);
    let website = base;
    for (const patch of [25, 26]) {
      const path = "packages/website/src/app/globals.css",
        msg = `fix(website): adjust fixture spacing ${patch}`;
      appendFileSync(
        join(cwd, path),
        `\n:root { --fixture-space: ${patch}px; }\n`,
      );
      const candidate = commit(msg),
        observed = join(tmp, "receipts.json");
      writeFileSync(observed, JSON.stringify(ledger));
      const report = JSON.parse(
        execFileSync(
          process.execPath,
          [
            join(tool, "impact-plan.mjs"),
            "--receipts",
            observed,
            snapshot(candidate),
            ...new Set([base, website]),
          ],
          { cwd },
        ),
      );
      for (const [name, t] of Object.entries(report.targets))
        assert.equal(
          t.state,
          name === "website" ? "selected" : "unchanged",
          JSON.stringify(t),
        );
      const proposal = commit(await writeProposal(cwd, git, msg, [path]));
      const out = stageRelease(proposal, report, cwd);
      try {
        assert.equal(out.version, `1.11.${patch}`);
        assert.deepEqual(out.publish, []);
        assert.deepEqual(out.deliver, ["website"]);
        git("checkout", "--detach", "-q", candidate);
        for (const p of out.files)
          copyFileSync(join(out.directory, p), join(cwd, p));
        const source = commit(`chore(release): release ${out.version}`);
        git("tag", "v" + out.version, source);
        assert.deepEqual(
          git("diff", "--name-only", candidate, source).split("\n"),
          [".release-please-manifest.json", "CHANGELOG.md", "package.json"],
        );
        if (patch === 25) {
          website = snapshot(source);
          ledger.targets.website = {
            source,
            evidence: "simulated website readback",
            identity: {
              ...ledger.targets.website.identity,
              productionSha: source,
              version: out.version,
              deploymentId: "dpl_fixture25",
              deploymentUrl: "https://grove-fixture25.vercel.app",
            },
          };
        }
        process.stdout.write(
          `${out.version}: three product files; deliver=website, publish=[]\n`,
        );
      } finally {
        rmSync(out.directory, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await replay();
