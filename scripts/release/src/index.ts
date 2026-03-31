/**
 * Release script: runs Changesets version + publish workflow.
 * Run with: pnpm --filter @qdrant-memory/release run release
 */

const { execSync } = await import("node:child_process");

async function run(cmd: string) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

async function release() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("\n=== Release ===\n");

  if (dryRun) {
    run("npx changeset status");
    console.log("\n✓ Dry run complete — no changes published");
  } else {
    run("npx changeset version");
    run("pnpm --filter @qdrant-memory/mcp build");
    run("npx changeset publish");
    console.log("\n✓ Release complete");
  }
}

release().catch((err) => {
  console.error("Release failed:", err);
  process.exit(1);
});
