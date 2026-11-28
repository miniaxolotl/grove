import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { pathToFileURL } from "node:url";

export function checkerReleaseEnabled(env) {
  const value = env.GROVE_LANGUAGETOOL_DEPLOY ?? "";
  assert(
    ["", "false", "true"].includes(value),
    "GROVE_LANGUAGETOOL_DEPLOY must be true or false",
  );
  return value === "true";
}
export function backendArguments(command, env) {
  assert(["propose", "deploy"].includes(command), "Choose propose or deploy");
  const args = [command === "propose" ? "--propose" : "--wait"];
  if (checkerReleaseEnabled(env)) {
    assert.match(
      env.GROVE_LANGUAGETOOL_DIGEST ?? "",
      /^sha256:[a-f0-9]{64}$/,
      "Verified release checker digest is required",
    );
    args.push("--release-checker", env.GROVE_LANGUAGETOOL_DIGEST);
  }
  return args;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    execFileSync(
      process.execPath,
      [
        "scripts/deploy-digitalocean.mjs",
        ...backendArguments(process.argv[2], process.env),
      ],
      { stdio: "inherit" },
    );
  } catch {
    console.error(
      "Backend rollout did not complete; inspect source, checker configuration and provider state before retrying",
    );
    process.exitCode = 1;
  }
}
