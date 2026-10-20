import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

export function assertRepository(pkg) {
  if (
    pkg.repository?.type !== "git" ||
    pkg.repository.url !== "https://github.com/miniaxolotl/grove.git"
  ) {
    throw new Error(
      `${pkg.name} must identify the release repository for npm provenance`,
    );
  }
}

export function registryIntegrity(name) {
  try {
    const integrity = execFileSync(
      "npm",
      ["view", name, "dist.integrity", "--prefer-online"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
    if (!integrity) throw new Error(`Missing registry integrity for ${name}`);
    return integrity;
  } catch (error) {
    if (/E404/.test(String(error.stderr))) return null;
    throw error;
  }
}

export async function waitForPublication(
  artifact,
  { lookup = registryIntegrity, wait = setTimeout, attempts = 60 } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const integrity = await lookup(artifact.name);
    if (integrity === artifact.integrity) return;
    if (integrity)
      throw new Error(
        `Publication readback differs for ${artifact.name}; inspect before retrying`,
      );
    if (attempt + 1 < attempts) await wait(5000);
  }
  throw new Error(
    `Publication not visible for ${artifact.name}; inspect and retry without overwriting`,
  );
}
