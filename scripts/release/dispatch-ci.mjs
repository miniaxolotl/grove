import { execFileSync } from "node:child_process";
import { readGitHubJson } from "../ci/github-json.mjs";
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const policy = JSON.parse(
  readFileSync(new URL("./policy.json", import.meta.url), "utf8"),
);
if (
  process.env.GITHUB_REF !== "refs/heads/development" ||
  process.env.GITHUB_REPOSITORY !== policy.repository
)
  throw new Error("Dispatch CI from trusted development automation only");
const inputs = process.env.RELEASE_PRS
  ? JSON.parse(process.env.RELEASE_PRS)
  : [{ number: Number(process.env.PROMOTION_PR) }];
for (const input of inputs) {
  if (!Number.isSafeInteger(input.number) || input.number < 1)
    throw new Error("Invalid PR number");
  const pr = readGitHubJson(`repos/${policy.repository}/pulls/${input.number}`);
  if (pr.state !== "open") continue;
  if (pr.head.repo.full_name !== policy.repository)
    throw new Error("Foreign CI ref");
  const promotion = pr.base.ref !== "development";
  if (
    promotion
      ? !pr.head.ref.startsWith(`promote/${pr.base.ref}/`)
      : !pr.head.ref.startsWith("release-please--branches--development")
  )
    throw new Error("Unexpected generated PR");
  const args = [
    "workflow",
    "run",
    "ci.yml",
    "--repo",
    policy.repository,
    "--ref",
    pr.head.ref,
  ];
  if (promotion) args.push("-f", `promotion_pr=${pr.number}`);
  execFileSync("gh", args, { stdio: "inherit" });
  execFileSync(
    "gh",
    [
      "pr",
      "edit",
      String(pr.number),
      "--repo",
      policy.repository,
      "--add-assignee",
      policy.operator,
    ],
    { stdio: "inherit" },
  );
}
