/**
 * Local deploy script: builds and pushes Docker images to GHCR and/or Docker Hub.
 *
 * Registries are enabled by setting the corresponding env var:
 *   GHCR_REGISTRY=ghcr.io/miniaxolotl   → push to GitHub Container Registry
 *   DOCKERHUB_REGISTRY=miniaxolotl      → push to Docker Hub
 *
 * Run with: pnpm --filter @script/deploy run deploy
 *
 * Examples:
 *   GHCR_REGISTRY=ghcr.io/miniaxolotl DOCKERHUB_REGISTRY=miniaxolotl pnpm --filter @script/deploy run deploy
 */

const { execSync } = await import("node:child_process");
const path = await import("node:path");

const IMAGE = "grove";
const ROOT = path.resolve(new URL("../../..", import.meta.url).pathname);

function run(cmd: string, cwd?: string) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: cwd || ROOT });
}

async function deploy() {
  const packageJson = JSON.parse(
    execSync("cat ../../packages/mcp/package.json", { encoding: "utf8" }),
  );
  const version = packageJson.version;

  const tags = ["latest", version];

  const registries: { name: string; url: string }[] = [];

  if (process.env.GHCR_REGISTRY) {
    registries.push({ name: "GHCR", url: process.env.GHCR_REGISTRY });
  }
  if (process.env.DOCKERHUB_REGISTRY) {
    registries.push({
      name: "Docker Hub",
      url: process.env.DOCKERHUB_REGISTRY,
    });
  }

  console.log(`\n=== Deploy ${IMAGE}:${tags.join(", ")} ===\n`);

  run("pnpm --filter @miniaxolotl/grove build");

  if (registries.length === 0) {
    for (const t of tags) {
      run(`docker build -t ${IMAGE}:${t} .`);
    }
    console.log(
      `\n✓ Built ${tags.map((t) => `${IMAGE}:${t}`).join(", ")} (no registry set, skipping push)`,
    );
  } else {
    for (const registry of registries) {
      console.log(`\n--- Pushing to ${registry.name} ---`);
      for (const t of tags) {
        const fullImage = `${registry.url}/${IMAGE}:${t}`;
        run(`docker build -t ${fullImage} .`);
        run(`docker push ${fullImage}`);
        console.log(`✓ Pushed ${fullImage}`);
      }
    }
    console.log(`\n✓ Deployed to ${registries.map((r) => r.name).join(" + ")}`);
  }
}

deploy().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
