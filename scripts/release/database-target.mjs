import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { URL } from "node:url";

export function databaseTarget(value, role) {
  try {
    const url = new URL(value);
    assert(["postgres:", "postgresql:"].includes(url.protocol));
    const user = decodeURIComponent(url.username);
    assert(user && url.password && url.hostname && !url.hash);
    const database = decodeURIComponent(url.pathname.slice(1));
    assert(database && !database.includes("/"));
    if (role) assert.equal(user, role);
    // libpq/pg accepts host/user/dbname overrides in the query. Do not let them
    // bypass the owner/runtime target comparison or verified-TLS requirement.
    assert(url.searchParams.size >= 1 && url.searchParams.size <= 2);
    assert.equal(url.searchParams.getAll("sslmode").length, 1);
    assert.equal(url.searchParams.get("sslmode"), "verify-full");
    for (const [key, value] of url.searchParams)
      assert(
        key === "sslmode" ||
          (key === "channel_binding" && ["require", "prefer"].includes(value)),
      );
    return url;
  } catch {
    throw new Error(
      `Configure the ${role ?? "migration owner"} connection with verified TLS and no query overrides`,
    );
  }
}

export function targetFingerprint(url) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        url.hostname.toLowerCase(),
        url.port || "5432",
        decodeURIComponent(url.pathname.slice(1)),
      ]),
    )
    .digest("hex");
}

export function runtimeTargets(env) {
  const api = databaseTarget(env.GROVE_API_DATABASE_URL, "grove_api");
  const worker = databaseTarget(env.GROVE_WORKER_DATABASE_URL, "grove_jobs");
  assert.equal(
    targetFingerprint(api),
    targetFingerprint(worker),
    "API and worker preflight connections must target the same production database",
  );
  return { api, worker };
}

export function safeDatabaseCode(error) {
  const code = error?.code;
  return /^(?:[0-9A-Z]{5}|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN)$/.test(
    code ?? "",
  )
    ? code
    : "unavailable";
}
