import { verify, createPublicKey, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { need, hashJSON, canonical, uuid } from "./operator-control.mjs";
import { appStateFingerprint } from "../../scripts/deploy-digitalocean.mjs";
import { validateCompleteInstanceInventory } from "../../scripts/release/held-instance-inventory.mjs";
import { deploymentSpecMatches } from "../../scripts/release/held-provider-response.mjs";
const exact = (value, keys, code) =>
  need(
    value && hashJSON(Object.keys(value).sort()) === hashJSON([...keys].sort()),
    code,
  );
export async function verifyWindow({
  control,
  config,
  publicKey,
  manifest,
  policy,
  authority,
  readOnly = false,
}) {
  exact(config, ["certificate", "controls"], "WINDOW_CONFIGURATION_REJECTED");
  const certificate = await control.readPrivate(config.certificate),
    controls = await control.readPrivate(config.controls),
    p = certificate.payload;
  exact(certificate, ["payload", "signature"], "WINDOW_CERTIFICATE_REJECTED");
  exact(
    p,
    [
      "schema",
      "kind",
      "id",
      "authorityId",
      "custodyId",
      "manifest",
      "source",
      "app",
      "digest",
      "publication",
      "ownerSession",
      "issuedAt",
      "expiresAt",
      "leaseMs",
      "controlsHash",
      "ownerQuiescence",
    ],
    "WINDOW_CERTIFICATE_REJECTED",
  );
  const key = createPublicKey(publicKey);
  need(
    key.asymmetricKeyType === "ed25519" &&
      verify(
        null,
        Buffer.from(canonical(p)),
        key,
        Buffer.from(certificate.signature, "base64"),
      ),
    "WINDOW_SIGNATURE_REJECTED",
  );
  need(
    p.schema === 1 &&
      p.kind === "cooperating-writer-window" &&
      uuid(p.id) &&
      p.authorityId === authority.descriptor.id &&
      p.custodyId === authority.descriptor.custodyId &&
      p.manifest === manifest.hash &&
      p.source === manifest.source &&
      p.app === policy.appId &&
      p.ownerSession === policy.parentSession &&
      p.ownerQuiescence === "dashboard-and-other-writers-quiescent" &&
      /^sha256:[a-f0-9]{64}$/.test(p.digest) &&
      /^[a-f0-9]{64}$/.test(p.publication),
    "WINDOW_BINDING_REJECTED",
  );
  const now = Date.now();
  need(
    Number.isSafeInteger(p.issuedAt) &&
      Number.isSafeInteger(p.expiresAt) &&
      p.issuedAt <= now &&
      (readOnly || p.expiresAt > now) &&
      p.expiresAt > p.issuedAt &&
      p.expiresAt - p.issuedAt <= 900000 &&
      Number.isInteger(p.leaseMs) &&
      p.leaseMs >= 1000 &&
      p.leaseMs <= 300000,
    "WINDOW_EXPIRED",
  );
  exact(
    controls,
    [
      "schema",
      "authorityId",
      "app",
      "source",
      "digest",
      "ownerSession",
      "observedAt",
      "validUntil",
      "dashboardCustodian",
      "pausedControllers",
    ],
    "WINDOW_CONTROLS_REJECTED",
  );
  need(
    controls.schema === 1 &&
      controls.authorityId === p.authorityId &&
      controls.app === p.app &&
      controls.source === p.source &&
      controls.digest === p.digest &&
      controls.ownerSession === p.ownerSession &&
      controls.observedAt <= p.issuedAt &&
      controls.validUntil >= p.expiresAt &&
      typeof controls.dashboardCustodian === "string" &&
      controls.dashboardCustodian.length > 0 &&
      Array.isArray(controls.pausedControllers) &&
      controls.pausedControllers.length > 0 &&
      controls.pausedControllers.length <= 100 &&
      hashJSON(controls) === p.controlsHash,
    "WINDOW_CONTROLS_REJECTED",
  );
  const names = new Set();
  for (const item of controls.pausedControllers) {
    exact(item, ["name", "receipt"], "WINDOW_CONTROLS_REJECTED");
    need(
      typeof item.name === "string" &&
        item.name.length > 0 &&
        !names.has(item.name) &&
        /^[a-f0-9]{64}$/.test(item.receipt),
      "WINDOW_CONTROLS_REJECTED",
    );
    names.add(item.name);
  }
  await authority.status();
  return { binding: p, certificateHash: hashJSON(certificate) };
}
function provider(state, policy, binding) {
  const app = state.app;
  need(
    app?.id === binding.app &&
      !app.pending_deployment &&
      !app.in_progress_deployment &&
      app.active_deployment?.phase === "ACTIVE" &&
      deploymentSpecMatches(app),
    "WINDOW_PROVIDER_UNSETTLED",
  );
  need(
    app.spec.services?.length === 1 &&
      app.spec.workers?.length === 1 &&
      ["jobs", "static_sites", "functions", "databases"].every(
        (k) => !app.spec[k]?.length,
      ),
    "WINDOW_PROVIDER_TOPOLOGY",
  );
  need(
    app.spec.services[0].name === "api" &&
      app.spec.workers[0].name === "worker",
    "WINDOW_PROVIDER_TOPOLOGY",
  );
  for (const [part, command] of [
    [app.spec.services[0], "node dist/server.js"],
    [app.spec.workers[0], "node dist/worker.js"],
  ])
    need(
      part.instance_count === 1 &&
        !part.autoscaling &&
        part.run_command === command,
      "WINDOW_PROVIDER_TOPOLOGY",
    );
  for (const part of [...app.spec.services, ...app.spec.workers])
    need(
      part.image &&
        [policy.deployedImage, binding.digest].includes(part.image.digest) &&
        part.image.deploy_on_push?.enabled !== true &&
        !part.git &&
        !part.github &&
        !part.gitlab &&
        !part.bitbucket,
      "WINDOW_PROVIDER_AUTODEPLOY_OR_IMAGE",
    );
  for (const key of ["state", "settings"])
    need(/^[a-f0-9]{64}$/.test(state[key] ?? ""), "WINDOW_PROVIDER_HASH");
  need(
    Array.isArray(state.instances) &&
      typeof state.generation === "string" &&
      state.generation === app.active_deployment.id,
    "WINDOW_PROVIDER_INVENTORY",
  );
  const instances = validateCompleteInstanceInventory({
    instances: state.instances,
  });
  const names = instances.map((i) => i.component_name).sort();
  need(
    new Set(
      [...app.spec.services, ...app.spec.workers].map((p) => p.image.digest),
    ).size === 1,
    "WINDOW_PROVIDER_IMAGE_DRIFT",
  );
  need(
    app.spec.maintenance?.archive === true
      ? names.length === 0
      : hashJSON(names) === hashJSON(["api", "worker"]),
    "WINDOW_PROVIDER_INVENTORY",
  );
  need(
    state.state === appStateFingerprint(app) &&
      state.settings === appStateFingerprint({ id: app.id, spec: app.spec }),
    "WINDOW_PROVIDER_HASH_DRIFT",
  );
  return {
    state: state.state,
    settings: state.settings,
    generation: state.generation,
    instances: hashJSON(instances),
  };
}
const leaseCaches = new Map();
export function createProviderWindow({
  control,
  authority,
  manifest,
  policy,
  config,
  publicKey,
  owner = randomUUID(),
}) {
  const cacheKey = authority.descriptor.id + ":" + owner + ":" + manifest.hash;
  if (!leaseCaches.has(cacheKey)) leaseCaches.set(cacheKey, new Map());
  const leases = leaseCaches.get(cacheKey),
    wall = Date.now(),
    mono = performance.now();
  const clock = () =>
    need(
      Math.abs(Date.now() - wall - (performance.now() - mono)) < 1000,
      "WINDOW_CLOCK_CHANGED",
    );
  async function request(operation, command, state, context = {}) {
    command = JSON.parse(JSON.stringify(command));
    clock();
    const readOnly = operation === "window-readback",
      readOnlyCommand = readOnly || operation.startsWith("window-resolve-"),
      proof = await verifyWindow({
        control,
        authority,
        manifest,
        policy,
        config,
        publicKey,
        readOnly,
      }),
      b = proof.binding;
    need(
      command.source === manifest.source &&
        (command.manifest ?? command.manifestHash) === manifest.hash &&
        (!command.publication || command.publication === b.publication) &&
        (!context.digest || context.digest === b.digest) &&
        uuid(command.id),
      "WINDOW_COMMAND_BINDING",
    );
    need(
      Number.isSafeInteger(command.issuedAt) &&
        Number.isSafeInteger(command.expiresAt) &&
        command.issuedAt <= Date.now() &&
        (readOnlyCommand || command.expiresAt > Date.now()) &&
        command.expiresAt - command.issuedAt <= 300000,
      "WINDOW_COMMAND_EXPIRED",
    );
    const observed = provider(state, policy, b),
      commandHash = hashJSON(command);
    clock();
    const sql = ["migration", "sql"].includes(context.kind);
    const result = await authority.call(operation, {
      ...proof,
      owner,
      commandHash,
      observed,
      expected: sql ? observed.state : command.expected,
      proposed: sql ? context.proofHash : command.proposed,
      kind: context.kind ?? "provider",
      proofHash: context.proofHash,
      fence: leases.get(commandHash)?.fence,
    });
    clock();
    if (operation === "window-assert") leases.set(commandHash, result);
    return result;
  }
  return {
    assert: (...args) => request("window-assert", ...args),
    prepare: (...args) => request("window-prepare", ...args),
    finish: (...args) => request("window-finish", ...args),
    release: (...args) => request("window-release", ...args),
    resolveMigration: (...args) => request("window-resolve-migration", ...args),
    resolveSQL: (...args) => request("window-resolve-sql", ...args),
    resolveProvider: (...args) => request("window-resolve-provider", ...args),
    resolveIdle: (...args) => request("window-resolve-idle", ...args),
    readback: (...args) => request("window-readback", ...args),
    verify: (options = {}) =>
      verifyWindow({
        control,
        authority,
        manifest,
        policy,
        config,
        publicKey,
        ...options,
      }),
  };
}
