/**
 * Release script: runs Changesets version + publish workflow.
 * Run with: pnpm --filter @script/release run release
 */

const { execSync } = await import("node:child_process");

const PACKAGES = {
  mcp: "@miniaxolotl/grove",
  plugin: "@minimaxolotl/grove-opencode-plugin",
};
const REPO = "miniaxolotl/grove";

async function run(cmd: string, ignoreErrors = false) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch (err) {
    if (!ignoreErrors) {
      throw err;
    }
  }
}

async function getNpmVersion(pkg: string): Promise<string | null> {
  try {
    const { execSync: exec } = await import("node:child_process");
    const version = exec(`npm view ${pkg} version --json`, {
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

async function createGithubRelease(tag: string, version: string, mcpVersion: string) {
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
npm install @miniaxolotl/grove@${mcpVersion}
npm install @minimaxolotl/grove-opencode-plugin@${version}
\`\`\`

## Docker

\`\`\`bash
docker pull ghcr.io/miniaxolotl/grove:v${mcpVersion}
docker pull miniaxolotl/grove:v${mcpVersion}
\`\`\`

## OpenCode Plugin

Install the Grove plugin for OpenCode:

\`\`\`bash
opencode plugin install @minimaxolotl/grove-opencode-plugin
\`\`\`

Or add to your opencode config:

\`\`\`json
{ "plugin": ["@minimaxolotl/grove-opencode-plugin"] }
\`\`\`

Set environment variables:
- \`GROVE_MCP_URL\` - MCP server URL (default: http://localhost:3100/mcp)
- \`GROVE_PROJECT\` - Default project tag for memories

## Quick Start

See the [README](https://github.com/miniaxolotl/grove#readme) for full documentation.

## Changes

See [CHANGELOG](./packages/mcp/CHANGELOG.md) for details.`;

  run(
    `gh release create ${tag} --title "Release v${version}" --notes "${body}" --repo ${REPO}`,
  );
  console.log(`✓ GitHub release ${tag} created`);
}

async function publishPlugin(dryRun: boolean): Promise<boolean> {
  const pluginPkg = "@minimaxolotl/grove-opencode-plugin";
  const pluginJson = JSON.parse(
    execSync("cat ../../packages/grove-opencode-plugin/package.json", { encoding: "utf8" }),
  );
  const localVersion = pluginJson.version;

  let npmVersion: string | null = null;
  try {
    npmVersion = await getNpmVersion(pluginPkg);
  } catch {
    // Package doesn't exist yet
  }

  if (npmVersion === localVersion) {
    console.log(`✓ ${pluginPkg}@${localVersion} already deployed to npm`);
    return false;
  }

  console.log(`Publishing ${pluginPkg}@${localVersion}...`);

  if (!dryRun) {
    run("pnpm --filter @minimaxolotl/grove-opencode-plugin build");
    run("cd ../../packages/grove-opencode-plugin && npm publish --access public");
    console.log(`✓ Published ${pluginPkg}@${localVersion} to npm`);
  }

  return true;
}

async function release() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("\n=== Release ===\n");

  const pluginJson = JSON.parse(
    execSync("cat ../../packages/grove-opencode-plugin/package.json", { encoding: "utf8" }),
  );
  const pluginVersion = pluginJson.version;

  const published = await publishPlugin(dryRun);

  const packageJson = JSON.parse(
    execSync("cat ../../packages/mcp/package.json", { encoding: "utf8" }),
  );
  const localVersion = packageJson.version;

  const npmVersion = await getNpmVersion(PACKAGES.mcp);

  if (npmVersion === localVersion && !published) {
    console.log(`✓ ${PACKAGES.mcp}@${localVersion} already deployed to npm`);
  } else {
    console.log(`\nMCP: Local ${localVersion} → npm: ${npmVersion || "none"}\n`);

    if (!dryRun) {
      run("npx changeset version");
      run("pnpm --filter @miniaxolotl/grove build");
      run("npx changeset publish");
      console.log(`✓ Published ${PACKAGES.mcp}@${localVersion} to npm`);
    }
  }

  if (dryRun) {
    run("npx changeset status", true);
    console.log("\n✓ Dry run complete — no changes published");
  } else {
    await createGithubRelease(`v${pluginVersion}`, pluginVersion, localVersion);
    console.log("\n✓ Release complete");
  }
}

release().catch((err) => {
  console.error("Release failed:", err);
  process.exit(1);
});
