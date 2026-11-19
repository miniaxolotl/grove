import { version as proofingReleaseVersion } from "./release/proofing-release.mjs";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL, URL } from "node:url";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { assertCurrentRef, workflowContext } from "./ci/current-ref.mjs";

const { AbortSignal, fetch, structuredClone } = globalThis;

const template = JSON.parse(
  await readFile(new URL("../.do/app.json", import.meta.url), "utf8"),
);

export function assertUnchangedApp(previous, current) {
  assert(
    previous?.id &&
      current?.id === previous.id &&
      isDeepStrictEqual(previous.spec, current.spec) &&
      previous.active_deployment?.id === current.active_deployment?.id &&
      previous.in_progress_deployment?.id ===
        current.in_progress_deployment?.id,
    "App configuration or deployment changed during rollout preflight; revalidate before writing",
  );
}

export function assertActiveDeployment(app, deploymentId, digest, ltDigest) {
  assert(
    app?.active_deployment?.phase === "ACTIVE" &&
      findDeployment([app.active_deployment], digest, [], ltDigest)?.id ===
        deploymentId &&
      (!app.in_progress_deployment?.id ||
        app.in_progress_deployment.id === deploymentId),
    "Rollout is no longer the active verified provider generation",
  );
}

function imageDigest(value) {
  assert.match(
    value ?? "",
    /^sha256:[a-f0-9]{64}$/,
    "A SHA-256 image digest is required",
  );
  return value;
}

function required(env, key) {
  assert(env[key]?.trim(), `Missing ${key}`);
  return env[key].trim();
}

function httpsOrigin(value) {
  const url = new URL(value);
  assert(
    url.protocol === "https:" && url.origin === value,
    "Use an exact HTTPS origin without a trailing slash",
  );
  return url;
}

// Initial provisioning only. Migration-owner credentials are deliberately absent.
export function createAppSpec(env) {
  const spec = structuredClone(template);
  const apiOrigin = env.API_ORIGIN ?? "https://api.grovenote.app";
  const siteUrl = env.SITE_URL ?? "https://grovenote.app";
  const issuer = env.CLERK_ISSUER ?? "https://clerk.grovenote.app";
  spec.domains[0].domain = httpsOrigin(apiOrigin).hostname;
  httpsOrigin(siteUrl);
  httpsOrigin(issuer);
  const sharedSecrets = Object.fromEntries(
    [
      "CLERK_SECRET_KEY",
      "CLERK_WEBHOOK_SIGNING_SECRET",
      "CURSOR_SECRET",
      "DEEPINFRA_API_KEY",
      "MINIMAX_API_KEY",
    ].map((key) => [key, required(env, key)]),
  );
  assert.match(
    sharedSecrets.CLERK_SECRET_KEY,
    /^sk_live_/,
    "Use a production Clerk secret key",
  );
  assert.match(
    sharedSecrets.CLERK_WEBHOOK_SIGNING_SECRET,
    /^whsec_/,
    "Use the actual Svix endpoint signing secret",
  );
  assert(
    sharedSecrets.CURSOR_SECRET.length >= 32,
    "CURSOR_SECRET is too short",
  );
  const publishableKey = required(env, "CLERK_PUBLISHABLE_KEY");
  if (env.WRITING_STAGING_KEY || env.WRITING_PROVIDER_NOTICE) {
    assert(
      /^[0-9a-f]{64}$/i.test(env.WRITING_STAGING_KEY ?? ""),
      "WRITING_STAGING_KEY must be a dedicated 32-byte hex key",
    );
    assert(
      typeof env.WRITING_PROVIDER_NOTICE === "string" &&
        env.WRITING_PROVIDER_NOTICE.trim().length >= 20 &&
        env.WRITING_PROVIDER_NOTICE.length <= 1000,
      "WRITING_PROVIDER_NOTICE must accurately describe the configured provider and its retention",
    );
    assert(
      env.WRITING_STAGING_KEY !== env.SHARE_LINK_KEY &&
        env.WRITING_STAGING_KEY !== env.MODEL_SETTINGS_KEY &&
        env.WRITING_STAGING_KEY !== env.CURSOR_SECRET,
      "WRITING_STAGING_KEY must not reuse another service key",
    );
  }
  if (env.SHARE_LINK_KEY)
    assert(
      /^[0-9a-f]{64}$/i.test(env.SHARE_LINK_KEY),
      "SHARE_LINK_KEY must be 32 bytes in hex",
    );
  assert.match(publishableKey, /^pk_live_/);
  const clerkHost = Buffer.from(publishableKey.slice(8), "base64")
    .toString("utf8")
    .replace(/\$$/, "");
  assert.equal(`https://${clerkHost}`, issuer, "Clerk key and issuer disagree");
  const general = {
    NODE_ENV: "production",
    DATABASE_SSL: "require",
    API_ORIGIN: apiOrigin,
    SITE_URL: siteUrl,
    CLERK_ISSUER: issuer,
    CLERK_PUBLISHABLE_KEY: publishableKey,
    GROVE_EDITION: "cloud",
    AI_DAILY_REQUEST_LIMIT: env.AI_DAILY_REQUEST_LIMIT ?? "2000",
    AI_CONCURRENCY: env.AI_CONCURRENCY ?? "4",
  };
  for (const [component, databaseKey, role] of [
    [spec.services[0], "GROVE_API_DATABASE_URL", "grove_api"],
    [spec.workers[0], "GROVE_WORKER_DATABASE_URL", "grove_jobs"],
  ]) {
    const database = required(env, databaseKey);
    const url = new URL(database);
    assert(["postgres:", "postgresql:"].includes(url.protocol));
    assert.equal(
      decodeURIComponent(url.username),
      role,
      `Use the ${role} runtime login`,
    );
    assert(url.password, "Database password is missing");
    assert.equal(url.searchParams.get("sslmode"), "verify-full");
    component.envs = [
      ...Object.entries(general).map(([key, value]) => ({
        key,
        value,
        scope: "RUN_TIME",
        type: "GENERAL",
      })),
      ...Object.entries({ ...sharedSecrets, DATABASE_URL: database }).map(
        ([key, value]) => ({ key, value, scope: "RUN_TIME", type: "SECRET" }),
      ),
    ];
    if (env.WRITING_STAGING_KEY)
      component.envs.push(
        {
          key: "WRITING_STAGING_KEY",
          value: env.WRITING_STAGING_KEY,
          scope: "RUN_TIME",
          type: "SECRET",
        },
        {
          key: "WRITING_PROVIDER_NOTICE",
          value: env.WRITING_PROVIDER_NOTICE,
          scope: "RUN_TIME",
          type: "GENERAL",
        },
      );
    if (env.GROVE_IMAGE_DIGEST)
      component.image.digest = imageDigest(env.GROVE_IMAGE_DIGEST);
    if (role === "grove_api" && env.SHARE_LINK_KEY)
      component.envs.push({
        key: "SHARE_LINK_KEY",
        value: env.SHARE_LINK_KEY,
        scope: "RUN_TIME",
        type: "SECRET",
      });
    if (role === "grove_api") {
      for (const key of ["EXA_API_KEY", "TAVILY_API_KEY"])
        if (env[key])
          component.envs.push({
            key,
            value: env[key],
            scope: "RUN_TIME",
            type: "SECRET",
          });
      for (const [key, fallback] of [
        ["RESEARCH_DAILY_CALL_LIMIT", "20"],
        ["RESEARCH_MONTHLY_BUDGET_USD", "100"],
      ])
        component.envs.push({
          key,
          value: env[key] ?? fallback,
          scope: "RUN_TIME",
          type: "GENERAL",
        });
    }
  }
  return spec;
}

// Rollouts preserve the provider's encrypted secrets, DNS and operator settings.
export function updateImageSpec(
  current,
  digest,
  ltDigest,
  coordinated = false,
) {
  imageDigest(digest);
  assert.equal(
    current.name,
    "grove",
    "Refusing to update a different application",
  );
  const spec = structuredClone(current);
  for (const [components, name] of [
    [spec.services, "api"],
    [spec.workers, "worker"],
  ]) {
    const component = components?.find((item) => item.name === name);
    assert(component, `Missing Grove ${name} component`);
    assert.equal(component.image?.registry_type, "DOCKER_HUB");
    assert.equal(component.image.registry, "miniaxolotl");
    assert.equal(component.image.repository, "grove");
    delete component.image.tag;
    delete component.image.deploy_on_push;
    component.image.digest = digest;
  }
  const existing = privateChecker(spec);
  if (ltDigest !== undefined) {
    imageDigest(ltDigest);
    if (existing) {
      if (coordinated)
        assert.equal(
          existing.image.repository,
          "grove",
          "Unexpected staged checker registry",
        );
      existing.image.digest = ltDigest;
    } else
      spec.services.push({
        name: "languagetool",
        image: {
          registry_type: "DOCKER_HUB",
          registry: "miniaxolotl",
          repository: coordinated ? "grove" : "grove-languagetool",
          digest: ltDigest,
        },
        internal_ports: [8081],
        instance_count: 1,
        instance_size_slug: "apps-s-1vcpu-1gb-fixed",
        health_check: {
          http_path: "/ready",
          port: 8081,
          initial_delay_seconds: 60,
          timeout_seconds: 5,
          period_seconds: 10,
          failure_threshold: 6,
        },
      });
    privateChecker(spec);
  }
  return spec;
}

function privateChecker(spec) {
  const parts =
    spec?.services?.filter((part) => part.name === "languagetool") ?? [];
  if (!parts.length) return undefined;
  const [part] = parts;
  assert(
    parts.length === 1 &&
      part.image?.registry_type === "DOCKER_HUB" &&
      part.image.registry === "miniaxolotl" &&
      ["grove", "grove-languagetool"].includes(part.image.repository) &&
      !spec.services.some(
        (s) => s.name === "api" && s.image?.digest === part.image.digest,
      ) &&
      !part.image.tag &&
      !part.image.deploy_on_push?.enabled &&
      !part.run_command &&
      !part.git &&
      !part.github &&
      !part.gitlab &&
      !part.bitbucket,
    "Unexpected LanguageTool component or image source",
  );
  imageDigest(part.image.digest);
  assert(
    !spec.envs?.length &&
      !part.envs?.length &&
      !part.log_destinations?.length &&
      !part.routes?.length &&
      !part.http_port &&
      isDeepStrictEqual(part.internal_ports, [8081]) &&
      part.health_check?.http_path === "/ready" &&
      part.health_check.port === 8081 &&
      spec.ingress?.rules?.some((rule) => rule.component?.name === "api") &&
      !spec.ingress.rules.some(
        (rule) => rule.component?.name === "languagetool",
      ),
    "LanguageTool must remain private with no inherited environment or command overrides",
  );
  return part;
}

export function findDeployment(
  deployments,
  digest,
  previousIds = [],
  ltDigest,
) {
  return deployments.find(
    (item) =>
      item &&
      !previousIds.includes(item.id) &&
      [
        item.spec?.services?.find((part) => part.name === "api"),
        item.spec?.workers?.find((part) => part.name === "worker"),
      ].every((part) => part?.image?.digest === digest) &&
      privateChecker(item.spec)?.image.digest === ltDigest,
  );
}

export async function readProviderResponse(response, method, path) {
  if (response.ok)
    return response.json().catch(() => {
      throw new Error(
        `DigitalOcean ${method} ${path} returned invalid JSON (HTTP ${response.status})`,
      );
    });
  // A provider message (or a JSON parse error) can contain submitted values.
  // Keep only known error codes and a UUID suitable for a private support lookup.
  const data = await response.json().catch(() => null);
  const code = [
    "invalid_argument",
    "bad_request",
    "conflict",
    "server_error",
    "service_unavailable",
    "unauthorized",
    "forbidden",
    "not_found",
    "unprocessable_entity",
    "too_many_requests",
  ].includes(data?.id)
    ? data.id
    : "unknown";
  const id = [data?.request_id, response.headers.get("x-request-id")].find(
    (v) =>
      typeof v === "string" &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v),
  );
  throw new Error(
    `DigitalOcean ${method} ${path} failed (HTTP ${response.status}, ${code}${id ? `, request ${id}` : ""})`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      create: { type: "boolean" },
      propose: { type: "boolean" },
      wait: { type: "boolean" },
      "app-id": { type: "string" },
      digest: { type: "string" },
      "languagetool-digest": { type: "string" },
      "coordinated-checker": { type: "string" },
    },
  });
  const token = required(process.env, "DIGITALOCEAN_ACCESS_TOKEN");
  const appId = values["app-id"] ?? process.env.DIGITALOCEAN_APP_ID;
  const coordinated = values["coordinated-checker"] !== undefined;
  const requestedLt =
    values["coordinated-checker"] ?? values["languagetool-digest"];
  if (coordinated) {
    assert(
      !values["languagetool-digest"] &&
        appId &&
        !values.create &&
        (values.wait || values.propose) &&
        process.env.GITHUB_ACTIONS === "true" &&
        process.env.RELEASE_TAG === `v${proofingReleaseVersion}`,
      "Invalid coordinated checker rollout",
    );
    assertCurrentRef(workflowContext());
    imageDigest(requestedLt);
  }
  if (requestedLt !== undefined && !coordinated) {
    imageDigest(requestedLt);
    assert(
      appId &&
        !values.create &&
        process.env.GITHUB_ACTIONS !== "true" &&
        (values.propose || values.wait),
      "LanguageTool changes require an operator proposal or waited existing-app update",
    );
  }
  assert(
    !(values.create && appId),
    "Creation does not accept an existing app ID",
  );
  assert(!(values.create && values.propose), "Choose either create or propose");

  async function request(path, body, method = body ? "POST" : "GET") {
    const response = await fetch(`https://api.digitalocean.com/v2${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
    });
    return readProviderResponse(response, method, path);
  }

  let spec;
  let previousApp;
  let previousIds = [];
  if (appId) {
    assert.match(appId, /^[0-9a-f-]{36}$/, "Invalid DigitalOcean app ID");
    const { app } = await request(`/apps/${appId}`);
    previousApp = app;
    if (requestedLt !== undefined && !coordinated) {
      const apiDigest = values.digest ?? process.env.GROVE_IMAGE_DIGEST;
      assert(
        !app.in_progress_deployment?.id &&
          app.active_deployment?.phase === "ACTIVE" &&
          [app.spec, app.active_deployment.spec].every(
            (s) =>
              s?.services?.find((p) => p.name === "api")?.image?.digest ===
                apiDigest &&
              s?.workers?.find((p) => p.name === "worker")?.image?.digest ===
                apiDigest,
          ),
        "An independent LanguageTool change must preserve the verified active API and worker digests",
      );
    } else {
      assert(
        privateChecker(app.spec)?.image.digest ===
          privateChecker(app.active_deployment?.spec)?.image.digest,
        "An ordinary release cannot change the active LanguageTool digest or topology",
      );
    }
    if (coordinated) {
      assert(
        !app.in_progress_deployment?.id &&
          app.active_deployment?.phase === "ACTIVE",
        "Existing rollout must be settled",
      );
      for (const candidate of [app.spec, app.active_deployment.spec]) {
        const checker = privateChecker(candidate);
        if (checker)
          assert(
            checker.instance_count === 1 &&
              checker.instance_size_slug === "apps-s-1vcpu-1gb-fixed" &&
              checker.image.repository === "grove" &&
              checker.image.digest === requestedLt,
            "Unexpected existing checker; reconcile before release",
          );
        assert(
          !candidate.services
            .find((s) => s.name === "api")
            ?.envs?.some((e) => e.key === "LANGUAGETOOL_URL" && e.value),
          "Stage checker with text transmission off",
        );
      }
    }
    previousIds = [
      app.active_deployment?.id,
      app.in_progress_deployment?.id,
    ].filter(Boolean);
    spec = updateImageSpec(
      app.spec,
      values.digest ?? process.env.GROVE_IMAGE_DIGEST,
      requestedLt,
      coordinated,
    );
  } else {
    assert(
      values.create || values.propose,
      "Use --create, --propose, or --app-id",
    );
    spec = createAppSpec({
      ...process.env,
      ...(values.digest ? { GROVE_IMAGE_DIGEST: values.digest } : {}),
    });
  }
  const ltDigest = privateChecker(spec)?.image.digest;
  const proposal = await request("/apps/propose", {
    spec,
    ...(appId ? { app_id: appId } : {}),
  });
  console.log(
    JSON.stringify({
      action: "validated",
      app: spec.name,
      region: spec.region,
      digest: spec.services.find((item) => item.name === "api").image.digest,
      languagetoolDigest: ltDigest,
      cost: proposal.app_cost,
    }),
  );
  if (values.propose) return;

  if (
    coordinated &&
    !previousApp.in_progress_deployment?.id &&
    isDeepStrictEqual(previousApp.spec, spec) &&
    previousApp.active_deployment?.phase === "ACTIVE" &&
    findDeployment(
      [previousApp.active_deployment],
      values.digest ?? process.env.GROVE_IMAGE_DIGEST,
      [],
      ltDigest,
    )
  ) {
    assertCurrentRef(workflowContext());
    console.log(
      JSON.stringify({
        action: "already-active",
        deploymentId: previousApp.active_deployment.id,
        languagetoolDigest: ltDigest,
      }),
    );
    return;
  }
  if (appId) {
    const { app: current } = await request(`/apps/${appId}`);
    assertUnchangedApp(previousApp, current);
  }
  if (process.env.GITHUB_ACTIONS === "true")
    assertCurrentRef(workflowContext());
  const { app } = appId
    ? await request(`/apps/${appId}`, { spec }, "PUT")
    : await request("/apps", { spec });
  const digest = spec.services.find((item) => item.name === "api").image.digest;
  let deployment = findDeployment(
    [app.in_progress_deployment],
    digest,
    previousIds,
    ltDigest,
  );
  console.log(
    JSON.stringify({
      action: appId ? "updated" : "created",
      appId: app.id,
      deploymentId: deployment?.id,
      defaultIngress: app.default_ingress,
      liveUrl: app.live_url,
    }),
  );
  if (!values.wait) return;
  const deadline = Date.now() + 30 * 60 * 1000;
  let previousPhase;
  while (Date.now() < deadline) {
    // Creation can return before the deployment exists. Never mistake an older
    // active deployment for the new image's successful rollout.
    if (!deployment) {
      const { deployments } = await request(
        `/apps/${app.id}/deployments?per_page=5`,
      );
      deployment = findDeployment(deployments, digest, previousIds, ltDigest);
      if (!deployment) {
        await setTimeout(10000);
        continue;
      }
    }
    ({ deployment } = await request(
      `/apps/${app.id}/deployments/${deployment.id}`,
    ));
    if (deployment.phase !== previousPhase) {
      console.log(
        JSON.stringify({
          deploymentId: deployment.id,
          phase: deployment.phase,
        }),
      );
      previousPhase = deployment.phase;
    }
    if (deployment.phase === "ACTIVE") {
      const { app: current } = await request(`/apps/${app.id}`);
      assertActiveDeployment(current, deployment.id, digest, ltDigest);
      if (process.env.GITHUB_ACTIONS === "true")
        assertCurrentRef(workflowContext());
      return;
    }
    assert(
      !["ERROR", "CANCELED", "SUPERSEDED"].includes(deployment.phase),
      `Deployment ended with ${deployment.phase}`,
    );
    await setTimeout(10000);
  }
  throw new Error("Deployment did not become active within 30 minutes");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
