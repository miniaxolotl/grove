/**
 * Deploy script: builds and pushes Docker image.
 * Run with: pnpm --filter @qdrant-memory/deploy run deploy
 */

const IMAGE = "qdrant-memory";

async function run(cmd: string) {
  console.log(`> ${cmd}`);
  const { execSync } = await import("node:child_process");
  execSync(cmd, { stdio: "inherit" });
}

async function deploy() {
  const tag = process.env.TAG || "latest";
  const registry = process.env.REGISTRY;

  console.log(`\n=== Deploy ${IMAGE}:${tag} ===\n`);

  // Build
  run("pnpm --filter @qdrant-memory/server build");

  // Build Docker image
  if (registry) {
    run(`docker build -t ${registry}/${IMAGE}:${tag} .`);
    run(`docker push ${registry}/${IMAGE}:${tag}`);
    console.log(`\n✓ Pushed ${registry}/${IMAGE}:${tag}`);
  } else {
    run(`docker build -t ${IMAGE}:${tag} .`);
    console.log(`\n✓ Built ${IMAGE}:${tag} (no REGISTRY set, skipping push)`);
  }
}

deploy().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
