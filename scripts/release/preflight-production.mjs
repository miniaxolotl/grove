import assert from "node:assert/strict";
import process from "node:process";
import { updateImageSpec } from "../deploy-digitalocean.mjs";

const { DIGITALOCEAN_APP_ID: id, DIGITALOCEAN_ACCESS_TOKEN: token } =
  process.env;
assert.match(
  id ?? "",
  /^[a-f0-9-]{36}$/,
  "DIGITALOCEAN_APP_ID is required; deployment cannot be skipped",
);
assert(token?.trim(), "DIGITALOCEAN_ACCESS_TOKEN is required");
const response = await globalThis.fetch(
  `https://api.digitalocean.com/v2/apps/${id}`,
  {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(30_000),
  },
);
assert(response.ok, `DigitalOcean preflight failed (HTTP ${response.status})`);
const { app } = await response.json();
assert.equal(app.id, id);
updateImageSpec(app.spec, `sha256:${"0".repeat(64)}`);
