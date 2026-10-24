import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase, type Knex } from "@lib/database";
import {
  preferenceKeys,
  preferencesFor,
  legacyPreferences,
} from "../../lib/shared/src/preferences.ts";

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
      ...preferenceKeys,
      "readAloudVoiceId",
      "organizeEnabled",
      "summariesEnabled",
      "askVersion",
      "askTools",
      "contentVersion",
      "changeToken",
    );
    const subjects = await source("subject_authority").select("*");
    const researchBudget = await source("research_global_usage").select("*");
    const researchUsage = await source("research_account_usage").select("*");
    const conversationTools = await source("conversations")
      .whereNull("deletedAt")
      .select("id", "accountId", "tools", "toolsVersion");
    const sessions = await source("session_revocations").select("*");
    const assistanceReviews = await source("assistance_reviews").select("*");
    const assistanceOperations = await source("assistance_requests")
      .whereRaw("jsonb_array_length(applied)>0")
      .select(
        "accountId",
        "id",
        "kind",
        "input",
        "fingerprint",
        "profile",
        "version",
        "dependencies",
        "scopes",
        "applied",
        "application",
        "createdAt",
        "updatedAt",
      );
    const deleted = await source("deleted_memories").select("*");
    const deletedConversations = await source("deleted_conversations").select(
      "*",
    );
    const tombstones = new Map<
      string,
      { id: string; accountId: string; deletedAt: Date }[]
    >();
    for (const table of ["projects", "connections"])
      tombstones.set(
        table,
        await source(table)
          .whereNotNull("deletedAt")
          .select("id", "accountId", "deletedAt"),
      );
    const reviews = new Map<
      string,
      {
        accountId: string;
        leftId: string;
        rightId: string;
        leftVersion: number;
        rightVersion: number;
        revision: string;
        dismissedRevision: string | null;
        reviewVersion: number;
      }[]
    >();
    for (const table of ["memory_relationships", "notebook_relationships"])
      reviews.set(
        table,
        await source(table)
          .where("reviewVersion", ">", 0)
          .select(
            "accountId",
            "leftId",
            "rightId",
            "leftVersion",
            "rightVersion",
            "revision",
            "dismissedRevision",
            "reviewVersion",
          ),
      );
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
      // A restored live link may have been revoked or narrowed after the backup.
      const invalidatedShares = await target("public_shares").update({
        revokedAt: target.fn.now(),
        tokenDigest: null,
        tokenCiphertext: null,
        version: target.raw("version + 1"),
      });
      await target("public_share_operations").delete();
      await target("public_share_rates").delete();
      await target("memory_operations").delete();
      // Restored in-flight uploads must never publish using an old lease. Ready
      // originals/bindings stay immutable; access still follows replayed tombstones.
      await target("media_objects")
        .where({ status: "pending" })
        .update({ status: "failed", leaseUntil: target.fn.now() });
      await target("memory_enrichments").delete();
      await target("memory_briefs").delete();
      await target("notebook_profiles").delete();
      await target("notebook_summary_nodes").delete();
      await target("notebook_summary_work").delete();
      // Historical windows cannot describe a restored, older source snapshot.
      await target("notebook_visits").delete();
      await target("notebook_checkpoints").delete();
      await target("assistance_requests").update({
        status: "stale",
        version: target.raw("version+1"),
        result: null,
        state: "{}",
        undo: null,
        error: "Recovery interrupted this preview. Refresh it.",
      });
      await target("assistance_reviews").delete();
      const presentAccounts = new Set(existing.map((row) => row.id));
      for (const row of assistanceReviews)
        if (presentAccounts.has(row.accountId))
          await target("assistance_reviews").insert({
            ...row,
            version: row.version + 1,
          });
      for (const row of assistanceOperations)
        if (presentAccounts.has(row.accountId)) {
          const operation = {
            ...row,
            version: row.version + 1,
            status: "stale",
            result: null,
            state: "{}",
            undo: null,
            input: JSON.stringify(row.input),
            dependencies: JSON.stringify(row.dependencies),
            scopes: JSON.stringify(row.scopes),
            applied: JSON.stringify(row.applied),
            error:
              "Recovery interrupted this operation. Review the current notes.",
          };
          await target("assistance_requests")
            .insert(operation)
            .onConflict(["accountId", "id"])
            .merge(operation);
        }
      // Rebuild explanations, but use current authoritative review decisions.
      const emptyAssessment = JSON.stringify({
        relationship: "unrelated",
        reason: "",
        basis: "none",
        direction: "both",
        evidence: [],
        coverage: {
          from: { total: 0, examined: 0, supporting: 0 },
          to: { total: 0, examined: 0, supporting: 0 },
        },
        breadth: "thread",
      });
      for (const [table, rows] of reviews) {
        await target(table).update({
          profile: "recovery-pending",
          assessment: emptyAssessment,
          dismissedRevision: null,
          reviewVersion: target.raw("review_version + 1"),
        });
        const endpoint =
          table === "memory_relationships" ? "memories" : "projects";
        for (const row of rows) {
          if (
            (
              await target(endpoint)
                .where({ accountId: row.accountId })
                .whereIn("id", [row.leftId, row.rightId])
            ).length !== 2
          )
            continue;
          await target(table)
            .insert({
              ...row,
              reviewVersion: row.reviewVersion + 1,
              profile: "recovery-pending",
              assessment: emptyAssessment,
            })
            .onConflict(["accountId", "leftId", "rightId"])
            .merge({
              ...row,
              reviewVersion: row.reviewVersion + 1,
              profile: "recovery-pending",
              assessment: emptyAssessment,
            });
        }
      }
      await target("jobs").delete();
      // Recovered leases and artifact references cannot authorize old work.
      await target("processing_control").increment("epoch", 1);
      await target("background_tasks")
        .whereIn("status", ["pending", "running"])
        .update({
          status: "cancelled",
          errorCode: "recovery_interrupted",
          leaseId: null,
          leaseUntil: null,
          dispatchId: null,
          dispatchUntil: null,
          dispatchedAt: null,
          finishedAt: target.fn.now(),
          updatedAt: target.fn.now(),
        });
      await target("background_tasks")
        .whereIn("kind", ["export", "speech_transcribe", "speech_synthesize"])
        .update({ result: null, expiresAt: target.fn.now() });
      await target("export_objects").update({ expiresAt: target.fn.now() });
      // Maintenance is safe to replay from its first bounded page. A cancelled
      // lifecycle task would otherwise prevent the scheduler's dedupe upsert.
      await target("background_tasks")
        .whereIn("kind", [
          "account_cleanup",
          "retention_cleanup",
          "artifact_cleanup",
        ])
        .update({
          status: "pending",
          cursor: "{}",
          processed: 0,
          failures: 0,
          errorCode: null,
          dueAt: target.fn.now(),
          finishedAt: null,
        });
      // Recovery must not replay old account emails or notifications from grant invalidation.
      await target("transactional_emails").delete();
      let softDeletedMemories = 0;
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
            ...preferencesFor(current),
            readAloudVoiceId: current.readAloudVoiceId,
            ...legacyPreferences(preferencesFor(current)),
            askVersion: current.askVersion + 1,
            askTools: JSON.stringify(current.askTools),
            contentVersion: Math.max(current.contentVersion, 1) + 1,
            changeToken: target.raw("greatest(change_token,?::bigint)+1", [
              current.changeToken,
            ]),
            organizationDueAt: target.fn.now(),
          });
        if (gone) {
          await target("conversations").where({ accountId: row.id }).delete();
          await target("inference_usage").where({ accountId: row.id }).delete();
          softDeletedMemories += await target("memories")
            .where({ accountId: row.id })
            .whereNull("deletedAt")
            .update({ deletedAt: target.fn.now(), status: "archived" });
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
        softDeletedMemories += await target("memories")
          .where({ accountId: row.accountId, id: row.id })
          .whereNull("deletedAt")
          .update({ deletedAt: row.deletedAt, status: "archived" });
      }
      for (const [table, rows] of tombstones)
        for (const row of rows)
          if (restoredIds.has(row.accountId))
            await target(table)
              .where({ accountId: row.accountId, id: row.id })
              .whereNull("deletedAt")
              .update({ deletedAt: row.deletedAt });
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
      for (const row of deletedConversations) {
        if (!restoredIds.has(row.accountId)) continue;
        await target("deleted_conversations")
          .insert(row)
          .onConflict(["accountId", "id"])
          .ignore();
        await target("conversations")
          .where({ accountId: row.accountId, id: row.id })
          .delete();
      }
      // Old proposals and in-flight replies cannot be replayed into restored data.
      for (const row of researchBudget)
        await target("research_global_usage")
          .insert(row)
          .onConflict("month")
          .merge({
            microdollars: target.raw(
              "greatest(research_global_usage.microdollars,excluded.microdollars)",
            ),
          });
      for (const row of researchUsage)
        if (restoredIds.has(row.accountId))
          await target("research_account_usage")
            .insert(row)
            .onConflict(["accountId", "day"])
            .merge({
              calls: target.raw(
                "greatest(research_account_usage.calls,excluded.calls)",
              ),
            });
      for (const row of conversationTools)
        await target("conversations")
          .where({ id: row.id, accountId: row.accountId })
          .whereNull("deletedAt")
          .update({
            tools: JSON.stringify(row.tools),
            toolsVersion: target.raw("greatest(tools_version,?)+1", [
              row.toolsVersion,
            ]),
          });
      await target("conversation_turns").where({ status: "pending" }).update({
        status: "failed",
        error: "Reply interrupted. Please try again.",
        leaseId: null,
        leaseUntil: null,
      });
      await target.raw(
        `UPDATE conversation_turns SET result = jsonb_set(result, '{proposal,status}', '"unavailable"'), undo = NULL WHERE result->'proposal' IS NOT NULL AND result->'proposal' <> 'null'::jsonb`,
      );
      await target.raw(
        `UPDATE conversation_turns SET result=jsonb_set(result,'{organization,status}','"unavailable"'),undo=NULL WHERE result->'organization' IS NOT NULL AND result->'organization'<>'null'::jsonb`,
      );
      await target("conversation_turns").update({ toolRuns: "[]" });
      await target("jobs").update({ leaseId: null, leaseUntil: null });
      return {
        restoredAccounts: existing.length,
        blockedAccounts,
        softDeletedMemories,
        invalidatedConnections,
        invalidatedShares,
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
