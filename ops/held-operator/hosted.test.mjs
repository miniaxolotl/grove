import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createHosted } from "./operator-hosted.mjs";
test("native archived deployment projection and protobuf-empty roster remain actual provider evidence", async () => {
  const appId = randomUUID(), deploymentId = randomUUID();
  const digest = "sha256:" + "a".repeat(64);
  const image = { digest, registry_type: "DOCKER_HUB", registry: "miniaxolotl", repository: "grove" };
  const spec = {
    name: "grove", domains: [{ domain: "example.test" }], region: "nyc",
    maintenance: { enabled: true, archive: true },
    services: [{ name: "api", run_command: "node dist/server.js", image }],
    workers: [{ name: "worker", run_command: "node dist/worker.js", image }],
    ingress: { rules: [{ component: { name: "api" } }] },
  };
  const projection = { name: spec.name, domains: spec.domains, region: spec.region, maintenance: spec.maintenance };
  let activeSpec = projection, page = {};
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url.endsWith("/instances") ? page : req.url.includes("/deployments/")
      ? { deployment: { id: deploymentId, phase: "ACTIVE", spec: activeSpec } }
      : { app: { id: appId, spec, active_deployment: { id: deploymentId, phase: "ACTIVE", spec: activeSpec } } }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const observe = createHosted({ appId, deployedImage: digest, deployedSource: "b".repeat(40) });
    const options = { token: "fixture", baseURL: "http://127.0.0.1:" + server.address().port, fixture: true };
    const result = await observe(options);
    assert.equal(result.archive, true);
    assert.deepEqual(result.instances, []);
    assert.deepEqual(result.providerState.app.active_deployment.spec, projection);
    assert.equal(result.providerState.app.spec.services.length, 1);
    for (const changed of [
      { ...projection, name: "another-app" },
      { ...projection, domains: [] },
      { ...projection, maintenance: { enabled: true, archive: false } },
      { ...projection, services: [] },
    ]) {
      activeSpec = changed;
      await assert.rejects(observe(options), /DEPLOYMENT_SPEC|SOURCE_DRIFT/);
    }
    activeSpec = projection;
    for (const incomplete of [{ meta: { total: 0 } }, { next: "more" }, { instances: null }]) {
      page = incomplete;
      await assert.rejects(observe(options), /INVENTORY/);
    }
    page = {};
    spec.maintenance = { enabled: false, archive: false };
    activeSpec = spec;
    await assert.rejects(observe(options), /INVENTORY/);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
test("hosted observer rejects incomplete real-shaped inventory and preserves canonical raw metadata at the authority boundary", async () => {
  const appId = randomUUID(),
    deploymentId = randomUUID(),
    digest = "sha256:" + "a".repeat(64),
    source = "b".repeat(40);
  const image = {
    digest,
    registry_type: "DOCKER_HUB",
    registry: "miniaxolotl",
    repository: "grove",
  };
  const spec = {
    name: "grove",
    services: [{ name: "api", run_command: "node dist/server.js", image }],
    workers: [{ name: "worker", run_command: "node dist/worker.js", image }],
  };
  const app = {
      id: appId,
      spec,
      active_deployment: { id: deploymentId, phase: "ACTIVE", spec },
    },
    rows = [
      {
        component_name: "worker",
        instance_name: "worker-one",
        extra: { revision: 2 },
      },
      {
        component_name: "api",
        instance_name: "api-one",
        extra: { revision: 1 },
      },
    ];
  let page = { instances: rows, meta: { total: 2 } };
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        req.url.endsWith("/instances")
          ? page
          : req.url.includes("/deployments/")
            ? { deployment: { id: deploymentId, phase: "ACTIVE", spec } }
            : { app },
      ),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const observe = createHosted({
        appId,
        deployedImage: digest,
        deployedSource: source,
      }),
      options = {
        token: "public-fixture-token",
        baseURL: "http://127.0.0.1:" + server.address().port,
        fixture: true,
      };
    const result = await observe(options);
    assert.equal(result.providerState.instances[0].extra.revision, 1);
    assert(Object.isFrozen(result.providerState.instances[0].extra));
    for (const marker of [
      { next_cursor: "remaining" },
      { meta: { total: 3 } },
      { links: { pages: { prev: "earlier" } } },
    ]) {
      page = { instances: rows, ...marker };
      await assert.rejects(observe(options), /INVENTORY/);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
