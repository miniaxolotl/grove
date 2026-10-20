import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase, type Knex } from "@lib/database";

/** Read current authority without copying memory content into the recovery log. */
export async function reconcileRestore(authority: Knex, restored: Knex) {
  return authority.transaction(async (source) => {
    await source.raw(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    await source.raw("SET LOCAL row_security = off");
    const accounts = await source("accounts").select(
      "id",
      "clerkSubject",
      "status",
      "deletedAt",
      "providerDeletedAt",
      "captureEnabled",
      "recallEnabled",
      "organizeEnabled",
      "summariesEnabled",
      "contentVersion",
    );
    const subjects = await source("subject_authority").select("*");
    const sessions = await source("session_revocations").select("*");
    const deleted = await source("deleted_memories").select("*");
    const migrations = await source("knex_migrations")
      .orderBy("id")
      .pluck("name");
    const byId = new Map(accounts.map((row) => [row.id, row]));
    const bySubject = new Map(subjects.map((row) => [row.subject, row]));

    return restored.transaction(async (target) => {
      await target.raw("SET LOCAL row_security = off");
      const { rows } = await target.raw("SELECT current_database() AS name");
      assert(
        /_(restore|test)$/.test(rows[0].name),
        "Recovery target must be an isolated database ending in _restore or _test",
      );
      assert.deepEqual(
        await target("knex_migrations").orderBy("id").pluck("name"),
        migrations,
        "Apply the same forward migrations to the isolated restore first",
      );
      const existing = await target("accounts").select("id", "clerkSubject");
      for (const row of existing) {
        assert.equal(
          byId.get(row.id)?.clerkSubject,
          row.clerkSubject,
          "Restored account is absent from the current authority; keep recovery offline",
        );
      }
      // All restored credentials require reauthorization, including grants that
      // were reduced (rather than revoked) after the backup was taken.
      const invalidatedConnections = await target("connections").update({
        revokedAt: target.fn.now(),
        authorizedAfter: target.fn.now(),
        capabilities: [],
        personal: false,
        allProjects: false,
        projectIds: [],
      });
      await target("api_keys").delete();
      await target("memory_operations").delete();
      await target("memory_enrichments").delete();
      await target("memory_briefs").delete();
      await target("jobs").delete();
      // Recovery must not replay old account emails or notifications from grant invalidation.
      await target("transactional_emails").delete();
      let purgedMemories = 0;
      let blockedAccounts = 0;
      const restoredIds = new Set(existing.map((row) => row.id));
      for (const row of existing) {
        const current = byId.get(row.id)!;
        const subject = bySubject.get(current.clerkSubject);
        const gone =
          subject?.deleted || ["deleting", "deleted"].includes(current.status);
        const status = gone
          ? subject?.deleted || current.providerDeletedAt
            ? "deleted"
            : "deleting"
          : subject?.disabled
            ? "disabled"
            : current.status;
        if (status !== "active") blockedAccounts++;
        await target("accounts")
          .where({ id: row.id })
          .update({
            status,
            deletedAt: gone
              ? (current.deletedAt ?? target.fn.now())
              : current.deletedAt,
            providerDeletedAt: subject?.deleted
              ? (current.providerDeletedAt ?? target.fn.now())
              : current.providerDeletedAt,
            captureEnabled: current.captureEnabled,
            recallEnabled: current.recallEnabled,
            organizeEnabled: current.organizeEnabled,
            summariesEnabled: current.summariesEnabled,
            contentVersion: Math.max(current.contentVersion, 1) + 1,
          });
        if (gone) {
          await target("inference_usage").where({ accountId: row.id }).delete();
          purgedMemories += await target("memories")
            .where({ accountId: row.id })
            .delete();
          await target("connections").where({ accountId: row.id }).delete();
          await target("projects").where({ accountId: row.id }).delete();
          await target("rate_buckets").where({ accountId: row.id }).delete();
        }
      }
      for (const row of deleted) {
        if (!restoredIds.has(row.accountId)) continue;
        await target("deleted_memories")
          .insert(row)
          .onConflict(["accountId", "id"])
          .ignore();
        purgedMemories += await target("memories")
          .where({ accountId: row.accountId, id: row.id })
          .delete();
      }
      for (const row of subjects) {
        // A deletion tombstone is permanent, even if another event is newer.
        await target.raw(
          `
          INSERT INTO subject_authority(subject, event_at, deleted, disabled) VALUES (?, ?, ?, ?)
          ON CONFLICT (subject) DO UPDATE SET
            event_at = greatest(subject_authority.event_at, excluded.event_at),
            deleted = subject_authority.deleted OR excluded.deleted,
            disabled = CASE WHEN excluded.event_at >= subject_authority.event_at
              THEN excluded.disabled ELSE subject_authority.disabled END
        `,
          [row.subject, row.eventAt, row.deleted, row.disabled],
        );
      }
      for (const row of sessions)
        await target("session_revocations")
          .insert(row)
          .onConflict("id")
          .ignore();
      await target("jobs").update({ leaseId: null, leaseUntil: null });
      return {
        restoredAccounts: existing.length,
        blockedAccounts,
        purgedMemories,
        invalidatedConnections,
        authoritySubjects: subjects.length,
        sessionRevocations: sessions.length,
      };
    });
  });
}

async function main() {
  const source = process.env.RECOVERY_AUTHORITY_DATABASE_URL;
  const target = process.env.RECOVERY_TARGET_DATABASE_URL;
  assert(
    source && target,
    "Set RECOVERY_AUTHORITY_DATABASE_URL and RECOVERY_TARGET_DATABASE_URL",
  );
  const sourceUrl = new URL(source);
  const targetUrl = new URL(target);
  assert(
    `${sourceUrl.host}${sourceUrl.pathname}` !==
      `${targetUrl.host}${targetUrl.pathname}`,
    "Authority and recovery target must be different databases",
  );
  const connect = (url: URL) => {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    assert(
      local || url.searchParams.get("sslmode") === "verify-full",
      "Remote recovery connections require verify-full TLS",
    );
    return createDatabase(url.href, { ssl: !local, max: 1 });
  };
  const authority = connect(sourceUrl);
  const restored = connect(targetUrl);
  try {
    console.log(
      JSON.stringify({
        status: "reconciled",
        ...(await reconcileRestore(authority, restored)),
      }),
    );
  } finally {
    await Promise.all([authority.destroy(), restored.destroy()]);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error(
      "Recovery reconciliation failed; keep the restored database offline. Verify target isolation, matching migrations, authority completeness and owner permissions.",
    );
    process.exitCode = 1;
  });
}
