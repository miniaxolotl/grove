/**
 * Release script: runs Changesets version + publish workflow.
 * Run with: pnpm --filter @script/release run release
 */

const { execSync } = await import("node:child_process");

const PACKAGE = "@miniaxolotl/grove";
const REPO = "miniaxolotl/grove";

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

async function createGithubRelease(tag: string, version: string) {
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

  const body = `## Installation

\`\`\`bash
npm install @miniaxolotl/grove@${version}
\`\`\`

## Docker

\`\`\`bash
docker pull ghcr.io/miniaxolotl/grove:v${version}
docker pull miniaxolotl/grove:v${version}
\`\`\`

## Quick Start

See the [README](https://github.com/miniaxolotl/grove#readme) for full documentation.

## Changes

See [CHANGELOG](./packages/mcp/CHANGELOG.md) for details.`;

  run(
    `gh release create ${tag} --title "Release v${version}" --notes "${body}" --repo ${REPO}`,
  );
  console.log(`✓ GitHub release ${tag} created`);
}

async function release() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("\n=== Release ===\n");

  const packageJson = JSON.parse(
    execSync("cat ../../packages/mcp/package.json", { encoding: "utf8" }),
  );
  const localVersion = packageJson.version;

  const npmVersion = await getNpmVersion(PACKAGE);
  const tag = `v${localVersion}`;

  if (npmVersion === localVersion) {
    console.log(`✓ ${PACKAGE}@${localVersion} already deployed to npm`);
  } else {
    console.log(`Local: ${localVersion} → npm: ${npmVersion || "none"}\n`);

    if (!dryRun) {
      run("npx changeset version");
      run("pnpm --filter @miniaxolotl/grove build");
      run("npx changeset publish");
      console.log(`✓ Published ${PACKAGE}@${localVersion} to npm`);
    }
  }

  if (dryRun) {
    run("npx changeset status");
    console.log("\n✓ Dry run complete — no changes published");
  } else {
    await createGithubRelease(tag, localVersion);
    console.log("\n✓ Release complete");
  }
}

release().catch((err) => {
  console.error("Release failed:", err);
  process.exit(1);
});
