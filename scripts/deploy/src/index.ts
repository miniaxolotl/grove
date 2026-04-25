/**
 * Deploy script: builds and pushes Docker image to GHCR and/or Docker Hub,
 * then creates a GitHub release.
 *
 * Registries are enabled by setting the corresponding env var:
 *   GHCR_REGISTRY=ghcr.io/miniaxolotl   → push to GitHub Container Registry
 *   DOCKERHUB_REGISTRY=miniaxolotl      → push to Docker Hub
 *
 * GitHub release is created when GH_TOKEN or GITHUB_TOKEN is set.
 *
 * Run with: pnpm --filter @script/deploy run deploy
 *
 * Examples:
 *   GHCR_REGISTRY=ghcr.io/miniaxolotl TAG=v0.1.0 pnpm --filter @script/deploy run deploy
 *   DOCKERHUB_REGISTRY=miniaxolotl TAG=v0.1.0 pnpm --filter @script/deploy run deploy
 *   GHCR_REGISTRY=ghcr.io/miniaxolotl DOCKERHUB_REGISTRY=miniaxolotl TAG=v0.1.0 pnpm --filter @script/deploy run deploy
 */

const { execSync } = await import("node:child_process");

const IMAGE = "grove";
const REPO = "miniaxolotl/grove";
const ROOT = new URL("../../..", import.meta.url).pathname;

function run(cmd: string, cwd?: string) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: cwd || ROOT });
}

async function gitRevision(): Promise<string> {
  return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
}

async function buildLabels(tag: string): Promise<string> {
  const version = tag.replace(/^v/, "");
  const revision = await gitRevision();
  const created = new Date().toISOString();

  return [
    `--label "org.opencontainers.image.version=${version}"`,
    `--label "org.opencontainers.image.revision=${revision}"`,
    `--label "org.opencontainers.image.created=${created}"`,
  ].join(" ");
}

async function createGithubRelease(tag: string) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.log("⊘ No GH_TOKEN or GITHUB_TOKEN — skipping GitHub release");
    return;
  }

  console.log(`\n--- Creating GitHub release ${tag} ---`);

  const exists = execSync(`git tag -l "${tag}"`).toString().trim();
  if (!exists) {
    run(`git tag -a ${tag} -m "Release ${tag}"`);
    run("git push origin ${tag}");
  }

  run(`gh release create ${tag} --generate-notes --repo ${REPO}`);
  console.log(`✓ GitHub release ${tag} created`);
}

async function deploy() {
  const packageJson = JSON.parse(
    execSync("cat ../../packages/mcp/package.json", { encoding: "utf8" }),
  );
  const version = packageJson.version;

  const tag = process.env.TAG || "latest";
  const tags =
    tag === "latest"
      ? ["latest", `v${version}`]
      : ([tag, tag.replace(/^v/, "") === version ? "latest" : null].filter(
          Boolean,
        ) as string[]);

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
      run(`docker build ${await buildLabels(t)} -t ${IMAGE}:${t} .`);
    }
    console.log(
      `\n✓ Built ${tags.map((t) => `${IMAGE}:${t}`).join(", ")} (no registry set, skipping push)`,
    );
  } else {
    for (const registry of registries) {
      console.log(`\n--- Pushing to ${registry.name} ---`);
      for (const t of tags) {
        const fullImage = `${registry.url}/${IMAGE}:${t}`;
        run(`docker build ${await buildLabels(t)} -t ${fullImage} .`);
        run(`docker push ${fullImage}`);
        console.log(`✓ Pushed ${fullImage}`);
      }
    }
    console.log(`\n✓ Deployed to ${registries.map((r) => r.name).join(" + ")}`);
  }

  if (tag !== "latest") {
    await createGithubRelease(tag);
  }
}

deploy().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
