/** Local image builds stay local; publication belongs to production Deploy. */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

if (process.env.GHCR_REGISTRY || process.env.DOCKERHUB_REGISTRY) {
  throw new Error(
    "Publish through Deploy on production; local deploy only builds grove:local",
  );
}
execFileSync("docker", ["build", "-t", "grove:local", "."], {
  cwd: fileURLToPath(new URL("../../../", import.meta.url)),
  stdio: "inherit",
});
