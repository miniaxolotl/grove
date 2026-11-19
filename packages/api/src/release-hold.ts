import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";

export type HoldIdentity = {
  schema: 1;
  source: string;
  production: string;
  tag: string;
  run: number;
  attempt: number;
  digest: string;
  publication: string;
};
type BuildIdentity = {
  revision: string;
  version: string;
  productVersion: string;
  component: string;
  enabled: boolean;
  holdRequired?: boolean;
};
type Role = "api" | "worker";
let approvedControl:
  | Readonly<{ identity: HoldIdentity; approval: string; role: Role }>
  | undefined;
export const approvedReleaseControl = () => approvedControl;
export const heldIdentityHash = (identity: HoldIdentity) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.keys(identity)
            .sort()
            .map((key) => [key, identity[key as keyof HoldIdentity]]),
        ),
      ),
    )
    .digest("hex");
declare const __GROVE_HELD_RELEASE_BUILD__: boolean;
type EntryDependencies = {
  identity: () => Promise<BuildIdentity>;
  listen: (
    identity: HoldIdentity,
    role: Role,
    env: NodeJS.ProcessEnv,
  ) => Promise<unknown>;
  required?: boolean;
  reconcile?: (
    identity: HoldIdentity,
    receipt: string,
    role: Role,
    env: NodeJS.ProcessEnv,
  ) => Promise<unknown>;
  approve?: (
    identity: HoldIdentity,
    approval: string,
    role: Role,
    env: NodeJS.ProcessEnv,
  ) => Promise<unknown>;
};

export function parseHold(value: string, binary: BuildIdentity): HoldIdentity {
  try {
    const hold = JSON.parse(value) as HoldIdentity;
    assert.deepEqual(
      Object.keys(hold).sort(),
      [
        "schema",
        "source",
        "production",
        "tag",
        "run",
        "attempt",
        "digest",
        "publication",
      ].sort(),
    );
    assert.equal(hold.schema, 1);
    for (const sha of [hold.source, hold.production])
      assert.match(sha, /^[a-f0-9]{40}$/);
    assert.match(hold.publication, /^[a-f0-9]{64}$/);
    assert.match(hold.digest, /^sha256:[a-f0-9]{64}$/);
    assert(Number.isSafeInteger(hold.run) && hold.run > 0);
    assert(Number.isSafeInteger(hold.attempt) && hold.attempt > 0);
    assert.match(hold.tag, /^v\d+\.\d+\.\d+$/);
    assert.equal(binary.enabled, true);
    assert.equal(binary.component, "api");
    assert.equal(binary.revision, hold.source);
    assert.match(binary.version, /^\d+\.\d+\.\d+$/);
    assert.equal(`v${binary.productVersion}`, hold.tag);
    return hold;
  } catch {
    throw new Error(
      "Invalid held release configuration; runtime effects remain stopped",
    );
  }
}

/** The hold is a startup latch, never a remotely unlockable job runner. */
export async function releaseEntry(
  role: Role,
  start: () => Promise<unknown>,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: EntryDependencies = {
    required:
      typeof __GROVE_HELD_RELEASE_BUILD__ !== "undefined" &&
      __GROVE_HELD_RELEASE_BUILD__,
    identity: async (): Promise<BuildIdentity> =>
      JSON.parse(
        await readFile(
          new URL("./telemetry-build.json", import.meta.url),
          "utf8",
        ),
      ),
    listen: async (
      identity: HoldIdentity,
      role: Role,
      env: NodeJS.ProcessEnv,
    ): Promise<unknown> => serveHeldStatus(identity, role, env),
    reconcile: async (identity, receipt, role, env) =>
      (await import("./lifecycle-runtime.ts")).startLifecycleRuntime(
        identity,
        receipt,
        role,
        env,
      ),
    approve: async (identity, approval, role, env) =>
      (await import("./lifecycle-runtime.ts")).approveLifecycleRuntime(
        identity,
        approval,
        role,
        env,
      ),
  },
) {
  approvedControl = undefined;
  const held = env.GROVE_RELEASE_HOLD !== undefined;
  const approved = env.GROVE_RELEASE_APPROVAL !== undefined;
  const reconcile = env.GROVE_RELEASE_RECONCILE !== undefined;
  if (!held && !approved && !reconcile && !dependencies.required)
    return start();
  let identity: HoldIdentity;
  let receipt: string | undefined, approvalHash: string | undefined;
  try {
    const binary = await dependencies.identity();
    if (dependencies.required) assert.equal(binary.holdRequired, true);
    assert(
      Number(held) + Number(approved) + Number(reconcile) === 1,
      "Exactly one held/reconcile/approved release control is required",
    );
    if (approved) {
      const approval = JSON.parse(env.GROVE_RELEASE_APPROVAL!);
      assert.deepEqual(
        Object.keys(approval).sort(),
        ["schema", "identity", "approval"].sort(),
      );
      assert.equal(approval.schema, 1);
      assert.match(approval.approval, /^[a-f0-9]{64}$/);
      approvalHash = approval.approval;
      identity = parseHold(JSON.stringify(approval.identity), binary);
    } else if (reconcile) {
      const phase = JSON.parse(env.GROVE_RELEASE_RECONCILE!);
      assert.deepEqual(
        Object.keys(phase).sort(),
        ["schema", "identity", "receipt"].sort(),
      );
      assert.equal(phase.schema, 1);
      assert.match(phase.receipt, /^[a-f0-9]{64}$/);
      receipt = phase.receipt;
      identity = parseHold(JSON.stringify(phase.identity), binary);
    } else identity = parseHold(env.GROVE_RELEASE_HOLD!, binary);
  } catch {
    throw new Error(
      "Invalid held release configuration; runtime effects remain stopped",
    );
  }
  if (reconcile) {
    assert(
      dependencies.reconcile,
      "Qualified lifecycle runtime unavailable; retain hold",
    );
    return dependencies.reconcile(identity, receipt!, role, env);
  }
  if (approved) {
    assert(
      dependencies.approve,
      "Persisted release approval is required before runtime effects",
    );
    await dependencies.approve(identity, approvalHash!, role, env);
    approvedControl = Object.freeze({
      identity: Object.freeze(identity),
      approval: approvalHash!,
      role,
    });
    return start();
  }
  return dependencies.listen(identity, role, env);
}

async function probeHeldDatabase(role: Role, env: NodeJS.ProcessEnv) {
  const target = new URL(env.DATABASE_URL ?? "");
  assert(["postgres:", "postgresql:"].includes(target.protocol));
  assert.equal(
    decodeURIComponent(target.username),
    role === "api" ? "grove_api" : "grove_jobs",
  );
  assert.equal(target.searchParams.get("sslmode"), "verify-full");
  assert.equal(env.DATABASE_SSL, "require");
  const { createDatabase, probeDatabase } = await import("@lib/database");
  const db = createDatabase(target.href, {
    ssl: true,
    max: 1,
    acquireTimeoutMs: 10000,
    statementTimeoutMs: 10000,
  });
  try {
    await db.transaction(async (trx) => {
      await trx.raw("SET TRANSACTION READ ONLY");
      await probeDatabase(trx);
      if (role === "worker") {
        await trx.raw(
          "SELECT fingerprint, export_task_id, export_preparation_id FROM transactional_emails LIMIT 0",
        );
        await trx.raw(
          "SELECT id, snapshot, lease_id, fingerprint, accepted_at, failed_at FROM deletion_receipts LIMIT 0",
        );
      }
    });
  } finally {
    await db.destroy();
  }
}

export async function serveHeldStatus(
  identity: HoldIdentity,
  role: Role,
  env: NodeJS.ProcessEnv,
  probe: () => Promise<void> = () => probeHeldDatabase(role, env),
  lifecycle?: RequestListener,
  privateProof?: RequestListener,
) {
  let probing = false;
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", "application/json");
    const send = (code: number, body: unknown) => {
      response.writeHead(code);
      response.end(JSON.stringify(body));
    };
    if (
      privateProof &&
      request.method === "GET" &&
      request.url === "/_grove/release/lifecycle"
    )
      return privateProof(request, response);
    if (
      lifecycle &&
      role === "api" &&
      request.method === "POST" &&
      ["/v1/webhooks/clerk", "/v1/webhooks/stripe"].includes(request.url ?? "")
    )
      return lifecycle(request, response);
    if (request.method !== "GET") return send(503, { status: "release_held" });
    if (request.url === "/health/live")
      return send(200, { status: "release_held", role });
    if (request.url !== "/_grove/release/held")
      return send(503, { status: "release_held" });
    const challenge = request.headers["x-grove-release-challenge"];
    if (typeof challenge !== "string" || !/^[a-f0-9]{64}$/.test(challenge))
      return send(400, { status: "challenge_required" });
    // One bounded interactive read, not a timer/poller or background job.
    if (probing) return send(503, { status: "probe_busy" });
    probing = true;
    try {
      await probe();
      return send(200, {
        status: "release_held",
        role,
        identity,
        schema: "verified",
        challenge,
      });
    } catch {
      return send(503, { status: "release_held", role, schema: "unavailable" });
    } finally {
      probing = false;
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(
      Number(env.PORT ?? 26080),
      role === "api" ? "0.0.0.0" : "127.0.0.1",
      resolve,
    );
  });
  const close = () =>
    new Promise<void>((resolve) => {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
      server.close(() => resolve());
      server.closeIdleConnections();
    });
  const stop = () => void close();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return { server, close };
}
