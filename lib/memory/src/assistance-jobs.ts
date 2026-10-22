import { tenant, type Knex } from "@lib/database";
import { InferenceError, type Providers } from "@lib/ai";
import { GroveError } from "@lib/shared/contracts";
import { assistancePreferences } from "@lib/shared/assistance";
import type { ModelProfiles } from "@lib/shared/models";
import {
  assistanceProfile,
  validAssistance,
  type AssistanceRow,
} from "./assistance-data.ts";
import { actionStep } from "./assistance-actions.ts";
import { filingStep } from "./assistance-filing.ts";
import { cleanupStep } from "./assistance-cleanup.ts";
import { digestStep } from "./notebook-digests.ts";
import { budgetedInference } from "./processing.ts";

export type AssistanceJob = {
  id: string;
  kind: "assistance";
  target: string;
  accountId: string;
  profile: string;
  leaseId: string;
  attempts: number;
};
export async function runAssistanceJob(
  db: Knex,
  providers: Providers,
  dailyLimit: number,
  job: AssistanceJob,
  resolveProfiles?: (trx: Knex.Transaction) => Promise<ModelProfiles>,
) {
  const owned = async <T>(
    run: (trx: Knex.Transaction, row: AssistanceRow) => Promise<T>,
  ) =>
    tenant(db, job.accountId, async (trx) => {
      await trx.raw("SELECT pg_advisory_xact_lock_shared(68142019)");
      const account = await trx("accounts")
        .where({ id: job.accountId, status: "active" })
        .forUpdate()
        .first();
      const lease = await trx("jobs")
        .where({ id: job.id, leaseId: job.leaseId })
        .where("leaseUntil", ">", trx.fn.now())
        .whereRaw(
          "epoch=(SELECT epoch FROM processing_control WHERE singleton)",
        )
        .forUpdate()
        .first();
      if (!lease) return;
      const row = await trx<AssistanceRow>("assistance_requests")
        .where({ id: job.target })
        .first();
      const profiles = await resolveProfiles?.(trx);
      if (
        !row ||
        row.status !== "pending" ||
        !account?.[assistancePreferences[row.kind]] ||
        !providers.generation ||
        (profiles &&
          (profiles.generation !== providers.generation.profile ||
            profiles.embedding !== (providers.embedding?.profile ?? null))) ||
        job.profile !==
          assistanceProfile(
            providers.generation.profile,
            providers.embedding?.profile,
          )
      ) {
        await trx("jobs").where({ id: job.id, leaseId: job.leaseId }).delete();
        if (row?.status === "pending")
          await trx("assistance_requests")
            .where({ id: row.id })
            .update({
              status: "stale",
              result: null,
              state: "{}",
              error: "Settings changed. Refresh the preview.",
            });
        return;
      }
      await validAssistance(trx, row);
      return run(trx, row);
    });
  const resume = async (trx: Knex.Transaction, row: AssistanceRow) => {
    const current = await trx("assistance_requests")
      .where({ id: row.id })
      .first();
    if (current.status !== "pending")
      await trx("jobs").where({ id: job.id }).delete();
    else
      await trx("jobs")
        .where({ id: job.id })
        .update({
          attempts: 0,
          leaseId: null,
          leaseUntil: null,
          dispatchId: null,
          dispatchUntil: null,
          dispatchedAt: null,
          dueAt: trx.fn.now(),
        });
  };
  try {
    const step = await owned(async (trx, row) => {
      const prepared =
        row.kind === "actions"
          ? await actionStep(trx, row)
          : row.kind === "filing"
            ? await filingStep(trx, row, providers, job.id)
            : row.kind === "cleanup"
              ? await cleanupStep(trx, row, providers)
              : await digestStep(trx, row);
      if (!prepared) await resume(trx, row);
      return prepared;
    });
    if (!step) return true;
    const generated = await budgetedInference(
      db,
      job.accountId,
      "generation",
      dailyLimit,
      (options) =>
        providers.generation!.generate(step.schema, step.prompt, step.sources, {
          ...options,
          context: step.context,
        }),
    );
    const next = step.finish(generated);
    await owned(async (trx, row) => {
      await trx("assistance_requests")
        .where({ id: row.id })
        .update({
          ...(next.state ? { state: JSON.stringify(next.state) } : {}),
          ...(next.result
            ? {
                result: JSON.stringify(next.result),
                status: "ready",
                version: row.version + 1,
                error: null,
              }
            : {}),
          updatedAt: trx.fn.now(),
        });
      await resume(trx, row);
    });
  } catch (error) {
    await tenant(db, job.accountId, async (trx) => {
      await trx("accounts").where({ id: job.accountId }).forUpdate().first();
      const lease = await trx("jobs")
        .where({ id: job.id, leaseId: job.leaseId })
        .first();
      if (!lease) return;
      const stale =
        error instanceof GroveError && error.code === "sources_changed";
      const budget =
        error instanceof InferenceError && error.code === "inference_budget";
      const failed =
        stale ||
        (!budget &&
          (job.attempts >= 5 ||
            (error instanceof InferenceError && !error.retryable)));
      if (failed) {
        await trx("assistance_requests")
          .where({ id: job.target, status: "pending" })
          .update({
            status: stale ? "stale" : "failed",
            result: null,
            state: "{}",
            error: stale
              ? "These notes changed. Refresh the preview."
              : "Couldn’t create this preview. Try again.",
          });
        await trx("jobs").where({ id: job.id, leaseId: job.leaseId }).delete();
      } else
        await trx("jobs")
          .where({ id: job.id, leaseId: job.leaseId })
          .update({
            leaseId: null,
            leaseUntil: null,
            dispatchId: null,
            dispatchUntil: null,
            dispatchedAt: null,
            attempts: budget ? Math.max(0, job.attempts - 1) : job.attempts,
            errorCode:
              error instanceof InferenceError
                ? error.code
                : "assistance_unavailable",
            dueAt: budget
              ? trx.raw("date_trunc('day',now())+interval '1 day'")
              : trx.raw("now()+(?*interval '1 second')", [
                  Math.min(3600, 2 ** job.attempts * 10),
                ]),
          });
    });
  }
  return true;
}
