/**
 * Release script: runs Changesets version + publish workflow.
 * Run with: pnpm --filter @qdrant-memory/release run release
 */

const { execSync } = await import("node:child_process");

const PACKAGE = "@qdrant-memory/mcp";
const REPO = "miniaxolotl/qdrant-memory";

async function run(cmd: string) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

async function getNpmVersion(pkg: string): Promise<string | null> {
  try {
    const { execSync } = await import("node:child_process");
    const version = execSync(`npm view ${pkg} version --json`, {
      encoding: "utf8",
    }).trim();
    return version.replace(/"/g, "");
  } catch {
    return null;
  }
}

async function getGithubRelease(tag: string): Promise<boolean> {
  try {
    execSync(`gh release view ${tag} --repo ${REPO}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function createGithubRelease(tag: string) {
  const exists = await getGithubRelease(tag);
  if (exists) {
    console.log(`✓ Release ${tag} already exists on GitHub`);
    return;
  }

  const tagExists = execSync("git tag -l", { encoding: "utf8" })
    .split("\n")
    .map((t) => t.trim())
    .includes(tag);

  if (!tagExists) {
    run(`git tag -a ${tag} -m "Release ${tag}"`);
    run(`git push origin ${tag}`);
  }

  run(`gh release create ${tag} --generate-notes --repo ${REPO}`);
  console.log(`✓ GitHub release ${tag} created`);
}

async function release() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("\n=== Release ===\n");

  const localVersion = JSON.parse(
    execSync("pnpm --filter @qdrant-memory/mcp pkg get version", {
      encoding: "utf8",
    })
  ).version;

  const npmVersion = await getNpmVersion(PACKAGE);
  const tag = `v${localVersion}`;

  if (npmVersion === localVersion) {
    console.log(`✓ ${PACKAGE}@${localVersion} already deployed to npm`);
  } else {
    console.log(`Local: ${localVersion} → npm: ${npmVersion || "none"}\n`);

    if (!dryRun) {
      run("npx changeset version");
      run("pnpm --filter @qdrant-memory/mcp build");
      run("npx changeset publish");
      console.log(`✓ Published ${PACKAGE}@${localVersion} to npm`);
    }
  }

  if (dryRun) {
    run("npx changeset status");
    console.log("\n✓ Dry run complete — no changes published");
  } else {
    await createGithubRelease(tag);
    console.log("\n✓ Release complete");
  }
}

release().catch((err) => {
  console.error("Release failed:", err);
  process.exit(1);
});
