import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, readFile, readdir } from "node:fs/promises";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import process from "node:process";
import { Buffer } from "node:buffer";
import { appStateFingerprint } from "../../scripts/deploy-digitalocean.mjs";
import { createControl, canonical, hashJSON } from "./operator-control.mjs";
import { provisionAuthority, openAuthority } from "./authority.mjs";
const api = await import("./window.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});
test("signed window + real SQLite serializes cooperating controllers and preserves uncertain provider acceptance across expiry", async () => {
  assert.equal(typeof api.createProviderWindow, "function");
  const base = await mkdtemp(process.cwd() + "/.window-");
  try {
    await mkdir(base + "/a", { mode: 0o700 });
    await mkdir(base + "/w", { mode: 0o700 });
    const source = "a".repeat(40),
      manifest = { source, hash: "b".repeat(64) },
      app = "3aef47f9-3724-4f21-9cad-8c4eb5644af0",
      digest = "sha256:" + "d".repeat(64),
      publication = "e".repeat(64),
      parentSession = "fixture-owner";
    const descriptor = await provisionAuthority({
      root: base + "/a",
      workRoot: base + "/w",
      source,
      codeHash: "b".repeat(64),
      id: randomUUID(),
      custodyId: randomUUID(),
    });
    const authority = openAuthority(descriptor),
      control = createControl(base + "/w"),
      now = Date.now();
    const controls = {
      schema: 1,
      authorityId: descriptor.id,
      app,
      source,
      digest,
      ownerSession: parentSession,
      observedAt: now,
      validUntil: now + 60000,
      dashboardCustodian: "fixture-owner",
      pausedControllers: [
        { name: "fixture-release-controller", receipt: "f".repeat(64) },
      ],
    };
    const payload = {
      schema: 1,
      kind: "cooperating-writer-window",
      id: randomUUID(),
      authorityId: descriptor.id,
      custodyId: descriptor.custodyId,
      manifest: manifest.hash,
      source,
      app,
      digest,
      publication,
      ownerSession: parentSession,
      issuedAt: now,
      expiresAt: now + 60000,
      leaseMs: 1000,
      controlsHash: hashJSON(controls),
      ownerQuiescence: "dashboard-and-other-writers-quiescent",
    };
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    await control.durableWrite(
      base + "/w/controls.json",
      JSON.stringify(controls),
    );
    await control.durableWrite(
      base + "/w/window.json",
      JSON.stringify({
        payload,
        signature: sign(
          null,
          Buffer.from(canonical(payload)),
          privateKey,
        ).toString("base64"),
      }),
    );
    const input = {
      control,
      authority,
      manifest,
      policy: {
        appId: app,
        parentSession,
        deployedImage: "sha256:" + "c".repeat(64),
      },
      config: {
        certificate: base + "/w/window.json",
        controls: base + "/w/controls.json",
      },
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
    };
    const one = api.createProviderWindow({ ...input, owner: randomUUID() }),
      two = api.createProviderWindow({ ...input, owner: randomUUID() });
    const spec = {
      name: "grove",
      maintenance: { archive: true, enabled: true },
      services: [
        {
          name: "api",
          instance_count: 1,
          run_command: "node dist/server.js",
          image: { digest, deploy_on_push: { enabled: false } },
        },
      ],
      workers: [
        {
          name: "worker",
          instance_count: 1,
          run_command: "node dist/worker.js",
          image: { digest },
        },
      ],
    };
    const initial = {
      id: app,
      spec,
      active_deployment: { id: "old", phase: "ACTIVE", spec },
    };
    const state = {
      app: initial,
      state: appStateFingerprint(initial),
      settings: appStateFingerprint({ id: app, spec }),
      generation: "old",
      instances: [],
    };
    const nextSpec = { ...spec, region: "fixture-new" };
    const command = {
      schema: 1,
      id: randomUUID(),
      source,
      manifest: manifest.hash,
      publication,
      custody: "9".repeat(64),
      action: "restore",
      issuedAt: now,
      expiresAt: now + 60000,
      expected: state.state,
      proposed: appStateFingerprint({ id: app, spec: nextSpec }),
    };
    const lease = await one.assert(command, state, { digest });
    assert(lease.fence > 0);
    await assert.rejects(
      two.assert({ ...command, id: randomUUID() }, state, { digest }),
      /WINDOW_BUSY/,
    );
    await assert.rejects(
      one.assert(
        command,
        {
          ...state,
          app: { ...state.app, pending_deployment: { id: "racing" } },
        },
        { digest },
      ),
      /PROVIDER/,
    );
    await one.prepare(command, state, { digest });
    await assert.rejects(
      one.prepare(command, state, { digest }),
      /EFFECT_ALREADY|UNCERTAIN/,
    );
    await setTimeout(1100);
    await assert.rejects(
      two.assert({ ...command, id: randomUUID() }, state, { digest }),
      /UNCERTAIN|QUARANTINED/,
    );
    const nextApp = {
      id: app,
      spec: nextSpec,
      active_deployment: { id: "new", phase: "ACTIVE", spec: nextSpec },
    };
    const after = {
      app: nextApp,
      state: appStateFingerprint(nextApp),
      settings: command.proposed,
      generation: "new",
      instances: [],
    };
    const snapshot = async () => {
      const out = {};
      for (const n of await readdir(descriptor.root))
        out[n] = (await readFile(descriptor.root + "/" + n)).toString("hex");
      return out;
    };
    const before = await snapshot();
    await one.readback(command, after, { digest });
    assert.deepEqual(await snapshot(), before);
    const oldControls = {
      ...controls,
      observedAt: now - 10000,
      validUntil: now - 1000,
    };
    const oldPayload = {
      ...payload,
      issuedAt: now - 10000,
      expiresAt: now - 1000,
      controlsHash: hashJSON(oldControls),
    };
    await control.durableWrite(
      base + "/w/expired-controls.json",
      JSON.stringify(oldControls),
    );
    await control.durableWrite(
      base + "/w/expired-window.json",
      JSON.stringify({
        payload: oldPayload,
        signature: sign(
          null,
          Buffer.from(canonical(oldPayload)),
          privateKey,
        ).toString("base64"),
      }),
    );
    const old = api.createProviderWindow({
      ...input,
      config: {
        certificate: base + "/w/expired-window.json",
        controls: base + "/w/expired-controls.json",
      },
    });
    await old.readback(command, after, { digest });
    assert.deepEqual(await snapshot(), before);
    await assert.rejects(
      old.assert({ ...command, id: randomUUID() }, after, { digest }),
      /EXPIRED/,
    );
    const next = {
      ...command,
      id: randomUUID(),
      expected: after.state,
      proposed: "5".repeat(64),
    };
    await assert.rejects(
      two.assert(next, after, { digest }),
      /QUARANTINED|UNCERTAIN/,
    );
    // Readback never clears quarantine. A fresh signed owner-exclusive window
    // and an explicit authority-only resolution are required before any next write.
    const resolutionPayload = {
      ...payload,
      id: randomUUID(),
      issuedAt: Date.now(),
    };
    await control.durableWrite(
      base + "/w/resolution.json",
      JSON.stringify({
        payload: resolutionPayload,
        signature: sign(
          null,
          Buffer.from(canonical(resolutionPayload)),
          privateKey,
        ).toString("base64"),
      }),
    );
    const resolver = api.createProviderWindow({
      ...input,
      config: { ...input.config, certificate: base + "/w/resolution.json" },
    });
    await resolver.resolveProvider(command, after, { digest });
    const newLease = await two.assert(next, after, { digest });
    assert(newLease.fence > lease.fence);
    await assert.rejects(
      one.prepare(command, after, { digest }),
      /WINDOW_BUSY|DRIFT|UNCERTAIN/,
    );
    const bad = api.createProviderWindow({
      ...input,
      config: { ...input.config, certificate: input.config.controls },
    });
    await assert.rejects(bad.assert(next, after, { digest }), /WINDOW/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("two signed source-specific installations contend on the same pinned app database after an uncertain intent", async () => {
  const base = await mkdtemp(process.cwd() + "/.signed-sources-");
  try {
    for (const name of ["a", "w1", "w2"])
      await mkdir(base + "/" + name, { mode: 0o700 });
    const first = await provisionAuthority({
      root: base + "/a",
      workRoot: base + "/w1",
      source: "a".repeat(40),
      codeHash: "1".repeat(64),
      id: randomUUID(),
      custodyId: randomUUID(),
    });
    const second = await openAuthority(first).registerInstallation({
      workRoot: base + "/w2",
      source: "b".repeat(40),
      codeHash: "2".repeat(64),
      custodyId: randomUUID(),
    });
    const { publicKey, privateKey } = generateKeyPairSync("ed25519"),
      at = Date.now(),
      digest = "sha256:" + "d".repeat(64),
      publication = "e".repeat(64),
      parentSession = "fixture-owner";
    const make = async (d) => {
      const control = createControl(d.workRoot),
        manifest = { source: d.source, hash: hashJSON(d) };
      const controls = {
        schema: 1,
        authorityId: d.id,
        app: d.app,
        source: d.source,
        digest,
        ownerSession: parentSession,
        observedAt: at,
        validUntil: at + 60000,
        dashboardCustodian: "fixture",
        pausedControllers: [{ name: "other-writers", receipt: "f".repeat(64) }],
      };
      const payload = {
        schema: 1,
        kind: "cooperating-writer-window",
        id: randomUUID(),
        authorityId: d.id,
        custodyId: d.custodyId,
        manifest: manifest.hash,
        source: d.source,
        app: d.app,
        digest,
        publication,
        ownerSession: parentSession,
        issuedAt: at,
        expiresAt: at + 60000,
        leaseMs: 1000,
        controlsHash: hashJSON(controls),
        ownerQuiescence: "dashboard-and-other-writers-quiescent",
      };
      await control.durableWrite(
        d.workRoot + "/controls.json",
        JSON.stringify(controls),
      );
      await control.durableWrite(
        d.workRoot + "/window.json",
        JSON.stringify({
          payload,
          signature: sign(
            null,
            Buffer.from(canonical(payload)),
            privateKey,
          ).toString("base64"),
        }),
      );
      return {
        manifest,
        window: api.createProviderWindow({
          control,
          authority: openAuthority(d),
          manifest,
          policy: { appId: d.app, parentSession, deployedImage: digest },
          config: {
            certificate: d.workRoot + "/window.json",
            controls: d.workRoot + "/controls.json",
          },
          publicKey: publicKey.export({ type: "spki", format: "pem" }),
        }),
      };
    };
    const one = await make(first),
      two = await make(second),
      spec = {
        name: "grove",
        maintenance: { archive: true, enabled: true },
        services: [
          {
            name: "api",
            instance_count: 1,
            run_command: "node dist/server.js",
            image: { digest },
          },
        ],
        workers: [
          {
            name: "worker",
            instance_count: 1,
            run_command: "node dist/worker.js",
            image: { digest },
          },
        ],
      },
      app = {
        id: first.app,
        spec,
        active_deployment: { id: "held", phase: "ACTIVE", spec },
      };
    const state = {
      app,
      instances: [],
      generation: "held",
      state: appStateFingerprint(app),
      settings: appStateFingerprint({ id: app.id, spec }),
    };
    const command = (m) => ({
      schema: 1,
      id: randomUUID(),
      source: m.source,
      manifest: m.hash,
      publication,
      issuedAt: at,
      expiresAt: at + 60000,
      expected: state.state,
      proposed: "3".repeat(64),
    });
    const c1 = command(one.manifest),
      c2 = command(two.manifest);
    await one.window.assert(c1, state);
    await assert.rejects(two.window.assert(c2, state), /BUSY/);
    await one.window.prepare(c1, state);
    await setTimeout(1100);
    await assert.rejects(two.window.assert(c2, state), /QUARANTINED/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
