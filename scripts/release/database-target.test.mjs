import assert from "node:assert/strict";
import test from "node:test";
import {
  databaseTarget,
  runtimeTargets,
  safeDatabaseCode,
  targetFingerprint,
} from "./database-target.mjs";

const api =
  "postgresql://grove_api:private-password@db.example/grove?sslmode=verify-full";

test("verified TLS permits safe channel binding without allowing target or authentication overrides", () => {
  assert.equal(
    databaseTarget(`${api}&channel_binding=require`, "grove_api").hostname,
    "db.example",
  );
  assert.equal(
    databaseTarget(`${api}&channel_binding=prefer`, "grove_api").hostname,
    "db.example",
  );
  for (const suffix of [
    "&host=other",
    "&user=owner",
    "&password=other",
    "&dbname=other",
    "&sslmode=disable",
    "&sslmode=verify-full",
    "&channel_binding=unknown",
    "&options=-csearch_path=other",
  ]) {
    assert.throws(() => databaseTarget(api + suffix, "grove_api"));
  }
  const targets = runtimeTargets({
    GROVE_API_DATABASE_URL: api,
    GROVE_WORKER_DATABASE_URL: api.replace("grove_api", "grove_jobs"),
  });
  assert.equal(
    targetFingerprint(targets.api),
    targetFingerprint(targets.worker),
  );
  assert.doesNotMatch(targetFingerprint(targets.api), /private-password/);
});

test("diagnostic codes never return private message, detail or unknown transport values", () => {
  for (const code of ["42P01", "42501", "55P03", "ECONNRESET", "ENOTFOUND"])
    assert.equal(safeDatabaseCode({ code, message: "private" }), code);
  for (const error of [
    new Error("private"),
    { code: "private-connection-url" },
    null,
  ])
    assert.equal(safeDatabaseCode(error), "unavailable");
});
