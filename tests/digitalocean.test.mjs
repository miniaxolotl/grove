import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import {
  createAppSpec,
  findDeployment,
  updateImageSpec,
} from "../scripts/deploy-digitalocean.mjs";

const { structuredClone } = globalThis;
const digest = `sha256:${"a".repeat(64)}`;
const env = {
  GROVE_API_DATABASE_URL:
    "postgresql://grove_api:api-password@db.example/grove?sslmode=verify-full",
  GROVE_WORKER_DATABASE_URL:
    "postgresql://grove_jobs:worker-password@db.example/grove?sslmode=verify-full",
  MIGRATION_DATABASE_URL:
    "postgresql://grove_owner:owner-password@db.example/grove",
  CLERK_SECRET_KEY: "sk_live_test_fixture",
  CLERK_PUBLISHABLE_KEY: `pk_live_${Buffer.from("clerk.usegrove.cloud$").toString("base64")}`,
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_test_fixture",
  CURSOR_SECRET: "test-cursor-secret".repeat(3),
  DEEPINFRA_API_KEY: "deepinfra-fixture",
  MINIMAX_API_KEY: "minimax-fixture",
};

test("initial spec isolates runtime secrets and never deploys the migration owner", () => {
  const spec = createAppSpec(env);
  const json = JSON.stringify(spec);
  assert(!json.includes("owner-password"));
  assert(!json.includes("MIGRATION_DATABASE_URL"));
  for (const [component, url] of [
    [spec.services[0], env.GROVE_API_DATABASE_URL],
    [spec.workers[0], env.GROVE_WORKER_DATABASE_URL],
  ]) {
    assert.equal(
      component.envs.find((item) => item.key === "DATABASE_URL").value,
      url,
    );
    for (const item of component.envs) {
      assert.equal(item.scope, "RUN_TIME");
      if (
        [
          "DATABASE_URL",
          "CLERK_SECRET_KEY",
          "CLERK_WEBHOOK_SIGNING_SECRET",
          "CURSOR_SECRET",
          "DEEPINFRA_API_KEY",
          "MINIMAX_API_KEY",
        ].includes(item.key)
      )
        assert.equal(item.type, "SECRET");
    }
  }
  assert.equal(
    spec.services[0].envs.find((item) => item.key === "GROVE_EDITION").value,
    "cloud",
  );
});

test("provisioning rejects owner connections, insecure TLS and stale Clerk keys", () => {
  for (const [key, value] of [
    ["CLERK_SECRET_KEY", "sk_test_do_not_log"],
    ["CLERK_WEBHOOK_SIGNING_SECRET", "unprefixed-private-signing-key"],
  ]) {
    assert.throws(
      () => createAppSpec({ ...env, [key]: value }),
      (error) => !String(error).includes(value),
      "Validation errors must not print submitted secrets",
    );
  }
  assert.throws(
    () =>
      createAppSpec({
        ...env,
        GROVE_API_DATABASE_URL: env.MIGRATION_DATABASE_URL,
      }),
    /runtime login/,
  );
  assert.throws(() =>
    createAppSpec({
      ...env,
      GROVE_WORKER_DATABASE_URL: env.GROVE_WORKER_DATABASE_URL.replace(
        "verify-full",
        "disable",
      ),
    }),
  );
  assert.throws(
    () =>
      createAppSpec({
        ...env,
        CLERK_ISSUER: "https://clerk.old-domain.example",
      }),
    /disagree/,
  );
  assert.throws(
    () => createAppSpec({ ...env, CLERK_WEBHOOK_SIGNING_SECRET: "" }),
    /Missing/,
  );
});

test("rollout changes only image sources, preserving encrypted secrets and operator settings", () => {
  const current = createAppSpec(env);
  current.services[0].instance_count = 2;
  current.services[0].envs = [
    {
      key: "DATABASE_URL",
      type: "SECRET",
      scope: "RUN_TIME",
      value: "EV[provider-encrypted-value]",
    },
  ];
  current.services[0].image.registry_credentials = "EV[registry-credentials]";
  current.domains.push({ domain: "legacy.example.com", type: "ALIAS" });
  const before = structuredClone(current);
  const updated = updateImageSpec(current, digest);
  assert.deepEqual(current, before, "Input must not be mutated");
  for (const component of [updated.services[0], updated.workers[0]]) {
    assert.equal(component.image.digest, digest);
    component.image.digest = before.services[0].image.digest;
  }
  assert.deepEqual(updated, before);
});

test("rollouts reject another application or registry and require immutable image digests", () => {
  const spec = createAppSpec(env);
  assert.throws(
    () => updateImageSpec({ ...spec, name: "fern" }, digest),
    /different application/,
  );
  assert.throws(() => updateImageSpec(spec, "latest"), /digest/);
  spec.workers[0].image.repository = "other-product";
  assert.throws(() => updateImageSpec(spec, digest));
});

test("deployment wait ignores previous generations and mismatched worker images", () => {
  const spec = updateImageSpec(createAppSpec(env), digest);
  const old = { id: "previous", phase: "ACTIVE", spec };
  const other = {
    id: "unrelated",
    phase: "DEPLOYING",
    spec: structuredClone(spec),
  };
  other.spec.workers[0].image.digest = `sha256:${"b".repeat(64)}`;
  const current = { id: "new", phase: "PENDING_BUILD", spec };
  assert.equal(
    findDeployment([undefined, old, other], digest, [old.id]),
    undefined,
  );
  assert.equal(
    findDeployment([current, old, other], digest, [old.id]),
    current,
  );
});
