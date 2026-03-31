/**
 * Deploy script: builds and pushes Docker image to GHCR and/or Docker Hub,
 * then creates a GitHub release.
 *
 * Registries are enabled by setting the corresponding env var:
 *   GHCR_REGISTRY=ghcr.io/miniaxolotl   → push to GitHub Container Registry
 *   DOCKERHUB_REGISTRY=miniaxolotl       → push to Docker Hub
 *
 * GitHub release is created when GH_TOKEN or GITHUB_TOKEN is set.
 *
 * Run with: pnpm --filter @qdrant-memory/deploy run deploy
 *
 * Examples:
 *   GHCR_REGISTRY=ghcr.io/miniaxolotl TAG=v0.1.0 pnpm --filter @qdrant-memory/deploy run deploy
 *   DOCKERHUB_REGISTRY=miniaxolotl TAG=v0.1.0 pnpm --filter @qdrant-memory/deploy run deploy
 *   GHCR_REGISTRY=ghcr.io/miniaxolotl DOCKERHUB_REGISTRY=miniaxolotl TAG=v0.1.0 pnpm --filter @qdrant-memory/deploy run deploy
 */

const IMAGE = "qdrant-memory";
const REPO = "miniaxolotl/qdrant-memory";
const ROOT = new URL("../../..", import.meta.url).pathname;

async function run(cmd: string, cwd?: string) {
  console.log(`> ${cmd}`);
  const { execSync } = await import("node:child_process");
  execSync(cmd, { stdio: "inherit", cwd: cwd || ROOT });
}

async function createGithubRelease(tag: string) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.log("⊘ No GH_TOKEN or GITHUB_TOKEN — skipping GitHub release");
    return;
  }

  console.log(`\n--- Creating GitHub release ${tag} ---`);

  const { execSync } = await import("node:child_process");
  const exists = execSync(`git tag -l "${tag}"`).toString().trim();
  if (!exists) {
    run(`git tag -a ${tag} -m "Release ${tag}"`);
    run("git push origin ${tag}");
  }

  run(`gh release create ${tag} --generate-notes --repo ${REPO}`);
  console.log(`✓ GitHub release ${tag} created`);
}

async function deploy() {
  const tag = process.env.TAG || "latest";

  const registries: { name: string; url: string }[] = [];

  if (process.env.GHCR_REGISTRY) {
    registries.push({ name: "GHCR", url: process.env.GHCR_REGISTRY });
  }
  if (process.env.DOCKERHUB_REGISTRY) {
    registries.push({ name: "Docker Hub", url: process.env.DOCKERHUB_REGISTRY });
  }

  console.log(`\n=== Deploy ${IMAGE}:${tag} ===\n`);

  // Build
  run("pnpm --filter @qdrant-memory/server build");

  if (registries.length === 0) {
    run(`docker build -t ${IMAGE}:${tag} .`);
    console.log(`\n✓ Built ${IMAGE}:${tag} (no registry set, skipping push)`);
  } else {
    for (const registry of registries) {
      const fullImage = `${registry.url}/${IMAGE}:${tag}`;
      console.log(`\n--- Pushing to ${registry.name} ---`);
      run(`docker build -t ${fullImage} .`);
      run(`docker push ${fullImage}`);
      console.log(`✓ Pushed ${fullImage}`);
    }
    console.log(`\n✓ Deployed to ${registries.map((r) => r.name).join(" + ")}`);
  }

  // GitHub release
  if (tag !== "latest") {
    await createGithubRelease(tag);
  }
}

deploy().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
