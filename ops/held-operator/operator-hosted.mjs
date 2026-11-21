import { need, hashJSON } from "./operator-control.mjs";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import { appStateFingerprint } from "../../scripts/deploy-digitalocean.mjs";
import { validateCompleteInstanceInventory } from "../../scripts/release/held-instance-inventory.mjs";
export function createHosted({ appId, deployedSource, deployedImage }) {
  return async function observeHosted({
    token,
    baseURL = "https://api.digitalocean.com",
    fixture = false,
    now = Date.now,
  }) {
    const base = new URL(baseURL);
    need(
      (!fixture && base.href === "https://api.digitalocean.com/") ||
        (fixture &&
          base.protocol === "http:" &&
          base.hostname === "127.0.0.1" &&
          base.pathname === "/" &&
          !base.username &&
          !base.password),
      "PROVIDER_ORIGIN_REJECTED",
    );
    need(
      typeof token === "string" && token.length > 0,
      "PROVIDER_CREDENTIAL_MISSING",
    );
    async function get(path) {
      try {
        const r = await globalThis.fetch(new URL(path, base), {
          method: "GET",
          headers: { Authorization: "Bearer " + token },
          redirect: "error",
          signal: globalThis.AbortSignal.timeout(15000),
        });
        need(r.ok, "PROVIDER_HTTP_FAILED");
        let size = 0;
        const chunks = [];
        for await (const b of r.body) {
          size += b.length;
          need(size <= 2 * 1024 * 1024, "PROVIDER_RESPONSE_TOO_LARGE");
          chunks.push(b);
        }
        return JSON.parse(Buffer.concat(chunks));
      } catch {
        need(false, "PROVIDER_READ_FAILED");
      }
    }
    function validate(spec) {
      need(
        spec?.name === "grove" &&
          spec.services?.length === 1 &&
          spec.services[0].name === "api" &&
          spec.workers?.length === 1 &&
          spec.workers[0].name === "worker" &&
          ["jobs", "static_sites", "functions", "databases"].every(
            (k) => !spec[k]?.length,
          ),
        "DEPLOYED_SOURCE_DRIFT",
      );
      for (const [part, command] of [
        [spec.services[0], "node dist/server.js"],
        [spec.workers[0], "node dist/worker.js"],
      ])
        need(
          part.image?.digest === deployedImage &&
            part.image.registry_type === "DOCKER_HUB" &&
            part.image.registry === "miniaxolotl" &&
            part.image.repository === "grove" &&
            !part.image.tag &&
            !part.image.deploy_on_push?.enabled &&
            !part.git &&
            !part.github &&
            !part.gitlab &&
            !part.bitbucket &&
            part.run_command === command,
          "DEPLOYED_SOURCE_DRIFT",
        );
    }
    const identity = (a) => ({
      id: a?.id,
      spec: a?.spec,
      active: a?.active_deployment?.id,
      phase: a?.active_deployment?.phase,
      pending: a?.pending_deployment ?? null,
      inProgress: a?.in_progress_deployment ?? null,
    });
    const { app: first } = await get("/v2/apps/" + appId);
    need(
      first?.id === appId &&
        /^[a-f0-9-]{36}$/.test(first.active_deployment?.id ?? ""),
      "PROVIDER_SHAPE_REJECTED",
    );
    validate(first.spec);
    const deploymentId = first.active_deployment.id,
      { deployment } = await get(
        `/v2/apps/${appId}/deployments/${deploymentId}`,
      );
    need(
      deployment?.id === deploymentId && deployment.spec,
      "PROVIDER_SHAPE_REJECTED",
    );
    validate(deployment.spec);
    const list = await get(`/v2/apps/${appId}/instances`);
    const rawInstances = validateCompleteInstanceInventory(list);
    const { app: last } = await get("/v2/apps/" + appId);
    need(
      hashJSON(identity(first)) === hashJSON(identity(last)) &&
        hashJSON(first.spec) === hashJSON(deployment.spec) &&
        deployment.phase === first.active_deployment.phase,
      "PROVIDER_DRIFT",
    );
    const instances = rawInstances.map((i) => {
      need(
        ["api", "worker"].includes(i.component_name) &&
          typeof i.instance_name === "string" &&
          /^[a-z0-9][a-z0-9-]{0,119}$/.test(i.instance_name),
        "PROVIDER_SHAPE_REJECTED",
      );
      return { component: i.component_name, name: i.instance_name };
    });
    const result = {
      appId,
      fingerprint: hashJSON(first.spec),
      deploymentId,
      deploymentPhase: deployment.phase,
      archive: first.spec.maintenance?.archive === true,
      maintenance: first.spec.maintenance?.enabled === true,
      inProgress: !!(first.in_progress_deployment || first.pending_deployment),
      settled:
        deployment.phase === "ACTIVE" &&
        !first.in_progress_deployment &&
        !first.pending_deployment,
      instances,
      graceSeconds: Math.min(
        ...[...first.spec.services, ...first.spec.workers].map(
          (c) => c.termination?.grace_period_seconds ?? 0,
        ),
      ),
      imageDigest: deployedImage,
      deployedSource,
      observedAt: now(),
    };
    const app = {
      ...last,
      active_deployment: { ...last.active_deployment, spec: deployment.spec },
    };
    Object.defineProperty(result, "providerState", {
      enumerable: false,
      value: {
        app,
        instances: rawInstances,
        state: appStateFingerprint(app),
        settings: appStateFingerprint({ id: appId, spec: app.spec }),
        generation: deploymentId,
      },
    });
    return result;
  };
}
export const observeHosted = async (...args) =>
  (await import("./installation.mjs"))
    .loadInstallation()
    .then((i) => i.observeHosted(...args));
