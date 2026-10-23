import { readGitHubJson } from "./github-json.mjs";
import { pathToFileURL } from "node:url";
import process from "node:process";
import console from "node:console";

const branches = {
  "bramble-labs/website": ["production"],
  "bramble-labs/fern": ["staging", "production"],
  "miniaxolotl/burrow": ["production"],
  "miniaxolotl/grove": ["production"],
};
export function assertCurrentRef(context, read = readGitHubJson) {
  const branch = context.ref?.replace(/^refs\/heads\//, "");
  if (
    context.protected !== "true" ||
    !context.ref?.startsWith("refs/heads/") ||
    !branches[context.repository]?.includes(branch) ||
    !/^[a-f0-9]{40}$/.test(context.sha ?? "")
  )
    throw new Error("A protected admitted release context is required");
  const current = read(`repos/${context.repository}/git/ref/heads/${branch}`);
  if (current?.object?.sha !== context.sha)
    throw new Error(
      "Release operation was superseded or its identity is unavailable",
    );
  return context.sha;
}
export function workflowContext() {
  return {
    repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA,
    protected: process.env.GITHUB_REF_PROTECTED,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    assertCurrentRef(workflowContext());
  } catch {
    console.error("Release mutation fence failed; no write is authorised");
    process.exitCode = 1;
  }
}
