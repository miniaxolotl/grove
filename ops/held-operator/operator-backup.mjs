// Parameterized continuation of the existing exported-snapshot/encrypted-retained
// backup mechanism. It never migrates, changes provider state or reopens traffic.
import { need, hashJSON, sha, uuid, safeCode } from "./operator-control.mjs";
import { readSnapshot, mediaSql, verifyOriginals } from "./catalog.mjs";
import { inspectSafety, assertDatabaseQuiescence } from "./window-safety.mjs";
import { assertOwnerTarget } from "./window-db.mjs";
import { IMAGE, CA, runProcess, verifyClient } from "./operator-io.mjs";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import { isOwnedFixture } from "./operator-restore.mjs";
const backupTargets = new WeakSet();
export function fixtureBackupTarget(
  fixture,
  { afterDump = async () => {} } = {},
) {
  need(isOwnedFixture(fixture), "FIXTURE_TARGET_REJECTED");
  const target = Object.freeze({
    kind: "local-fixture",
    connect: () => {
      need(isOwnedFixture(fixture), "FIXTURE_CLOSED");
      return fixture.connect("grove_restore", "grove_owner", true);
    },
    verify: async (c) => {
      const r = (
        await c.query(
          "SELECT current_database() AS database,current_user AS role,current_setting('default_transaction_read_only') AS readonly",
        )
      ).rows[0];
      need(
        r.database === "grove_restore" &&
          r.role === "grove_owner" &&
          r.readonly === "on",
        "FIXTURE_IDENTITY_DRIFT",
      );
    },
    dump: async (id) => {
      need(isOwnedFixture(fixture), "FIXTURE_CLOSED");
      const bytes = await runProcess(
        "docker",
        dumpArguments(id, { fixtureContainer: fixture.name }).args,
      );
      await afterDump();
      return bytes;
    },
  });
  backupTargets.add(target);
  return target;
}
const shell = (s) => "'" + s.replaceAll("'", "'\"'\"'") + "'";
export function dumpArguments(snapshot, { url, fixtureContainer } = {}) {
  need(
    /^[0-9A-Fa-f]+-[0-9A-Fa-f]+-\d+$/.test(snapshot ?? ""),
    "SNAPSHOT_IDENTIFIER_REJECTED",
  );
  if (fixtureContainer) {
    need(
      /^grove-qualified-restore-[a-f0-9-]{36}$/.test(fixtureContainer),
      "FIXTURE_TARGET_REJECTED",
    );
    return {
      args: [
        "exec",
        "-i",
        fixtureContainer,
        "pg_dump",
        "--format=custom",
        "--snapshot=" + snapshot,
        "-h",
        "/socket",
        "-U",
        "grove_owner",
        "-d",
        "grove_restore",
      ],
    };
  }
  assertOwnerTarget(url);
  const u = new URL(url);
  const env = {
    PGHOST: u.hostname,
    PGPORT: "5432",
    PGDATABASE: "grove",
    PGUSER: "grove_owner",
    PGPASSWORD: decodeURIComponent(u.password),
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: "/trusted-ca.pem",
    PGCHANNELBINDING: u.searchParams.get("channel_binding") ?? "prefer",
    PGOPTIONS:
      "-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=1500",
  };
  return {
    args: [
      "run",
      "--rm",
      "--log-driver",
      "none",
      "--network",
      "host",
      "-i",
      "--read-only",
      "--cap-drop=ALL",
      "--mount",
      `type=bind,src=${CA},dst=/trusted-ca.pem,readonly`,
      "--entrypoint",
      "/bin/sh",
      IMAGE,
    ],
    input:
      Object.entries(env)
        .map(([k, v]) => `export ${k}=${shell(v)}`)
        .join("\n") +
      `\nexec pg_dump --format=custom --snapshot=${shell(snapshot)}\n`,
  };
}
export function createBackup({
  control,
  source,
  manifest,
  parentSession,
  appId,
  originalsReviewDue,
  originalsEncryptedSha256,
  crypt,
  restoreEncryptedBackup,
  assertWindow,
  releaseWindow,
}) {
  source = { ...source, registry: [...(source.registry ?? [])] };
  function validateCustody({ lifecycle, remote, held, heldAt, now }) {
    for (const e of [lifecycle, remote])
      need(
        e?.schema === 1 &&
          e.appId === appId &&
          e.heldSpecHash === held.fingerprint &&
          e.heldDeploymentId === held.deploymentId &&
          e.verifiedBy === parentSession &&
          Number.isFinite(e.observedAt) &&
          Number.isFinite(e.validUntil) &&
          e.observedAt >= heldAt &&
          e.observedAt <= now &&
          e.validUntil > now,
        "CUSTODY_NOT_CURRENT",
      );
    need(
      lifecycle.kind === "lifecycle-custody" &&
        ["identity", "billing"].every(
          (k) =>
            lifecycle[k]?.non2xx === true &&
            lifecycle[k].retryCustody === true &&
            lifecycle[k].backlogRetained === true,
        ),
      "LIFECYCLE_CUSTODY_REQUIRED",
    );
    need(
      remote.kind === "remote-reconciliation" &&
        remote.inflight === 0 &&
        remote.uncertain === 0 &&
        Array.isArray(remote.providers) &&
        hashJSON([...remote.providers].sort()) ===
          hashJSON(["identity", "billing", "mail", "models", "storage"].sort()),
      "REMOTE_RECONCILIATION_REQUIRED",
    );
  }
  async function captureQuiescentBackup({
    plan,
    approval,
    manifestHash,
    lifecycle,
    remote,
    originalsEncrypted,
    key,
    target,
    observe,
    now = Date.now,
  }) {
    if (plan !== undefined) plan = JSON.parse(JSON.stringify(plan));
    if (approval !== undefined) approval = JSON.parse(JSON.stringify(approval));
    lifecycle =
      lifecycle === undefined
        ? undefined
        : JSON.parse(JSON.stringify(lifecycle));
    remote =
      remote === undefined ? undefined : JSON.parse(JSON.stringify(remote));
    if (originalsEncrypted)
      originalsEncrypted = Buffer.from(originalsEncrypted);
    const frozen = await manifest();
    need(
      frozen.hash === manifestHash &&
        frozen.source === source.source &&
        !frozen.hardBlock,
      "OPERATOR_MANIFEST_DRIFT",
    );
    need(
      backupTargets.has(target) &&
        (target.kind === "production-readonly" ||
          target.kind === "local-fixture"),
      "BACKUP_TARGET_REJECTED",
    );
    const fixtureOnly = target.kind === "local-fixture";
    need(
      fixtureOnly || frozen.executionAdmitted === true,
      "OPERATOR_NOT_QUALIFIED",
    );
    need(
      fixtureOnly ||
        (/^[a-f0-9]{64}$/.test(originalsEncryptedSha256 ?? "") &&
          sha(originalsEncrypted) === originalsEncryptedSha256),
      "ORIGINAL_CUSTODY_POLICY_DRIFT",
    );
    need(
      approval?.approved === true &&
        approval.outageApproved === true &&
        approval.purpose === "backup-only" &&
        approval.fixtureOnly === fixtureOnly &&
        approval.parentSession === parentSession &&
        approval.method === "archive-all" &&
        uuid(approval.id),
      "BACKUP_APPROVAL_REQUIRED",
    );
    let previous = now();
    const wallClock = now;
    now = () => {
      const value = wallClock();
      need(Number.isFinite(value) && value >= previous, "CLOCK_REVERSED");
      previous = value;
      return value;
    };
    const gate = async (held) => {
      const at = now();
      need(
        approval.source === source.source &&
          plan.source === source.source &&
          plan.manifestHash === manifestHash &&
          approval.manifestHash === manifestHash &&
          approval.planHash === hashJSON(plan),
        "APPROVAL_SOURCE_DRIFT",
      );
      need(
        approval.issuedAt <= at &&
          approval.expiresAt > at &&
          approval.expiresAt > approval.issuedAt &&
          approval.expiresAt - approval.issuedAt <= 300000 &&
          approval.heldAt <= approval.issuedAt &&
          plan.observedAt <= at &&
          at - plan.observedAt <= 300000,
        "APPROVAL_EXPIRED",
      );
      need(
        approval.lifecycleHash === hashJSON(lifecycle) &&
          approval.remoteHash === hashJSON(remote) &&
          approval.originalsHash === sha(originalsEncrypted),
        "CUSTODY_DRIFT",
      );
      need(
        approval.originalsReviewDue === originalsReviewDue &&
          /^\d{4}-\d{2}-\d{2}$/.test(originalsReviewDue) &&
          at < Date.parse(originalsReviewDue + "T23:59:59Z"),
        "BACKUP_CUSTODY_REVIEW_REQUIRED",
      );
      need(
        held.fingerprint === approval.heldSpecHash &&
          held.fingerprint === plan.provider.fingerprint &&
          held.deploymentId === approval.heldDeploymentId &&
          held.deploymentId === plan.provider.deploymentId,
        "PROVIDER_DRIFT",
      );
      need(
        held.archive &&
          held.maintenance &&
          held.settled &&
          !held.inProgress &&
          held.instances.length === 0 &&
          held.graceSeconds >= 40,
        "WRITERS_NOT_STOPPED",
      );
      need(
        held.observedAt <= at && at - held.observedAt <= 15000,
        "PROVIDER_STALE",
      );
      validateCustody({
        lifecycle,
        remote,
        held,
        heldAt: approval.heldAt,
        now: at,
      });
      if (!fixtureOnly) {
        need(typeof assertWindow === "function", "EXCLUSIVE_WINDOW_REQUIRED");
        await assertWindow(approval, held);
        need(approval.expiresAt > now(), "APPROVAL_EXPIRED");
      }
    };
    await gate(await observe());
    const journal = await control.openJournal(
      control.root + "/backup-journals",
      approval.id,
      {
        source: source.source,
        manifestHash,
        approvalHash: hashJSON(approval),
        planHash: hashJSON(plan),
        fixtureOnly,
      },
    );
    let client;
    const start = now();
    const confirm = async (before) => {
      client = target.connect();
      try {
        await client.connect();
        await target.verify(client);
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        assertDatabaseQuiescence(
          await inspectSafety((sql) => client.query(sql)),
        );
        const current = await readSnapshot(client);
        need(
          ["catalogHash", "rowsetsHash", "mediaHash"].every(
            (k) => current[k] === before[k],
          ) &&
            hashJSON(current.metadata.history) ===
              hashJSON(before.metadata.history),
          "BACKUP_AUTHORITY_DRIFT",
        );
        await client.query("ROLLBACK");
      } finally {
        await client.end().catch(() => {});
        client = null;
      }
    };
    try {
      await journal.append("backup_pending");
      const originals = JSON.parse(
        (await crypt(originalsEncrypted, key, true)).toString(),
      );
      client = target.connect();
      await client.connect();
      await target.verify(client);
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query(
        "SET LOCAL idle_in_transaction_session_timeout='180s'; SET LOCAL transaction_timeout='180s'",
      );
      assertDatabaseQuiescence(await inspectSafety((sql) => client.query(sql)));
      const before = await readSnapshot(client);
      need(
        ["catalogHash", "rowsetsHash", "mediaHash"].every(
          (k) => before[k] === plan.database[k],
        ) && hashJSON(before.metadata.history) === plan.database.historyHash,
        "BACKUP_PLAN_DRIFT",
      );
      need(
        hashJSON(before.metadata.history.map((r) => r.name)) ===
          hashJSON(source.registry.slice(0, 44)),
        "HISTORY_DRIFT",
      );
      const originalsVerified = verifyOriginals(
          originals,
          (await client.query(mediaSql)).rows,
        ),
        capturedAt = now();
      const snapshot = (await client.query("SELECT pg_export_snapshot() AS id"))
          .rows[0].id,
        dump = await target.dump(snapshot);
      await client.query("ROLLBACK");
      await client.end();
      client = null;
      const encrypted = await crypt(dump, key),
        dir = await control.privateDirectory(
          control.root + "/backups/" + approval.id,
          { create: true },
        ),
        path = dir + "/database.dump.gpg";
      await control.durableWrite(path, encrypted);
      await journal.append("backup_captured", { backupHash: sha(encrypted) });
      const retained = await control.readPrivate(path, {
        json: false,
        max: 256 * 1024 * 1024,
      });
      need(
        sha(retained) === sha(encrypted) &&
          sha(await crypt(retained, key, true)) === sha(dump),
        "BACKUP_READBACK_DRIFT",
      );
      await confirm(before);
      await gate(await observe());
      await journal.append("restore_pending");
      const restored = await restoreEncryptedBackup({
        encrypted: retained,
        key,
        before,
      });
      need(
        restored.restored === true && restored.cleanupVerified === true,
        "RESTORE_NOT_VERIFIED",
      );
      await confirm(before);
      await gate(await observe());
      await journal.append("backup_verified", { backupHash: sha(retained) });
      const receipt = {
        schema: 1,
        purpose: "quiescent-backup-only",
        source: source.source,
        manifestHash,
        fixtureOnly,
        migrationExecution: false,
        approvalHash: hashJSON(approval),
        planHash: hashJSON(plan),
        heldSpecHash: plan.provider.fingerprint,
        heldDeploymentId: plan.provider.deploymentId,
        capturedAt,
        completedAt: now(),
        encryptedSha256: sha(retained),
        encryptedBytes: retained.length,
        plaintextSha256: sha(dump),
        readbackVerified: true,
        restoreVerified: true,
        quiescenceVerified: true,
        catalogHash: before.catalogHash,
        rowsetsHash: before.rowsetsHash,
        mediaHash: before.mediaHash,
        originalsHash: sha(originalsEncrypted),
        originalsVerified,
        reviewDue: originalsReviewDue,
        retention:
          "operator-only; owner review required, no automatic deletion",
        restore: restored,
        totalMs: now() - start,
        reopen: false,
      };
      await control.durableWrite(
        dir + "/receipt.json",
        JSON.stringify(receipt, null, 2) + "\n",
      );
      if (!fixtureOnly) {
        need(typeof releaseWindow === "function", "EXCLUSIVE_WINDOW_REQUIRED");
        await releaseWindow(approval, await observe());
      }
      await journal.append("backup_complete_hold", {
        backupHash: sha(retained),
        backupReceiptHash: hashJSON(receipt),
        hold: true,
      });
      return { receipt, path, journal: journal.path };
    } catch (e) {
      await journal.append(
        e.code === "FIXTURE_CLEANUP_FAILED"
          ? "cleanup_failed_hold"
          : "failed_hold",
        { code: safeCode(e), hold: true },
      );
      throw e;
    } finally {
      await client?.end().catch(() => {});
      await journal.close();
    }
  }
  return { captureQuiescentBackup, validateCustody };
}
export function liveBackupTarget(url, io) {
  assertOwnerTarget(url);
  const target = Object.freeze({
    kind: "production-readonly",
    connect: () => io.readClient(url),
    verify: verifyClient,
    dump: async (id) => {
      need(
        (
          await runProcess("docker", [
            "image",
            "inspect",
            IMAGE,
            "--format",
            "{{.Id}}",
          ])
        )
          .toString()
          .trim() === IMAGE,
        "TOOLCHAIN_DRIFT",
      );
      const { args, input } = dumpArguments(id, { url });
      return runProcess("docker", args, input);
    },
  });
  backupTargets.add(target);
  return target;
}
export const validateCustody = async (...args) =>
  (await import("./installation.mjs"))
    .loadInstallation()
    .then((i) => i.backup.validateCustody(...args));
