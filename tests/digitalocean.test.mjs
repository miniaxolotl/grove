import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import { test } from "node:test";
import { URL } from "node:url";
import * as provider from "../scripts/deploy-digitalocean.mjs";
import {
  createAppSpec,
  findDeployment,
  updateImageSpec,
  assertUnchangedApp,
  assertActiveDeployment,
  readProviderResponse,
} from "../scripts/deploy-digitalocean.mjs";

test("provider errors preserve safe support correlation, never body text", async () => {
  const id = "7c9ab35e-d354-410a-8c67-24b445021713";
  for (const [body, header, expected] of [
    [
      JSON.stringify({
        id: "invalid_argument",
        request_id: id,
        message: "secret",
      }),
      null,
      `invalid_argument, request ${id}`,
    ],
    ["<html>secret", id, `unknown, request ${id}`],
    [JSON.stringify({ request_id: "secret" }), id, `unknown, request ${id}`],
    [
      JSON.stringify({ id: "secret", request_id: "secret" }),
      "secret",
      "unknown",
    ],
  ]) {
    const response = new globalThis.Response(body, {
      status: 400,
      headers: header ? { "x-request-id": header } : {},
    });
    await assert.rejects(
      readProviderResponse(response, "PUT", "/apps/fixture"),
      {
        message: `DigitalOcean PUT /apps/fixture failed (HTTP 400, ${expected})`,
      },
    );
  }
});

const { structuredClone } = globalThis;
test("successful provider responses never quote malformed private JSON", async () => {
  await assert.rejects(
    readProviderResponse(
      new globalThis.Response("private app data"),
      "GET",
      "/apps/fixture",
    ),
    {
      message:
        "DigitalOcean GET /apps/fixture returned invalid JSON (HTTP 200)",
    },
  );
  assert.deepEqual(
    await readProviderResponse(
      globalThis.Response.json({ app: {} }),
      "GET",
      "/apps/fixture",
    ),
    { app: {} },
  );
});
const digest = `sha256:${"a".repeat(64)}`;
const ltDigest = `sha256:${"c".repeat(64)}`;
const env = {
  GROVE_API_DATABASE_URL:
    "postgresql://grove_api:api-password@db.example/grove?sslmode=verify-full",
  GROVE_WORKER_DATABASE_URL:
    "postgresql://grove_jobs:worker-password@db.example/grove?sslmode=verify-full",
  MIGRATION_DATABASE_URL:
    "postgresql://grove_owner:owner-password@db.example/grove",
  CLERK_SECRET_KEY: "sk_live_test_fixture",
  CLERK_PUBLISHABLE_KEY: `pk_live_${Buffer.from("clerk.grovenote.app$").toString("base64")}`,
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_test_fixture",
  CURSOR_SECRET: "test-cursor-secret".repeat(3),
  SHARE_LINK_KEY: "ab".repeat(32),
  DEEPINFRA_API_KEY: "deepinfra-fixture",
  MINIMAX_API_KEY: "minimax-fixture",
  EXA_API_KEY: "exa-fixture",
  TAVILY_API_KEY: "tavily-fixture",
};

function settledApp(target = digest) {
  const spec = updateImageSpec(createAppSpec(env), target);
  return {
    id: "00000000-0000-4000-8000-000000000001",
    spec,
    active_deployment: { id: "baseline", phase: "ACTIVE", spec },
  };
}

// Exercise the actual CLI with an isolated, in-memory transport. No real fetch
// is reachable, and request logs contain only method/path, never settings.
function runProvider(
  apps,
  args = [],
  target = ltDigest,
  fenced = true,
  extraEnv = {},
) {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      new URL("./fixtures/digitalocean-transport.mjs", import.meta.url).href,
      "scripts/deploy-digitalocean.mjs",
      ...(fenced
        ? ["--expected-app-state", provider.appStateFingerprint(apps[0])]
        : []),
      ...args,
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        DIGITALOCEAN_ACCESS_TOKEN: "fixture-token",
        DIGITALOCEAN_APP_ID: apps[0].id,
        GROVE_IMAGE_DIGEST: target,
        FIXTURE_APPS: JSON.stringify(apps),
        ...extraEnv,
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.ifError(result.error);
  for (const secret of [
    env.CLERK_SECRET_KEY,
    env.CURSOR_SECRET,
    "api-password",
    "fixture-token",
  ])
    assert.ok(
      !(result.stdout + result.stderr).includes(secret),
      "Provider output must not contain synthetic secrets",
    );
  const calls = JSON.parse(
    result.stdout.split("FIXTURE_CALLS=")[1]?.split("\n")[0] ?? "null",
  );
  assert.ok(calls, "Fixture request log missing");
  return { ...result, calls };
}

test("app state fingerprint is canonical, scoped and contains no plaintext", () => {
  assert.equal(typeof provider.appStateFingerprint, "function");
  const app = {
    id: "fixture-app",
    spec: { z: "synthetic-private-value", a: [{ y: 2, x: 1 }] },
    active_deployment: { id: "one", phase: "ACTIVE" },
  };
  const expected = createHash("sha256")
    .update(
      '{"active":{"id":"one","phase":"ACTIVE"},"id":"fixture-app","inProgress":null,"pending":null,"spec":{"a":[{"x":1,"y":2}],"z":"synthetic-private-value"}}',
    )
    .digest("hex");
  assert.equal(provider.appStateFingerprint(app), expected);
  assert.equal(
    provider.appStateFingerprint({
      active_deployment: { phase: "ACTIVE", id: "one", progress: { steps: 2 } },
      spec: { a: [{ x: 1, y: 2 }], z: "synthetic-private-value" },
      id: app.id,
      pending_deployment: null,
      updated_at: "irrelevant-readback-time",
    }),
    expected,
  );
  for (const change of [
    { id: "another-app" },
    { spec: { ...app.spec, z: "changed-private-value" } },
    { active_deployment: { id: "two", phase: "ACTIVE" } },
    { active_deployment: { id: "one", phase: "ERROR" } },
    { pending_deployment: { id: "pending", phase: "PENDING_BUILD" } },
    { in_progress_deployment: { id: "running", phase: "DEPLOYING" } },
  ])
    assert.notEqual(
      provider.appStateFingerprint({ ...app, ...change }),
      expected,
    );
});

test("fenced CLI validates expected fingerprint and first read before proposal", () => {
  const app = settledApp();
  for (const [expected, methods, error] of [
    ["not-a-hash", [], /Invalid expected provider state fingerprint/],
    ["0".repeat(64), ["GET"], /Provider app state changed/],
  ]) {
    const result = runProvider(
      [app],
      ["--expected-app-state", expected],
      ltDigest,
      false,
    );
    assert.equal(result.status, 1);
    assert.deepEqual(
      result.calls.map((call) => call.method),
      methods,
    );
    assert.match(result.stderr, error);
    assert.doesNotMatch(result.stderr, /api-password|EV\[/);
  }
});

test("fenced first read rejects unsettled, mismatched and expanded topology", () => {
  for (const mutate of [
    (app) => {
      app.pending_deployment = { id: "pending" };
    },
    (app) => {
      app.in_progress_deployment = { id: "progress" };
    },
    (app) => {
      app.active_deployment.phase = "DEPLOYING";
    },
    (app) => {
      app.active_deployment.spec.services[0].instance_count = 2;
    },
    (app) => {
      app.spec = updateImageSpec(app.spec, digest, ltDigest);
      app.active_deployment.spec = app.spec;
    },
    (app) => {
      app.spec.jobs = [{ name: "extra-job" }];
      app.active_deployment.spec = app.spec;
    },
    (app) => {
      app.spec.services.push(structuredClone(app.spec.services[0]));
    },
    (app) => {
      app.active_deployment.spec.workers[0].image.repository = "other";
    },
  ]) {
    const app = structuredClone(settledApp());
    // Separate desired and active documents as on a JSON provider response.
    app.active_deployment.spec = structuredClone(app.spec);
    mutate(app);
    const result = runProvider([app]);
    assert.equal(result.status, 1);
    assert.deepEqual(
      result.calls.map((c) => c.method),
      ["GET"],
    );
    assert.doesNotMatch(result.stderr, /api-password|EV\[/);
  }
});

test("fenced final read rejects post-proposal state races without PUT", () => {
  const initial = settledApp();
  for (const mutate of [
    (app) => {
      app.pending_deployment = { id: "pending" };
    },
    (app) => {
      app.in_progress_deployment = { id: "progress" };
    },
    (app) => {
      app.active_deployment.id = "new-active";
    },
    (app) => {
      app.active_deployment.phase = "ERROR";
    },
    (app) => {
      app.spec.services[0].instance_count = 2;
    },
    (app) => {
      app.active_deployment.spec.services[0].instance_count = 2;
    },
  ]) {
    const changed = structuredClone(initial);
    changed.active_deployment.spec = structuredClone(changed.spec);
    mutate(changed);
    const result = runProvider([initial, changed]);
    assert.equal(result.status, 1);
    assert.deepEqual(
      result.calls.map((c) => c.method),
      ["GET", "POST", "GET"],
    );
    assert.doesNotMatch(result.stderr, /api-password|EV\[/);
  }
});

test("fenced settled rollout preserves legacy PUT and rejects checker options", () => {
  const app = settledApp();
  const result = runProvider([app, app]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.calls.map((c) => c.method),
    ["GET", "POST", "GET", "PUT"],
  );
  for (const args of [
    ["--create"],
    ["--languagetool-digest", `sha256:${"d".repeat(64)}`],
    ["--coordinated-checker", `sha256:${"d".repeat(64)}`],
  ]) {
    const rejected = runProvider([app], args);
    assert.equal(rejected.status, 1);
    assert.ok(
      !rejected.calls.some((c) => c.method === "POST" || c.method === "PUT"),
    );
  }
});

test("already-active fenced retries issue no proposal or PUT, even with --wait", () => {
  const app = settledApp(ltDigest);
  for (const args of [[], ["--wait"]]) {
    const result = runProvider([app], args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"action":"already-active"/);
    assert.deepEqual(
      result.calls.map((c) => c.method),
      ["GET"],
    );
  }
});

test("fenced --wait verifies the newly applied generation without a duplicate PUT", () => {
  const app = settledApp();
  const result = runProvider([app], ["--wait"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.calls.map((c) => c.method),
    ["GET", "POST", "GET", "PUT", "GET", "GET"],
  );
  assert.match(result.stdout, /"phase":"ACTIVE"/);
});

test("legacy unflagged callers retain existing update behavior", () => {
  const app = settledApp(ltDigest);
  const result = runProvider([app], [], ltDigest, false);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.calls.map((c) => c.method),
    ["GET", "POST", "GET", "PUT"],
  );
});

test("rollout pre-write readback rejects changed configuration and deployment identity", () => {
  const original = {
    id: "app-fixture",
    spec: { envs: [{ value: "private-fixture" }] },
    active_deployment: { id: "previous" },
  };
  assert.doesNotThrow(() =>
    assertUnchangedApp(original, structuredClone(original)),
  );
  for (const change of [
    { id: "other" },
    { spec: { envs: [{ value: "new-private-fixture" }] } },
    { active_deployment: { id: "newer" } },
    { in_progress_deployment: { id: "newer" } },
  ])
    assert.throws(
      () => assertUnchangedApp(original, { ...original, ...change }),
      (error) => {
        assert.ok(!String(error).includes("private-fixture"));
        return true;
      },
    );
});

test("initial spec isolates runtime secrets and never deploys the migration owner", () => {
  const spec = createAppSpec(env);
  const json = JSON.stringify(spec);
  assert.equal(spec.domains[0].domain, "api.grovenote.app");
  for (const component of [...spec.services, ...spec.workers]) {
    assert.equal(
      component.envs.find(({ key }) => key === "SITE_URL").value,
      "https://grovenote.app",
    );
  }
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
  assert.deepEqual(
    spec.services[0].envs.find((item) => item.key === "SHARE_LINK_KEY"),
    {
      key: "SHARE_LINK_KEY",
      value: env.SHARE_LINK_KEY,
      type: "SECRET",
      scope: "RUN_TIME",
    },
  );
  assert(!spec.workers[0].envs.some((item) => item.key === "SHARE_LINK_KEY"));
  for (const key of ["EXA_API_KEY", "TAVILY_API_KEY"]) {
    assert.equal(
      spec.services[0].envs.find((item) => item.key === key)?.type,
      "SECRET",
    );
    assert(!spec.workers[0].envs.some((item) => item.key === key));
  }
});

test("optional writing staging uses the same dedicated key and disclosure in API and worker", () => {
  const key = "34".repeat(32),
    notice = "Synthetic provider disclosure; no live transmission.";
  const spec = createAppSpec({
    ...env,
    WRITING_STAGING_KEY: key,
    WRITING_PROVIDER_NOTICE: notice,
  });
  for (const component of [spec.services[0], spec.workers[0]]) {
    assert.deepEqual(
      component.envs.find((item) => item.key === "WRITING_STAGING_KEY"),
      {
        key: "WRITING_STAGING_KEY",
        value: key,
        scope: "RUN_TIME",
        type: "SECRET",
      },
    );
    assert.equal(
      component.envs.find((item) => item.key === "WRITING_PROVIDER_NOTICE")
        ?.value,
      notice,
    );
  }
  assert.throws(
    () => createAppSpec({ ...env, WRITING_STAGING_KEY: key }),
    /WRITING_PROVIDER_NOTICE/,
  );
});

test("provisioning rejects owner connections, insecure TLS and stale Clerk keys", () => {
  for (const [key, value] of [
    ["CLERK_SECRET_KEY", "sk_test_do_not_log"],
    ["CLERK_WEBHOOK_SIGNING_SECRET", "unprefixed-private-signing-key"],
    ["SHARE_LINK_KEY", "invalid-sharing-key-do-not-log"],
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

test("only an explicit LT digest adds the private component, never an API URL", () => {
  const initial = createAppSpec({
    ...env,
    LANGUAGETOOL_URL: "http://unexpected",
    LANGUAGETOOL_IMAGE_DIGEST: ltDigest,
  });
  assert.equal(updateImageSpec(initial, digest).services.length, 1);
  const next = updateImageSpec(initial, digest, ltDigest);
  assert.equal(next.services.length, 2);
  const lt = next.services[1];
  assert.deepEqual(lt.image, {
    registry_type: "DOCKER_HUB",
    registry: "miniaxolotl",
    repository: "grove-languagetool",
    digest: ltDigest,
  });
  assert.deepEqual(lt.internal_ports, [8081]);
  assert.equal(lt.health_check.http_path, "/ready");
  assert.equal(lt.health_check.initial_delay_seconds, 180);
  assert.equal(lt.instance_count, 1);
  assert.equal(lt.instance_size_slug, "apps-s-1vcpu-1gb-fixed");
  assert(!lt.envs && !lt.http_port && !lt.routes);
  assert(!JSON.stringify(next).includes("LANGUAGETOOL_URL"));
  assert.deepEqual(next.ingress, initial.ingress);
  assert.equal(
    updateImageSpec(next, digest).services[1].image.digest,
    ltDigest,
  );
  assert.equal(
    updateImageSpec(next, digest, `sha256:${"d".repeat(64)}`).services[1].image
      .digest,
    `sha256:${"d".repeat(64)}`,
  );
  assert.throws(() => updateImageSpec(initial, digest, "latest"));
});

test("existing LT must be pinned, private and isolated even on an ordinary rollout", () => {
  const spec = updateImageSpec(createAppSpec(env), digest, ltDigest);
  for (const change of [
    { http_port: 8081 },
    { internal_ports: [80] },
    { routes: [{ path: "/lt" }] },
    { envs: [{ key: "DATABASE_URL", value: "private-test-marker" }] },
    { run_command: "alternate" },
    { image: { digest: ltDigest, repository: "other" } },
    {
      image: {
        registry_type: "DOCKER_HUB",
        registry: "miniaxolotl",
        repository: "grove-languagetool",
        tag: "latest",
      },
    },
  ]) {
    const drift = structuredClone(spec);
    drift.services[1] = { ...drift.services[1], ...change };
    assert.throws(
      () => updateImageSpec(drift, digest),
      (e) => !String(e).includes("private-test-marker"),
    );
  }
  for (const edit of [
    (s) => s.ingress.rules.push({ component: { name: "languagetool" } }),
    (s) => {
      s.envs = [{ key: "DATABASE_URL", value: "private-test-marker" }];
    },
  ]) {
    const drift = structuredClone(spec);
    edit(drift);
    assert.throws(
      () => updateImageSpec(drift, digest),
      (e) => !String(e).includes("private-test-marker"),
    );
  }
});

test("release checker mode adopts only source-tagged private LT and preserves selected sizing and API configuration", () => {
  assert.equal(
    typeof provider.releaseImageSpec,
    "function",
    "Missing source-qualified checker rollout",
  );
  const spec = updateImageSpec(createAppSpec(env), digest, ltDigest);
  const checker = spec.services[1];
  checker.instance_size_slug = "apps-s-1vcpu-2gb";
  checker.image.repository = "grove";
  checker.image.tag = `languagetool-sha-${"b".repeat(40)}`;
  delete checker.image.digest;
  const before = structuredClone(spec);
  assert.throws(() => updateImageSpec(spec, digest));
  const next = provider.releaseImageSpec(spec, digest, ltDigest);
  assert.deepEqual(spec, before, "Input spec must not change");
  assert.equal(next.services[1].image.repository, "grove-languagetool");
  assert.equal(next.services[1].image.digest, ltDigest);
  assert.equal(next.services[1].image.tag, undefined);
  assert.equal(next.services[1].instance_size_slug, "apps-s-1vcpu-2gb");
  assert.deepEqual(next.services[0].envs, before.services[0].envs);
  assert.deepEqual(next.workers, before.workers);
  assert(!JSON.stringify(next).includes("LANGUAGETOOL_URL"));
  for (const mutate of [
    (s) => {
      s.services[1].image.tag = "latest";
    },
    (s) => {
      s.services[1].http_port = 8081;
    },
    (s) => {
      s.services[1].envs = [{ key: "PRIVATE", value: "private-marker" }];
    },
    (s) => {
      s.envs = [{ key: "PRIVATE", value: "private-marker" }];
    },
    (s) => {
      s.services[1].image.repository = "unrelated";
    },
    (s) => {
      s.services[1].image.digest = ltDigest;
    },
  ]) {
    const unsafe = structuredClone(spec);
    mutate(unsafe);
    assert.throws(
      () => provider.releaseImageSpec(unsafe, digest, ltDigest),
      (error) => !error.message.includes("private-marker"),
    );
  }
});

const releaseEnv = () => ({
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "miniaxolotl/grove",
  GITHUB_REF: "refs/heads/production",
  GITHUB_REF_PROTECTED: "true",
  GITHUB_SHA: "b".repeat(40),
  FIXTURE_GITHUB_SHA: "b".repeat(40),
  GROVE_LANGUAGETOOL_DEPLOY: "true",
  RELEASE_TAG: "v1.11.39",
  RELEASE_SOURCE_SHA: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
});

function savedTaggedChecker() {
  const app = structuredClone(settledApp());
  app.spec = updateImageSpec(app.spec, digest, ltDigest);
  app.spec.services[1].image.repository = "grove";
  app.spec.services[1].image.tag = `languagetool-sha-${"c".repeat(40)}`;
  delete app.spec.services[1].image.digest;
  app.spec.services[1].instance_size_slug = "apps-s-1vcpu-2gb";
  return app;
}

test("actual protected release CLI adopts the saved checker and waits for the exact active three-component generation", () => {
  const app = savedTaggedChecker();
  const result = runProvider(
    [app, app],
    ["--release-checker", ltDigest, "--wait"],
    digest,
    false,
    releaseEnv(),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.calls.map((c) => c.method),
    ["GET", "POST", "GET", "PUT", "GET", "GET"],
  );
  assert.match(result.stdout, /fixture-completed/);
});

test("protected checker retries are no-ops and reject stale source, races, invalid flags and enabled bootstrap transmission", () => {
  const spec = provider.releaseImageSpec(createAppSpec(env), digest, ltDigest);
  const settled = {
    id: settledApp().id,
    spec,
    active_deployment: { id: "accepted", phase: "ACTIVE", spec },
  };
  const noop = runProvider(
    [settled],
    ["--release-checker", ltDigest, "--wait"],
    digest,
    false,
    releaseEnv(),
  );
  assert.equal(noop.status, 0, noop.stderr);
  assert.deepEqual(
    noop.calls.map((c) => c.method),
    ["GET"],
  );
  for (const change of [
    { GROVE_LANGUAGETOOL_DEPLOY: "false" },
    { GITHUB_ACTIONS: "false" },
    { GITHUB_REF: "refs/heads/development" },
    { GITHUB_REF_PROTECTED: "false" },
    { GITHUB_SHA: "d".repeat(40) },
    { RELEASE_SOURCE_SHA: "e".repeat(40) },
  ]) {
    const result = runProvider(
      [savedTaggedChecker()],
      ["--release-checker", ltDigest, "--wait"],
      digest,
      false,
      { ...releaseEnv(), ...change },
    );
    assert.equal(result.status, 1);
    assert(!result.calls.some((c) => ["PUT", "POST"].includes(c.method)));
  }
  for (const mutate of [
    (app) => {
      app.in_progress_deployment = { id: "running" };
    },
    (app) => {
      app.spec.services[0].envs.push({
        key: "LANGUAGETOOL_URL",
        value: "http://languagetool:8081",
      });
    },
    (app) => {
      app.spec.services[1].http_port = 8081;
    },
  ]) {
    const app = savedTaggedChecker();
    mutate(app);
    const result = runProvider(
      [app],
      ["--release-checker", ltDigest, "--wait"],
      digest,
      false,
      releaseEnv(),
    );
    assert.equal(result.status, 1);
    assert(!result.calls.some((c) => ["PUT", "POST"].includes(c.method)));
  }
  const before = savedTaggedChecker(),
    changed = structuredClone(before);
  changed.spec.services[0].instance_count = 2;
  const race = runProvider(
    [before, changed],
    ["--release-checker", ltDigest, "--wait"],
    digest,
    false,
    releaseEnv(),
  );
  assert.equal(race.status, 1);
  assert.deepEqual(
    race.calls.map((c) => c.method),
    ["GET", "POST", "GET"],
  );
});

test("provider selection and active readback require the expected LT topology and digest", () => {
  const initial = updateImageSpec(createAppSpec(env), digest);
  const spec = updateImageSpec(initial, digest, ltDigest);
  const item = { id: "rollout", phase: "ACTIVE", spec };
  assert.equal(findDeployment([item], digest, [], ltDigest), item);
  for (const [observed, expected] of [
    [initial, ltDigest],
    [spec, `sha256:${"d".repeat(64)}`],
    [spec, undefined],
  ]) {
    const active_deployment = { ...item, spec: observed };
    assert.equal(
      findDeployment([active_deployment], digest, [], expected),
      undefined,
    );
    assert.throws(() =>
      assertActiveDeployment({ active_deployment }, item.id, digest, expected),
    );
  }
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

test("rollout completion requires the provider's actual active generation and both image digests", () => {
  const deployment = {
    id: "accepted",
    phase: "ACTIVE",
    spec: updateImageSpec(createAppSpec(env), digest),
  };
  const app = { active_deployment: deployment };
  assert.doesNotThrow(() => assertActiveDeployment(app, deployment.id, digest));
  assert.throws(() =>
    assertActiveDeployment(
      { active_deployment: { ...deployment, id: "newer" } },
      deployment.id,
      digest,
    ),
  );
  assert.throws(() =>
    assertActiveDeployment(
      { ...app, in_progress_deployment: { id: "newer" } },
      deployment.id,
      digest,
    ),
  );
  const mismatched = structuredClone(app);
  mismatched.active_deployment.spec.workers[0].image.digest = `sha256:${"b".repeat(64)}`;
  assert.throws(() =>
    assertActiveDeployment(mismatched, deployment.id, digest),
  );
});
