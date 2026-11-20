import { need, hashJSON } from "./operator-control.mjs";
const exact = (value, keys) =>
  need(
    value && hashJSON(Object.keys(value).sort()) === hashJSON([...keys].sort()),
    "OPERATOR_CONFIGURATION_REJECTED",
  );
export function validateConfig(c) {
  exact(c, [
    "schema",
    "contract",
    "sourceRoot",
    "inventory",
    "report",
    "blueprint",
    "review",
    "policy",
    "authority",
    "window",
    ...(c?.live === undefined ? [] : ["live"]),
  ]);
  need(
    c.schema === 2 && c.contract === "source-bound-held-release-v1",
    "OPERATOR_CONFIGURATION_REJECTED",
  );
  exact(c.policy, [
    "appId",
    "parentSession",
    "deployedSource",
    "deployedImage",
    "originalsEncryptedSha256",
    "originalsReviewDue",
  ]);
  if (c.authority !== null)
    exact(c.authority, [
      "schema",
      "id",
      "app",
      "custodyId",
      "root",
      "rootIdentity",
      "dbIdentity",
      "workRoot",
      "workIdentity",
      "source",
      "codeHash",
    ]);
  if (c.window !== null) exact(c.window, ["certificate", "controls"]);
  if (c.live !== undefined)
    exact(c.live, [
      "receipt",
      "journal",
      "ciphertext",
      "originals",
      "lifecycle",
      "remote",
      "heldAt",
    ]);
  return c;
}
