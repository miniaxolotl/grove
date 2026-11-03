import { tenant, type Knex } from "@lib/database";
import { TaskError, taskTransaction, type TaskHandler } from "./task-runner.ts";
import { expireDocumentDrafts } from "./document-imports.ts";
import { expireConversationDocuments } from "./conversation-documents.ts";

const batchSize = 100;
async function pruneCache(trx: Knex.Transaction, expiredOnly: boolean) {
  const rows: { feature: string; key: string }[] = await trx("ai_cache")
    .modify((q) => {
      if (expiredOnly) q.where("expiresAt", "<=", trx.fn.now());
    })
    .select("feature", "key")
    .orderBy("createdAt")
    .limit(batchSize);
  if (rows.length)
    await trx("ai_cache")
      .whereIn(
        ["feature", "key"],
        rows.map((row) => [row.feature, row.key]),
      )
      .delete();
  const backoffs: { profile: string }[] = await trx("ai_provider_backoff")
    .modify((q) => {
      if (expiredOnly)
        q.where("retryAt", "<", trx.raw("now()-interval '1 day'"));
    })
    .select("profile")
    .limit(batchSize);
  if (backoffs.length)
    await trx("ai_provider_backoff")
      .whereIn(
        "profile",
        backoffs.map((row) => row.profile),
      )
      .delete();
  return Math.max(rows.length, backoffs.length);
}
export async function scheduleCleanup(db: Knex) {
  return (await db.raw("SELECT grove_schedule_cleanup() AS scheduled")).rows[0]
    .scheduled as number;
}
export function cleanupHandlers(
  db: Knex,
  deleteIdentity: (subject: string) => Promise<void>,
  cancelBilling?: (accountId: string) => Promise<void>,
) {
  const account_cleanup: TaskHandler = async (task, signal) => {
    const tables = [
      "jobs",
      "memories",
      "conversations",
      "projects",
      "connections",
      "public_shares",
      "public_share_operations",
      "api_keys",
      "memory_operations",
      "memory_briefs",
      "transactional_emails",
      "inference_usage",
      "rate_buckets",
      "assistance_requests",
      "assistance_reviews",
      "notebook_changes",
      "notebook_visits",
      "notebook_checkpoints",
      "notebook_expiries",
    ] as const;
    const stage = Number(task.cursor.stage ?? 0);
    const table = tables[stage];
    if (table) {
      await taskTransaction(db, task, async (trx) => {
        signal.throwIfAborted();
        // ctid is used only within this transaction; some scratch tables have
        // composite keys. Authored tables intercept DELETE with tombstones.
        const rows = await trx(table)
          .select(trx.raw("ctid::text AS row_id"))
          .limit(batchSize);
        if (rows.length)
          await trx(table)
            .whereRaw("ctid=ANY(?::tid[])", [rows.map((row) => row.rowId)])
            .delete();
        // Extend the existing usage stage without shifting durable task cursors.
        const research =
          table === "inference_usage"
            ? await trx("research_account_usage").select("day").limit(batchSize)
            : [];
        if (research.length)
          await trx("research_account_usage")
            .whereIn(
              "day",
              research.map((row) => row.day),
            )
            .delete();
        // Extend an existing checkpoint stage rather than renumbering retained tasks.
        const cache =
          table === "memory_briefs" ? await pruneCache(trx, false) : 0;
        return {
          cursor: {
            stage:
              rows.length === batchSize ||
              research.length === batchSize ||
              cache === batchSize
                ? stage
                : stage + 1,
          },
          processed:
            Number(task.processed) + rows.length + research.length + cache,
        };
      });
      return;
    }
    const account = await tenant(db, task.accountId!, (trx) =>
      trx("accounts").where({ id: task.accountId }).first(),
    );
    if (!account || !["deleting", "deleted"].includes(account.status))
      throw new TaskError("account_unavailable", false);
    // Also runs when Clerk deletion initiated cleanup. Failures retain the task
    // for retry instead of silently leaving future subscription renewals enabled.
    await cancelBilling?.(task.accountId!);
    if (!account.providerDeletedAt) {
      signal.throwIfAborted();
      try {
        await deleteIdentity(account.clerkSubject);
      } catch {
        throw new TaskError("identity_unavailable");
      }
    }
    await taskTransaction(db, task, async (trx) => {
      signal.throwIfAborted();
      await trx("accounts")
        .where({ id: task.accountId })
        .update({ status: "deleted", providerDeletedAt: trx.fn.now() });
      return { complete: true };
    });
  };
  const retention_cleanup: TaskHandler = async (task, signal) => {
    await taskTransaction(db, task, async (trx) => {
      signal.throwIfAborted();
      await expireDocumentDrafts(trx);
      await expireConversationDocuments(trx);
      const expired = await trx("memories")
        .where("purgeAt", "<=", trx.fn.now())
        .select("id")
        .orderBy("id")
        .limit(batchSize);
      if (expired.length) {
        await trx("memories")
          .whereIn(
            "id",
            expired.map((row) => row.id),
          )
          .delete();
        await trx("accounts")
          .where({ id: task.accountId })
          .increment("contentVersion", 1);
        await trx("memory_briefs").delete();
      }
      const buckets = await trx("rate_buckets")
        .where("minute", "<", trx.raw("now()-interval '1 day'"))
        .orderBy("minute")
        .limit(batchSize)
        .pluck("minute");
      if (buckets.length)
        await trx("rate_buckets").whereIn("minute", buckets).delete();
      const cache = await pruneCache(trx, true);
      return {
        processed: Number(task.processed) + expired.length + cache,
        complete:
          expired.length < batchSize &&
          buckets.length < batchSize &&
          cache < batchSize,
      };
    });
  };
  return { account_cleanup, retention_cleanup };
}
