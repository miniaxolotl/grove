import { setTimeout } from "node:timers/promises";
import { camelRows, tenant, type Knex } from "@lib/database";
import type { QueueLane, TaskKind } from "@lib/shared/jobs";

export interface ClaimedTask {
  id: string;
  accountId: string | null;
  kind: TaskKind;
  payload: Record<string, unknown>;
  cursor: Record<string, unknown>;
  result: Record<string, unknown> | null;
  processed: string | number;
  total: string | number | null;
  failures: number;
  leaseId: string;
  createdAt: Date;
}
export interface TaskCheckpoint {
  cursor?: Record<string, unknown>;
  processed?: number;
  result?: Record<string, unknown> | null;
  complete?: boolean;
  delay?: number;
}
export type TaskHandler = (
  task: ClaimedTask,
  signal: AbortSignal,
) => Promise<TaskCheckpoint | void>;
export class TaskError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = true,
  ) {
    super(code);
  }
}
export const retryDelay = (failures: number, random = Math.random()) =>
  Math.ceil(
    Math.min(3600, 10 * 2 ** Math.min(failures, 8)) * (0.75 + random * 0.5),
  );

/** One bounded checkpoint per claim. Business handlers must fence their writes
 * against the lease inside the same transaction as the checkpoint. */
export async function checkpointTask(
  db: Knex,
  task: ClaimedTask,
  next: TaskCheckpoint,
) {
  const { rows } = await db.raw(
    "SELECT grove_task_checkpoint(?::uuid,?::uuid,?::jsonb,?::bigint,?::jsonb,?,?) AS saved",
    [
      task.id,
      task.leaseId,
      JSON.stringify(next.cursor ?? task.cursor),
      next.processed ?? Number(task.processed),
      JSON.stringify(next.result ?? task.result),
      next.complete ?? false,
      next.delay ?? 0,
    ],
  );
  return rows[0].saved as boolean;
}

/** Acquire account then task, matching API cancellation and lifecycle writes. */
export async function taskTransaction(
  db: Knex,
  task: ClaimedTask,
  run: (trx: Knex.Transaction) => Promise<TaskCheckpoint>,
) {
  if (!task.accountId) throw new TaskError("task_account_required", false);
  await tenant(db, task.accountId, async (trx) => {
    await trx.raw("SELECT pg_advisory_xact_lock_shared(68142019)");
    await trx("accounts").where({ id: task.accountId }).forUpdate().first();
    const owned = await trx("background_tasks")
      .where({ id: task.id, leaseId: task.leaseId, status: "running" })
      .where("leaseUntil", ">", trx.fn.now())
      .forUpdate()
      .first();
    if (!owned) throw new TaskError("task_superseded", false);
    const next = await run(trx);
    if (!(await checkpointTask(trx, task, next)))
      throw new TaskError("task_superseded", false);
  });
}

export async function runTask(
  db: Knex,
  handlers: Partial<Record<TaskKind, TaskHandler>>,
  options: {
    id?: string;
    lane?: QueueLane;
    accountLimit?: number;
    signal?: AbortSignal;
    heartbeatMs?: number;
  } = {},
): Promise<boolean> {
  const task = camelRows<ClaimedTask>(
    await db.raw("SELECT * FROM grove_claim_task(?::uuid,?,?)", [
      options.id ?? null,
      options.lane ?? null,
      options.accountLimit ?? 1,
    ]),
  )[0];
  if (!task) return false;
  const heartbeatStop = new AbortController();
  const lost = new AbortController();
  const signal = AbortSignal.any([
    lost.signal,
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(15 * 60 * 1000),
  ]);
  const heartbeat = (async () => {
    try {
      while (!heartbeatStop.signal.aborted) {
        await setTimeout(options.heartbeatMs ?? 30000, undefined, {
          signal: heartbeatStop.signal,
        });
        const { rows } = await db.raw(
          "SELECT grove_task_heartbeat(?::uuid,?::uuid) AS owned",
          [task.id, task.leaseId],
        );
        if (!rows[0].owned) {
          lost.abort();
          return;
        }
      }
    } catch {
      if (!heartbeatStop.signal.aborted) lost.abort();
    }
  })();
  try {
    signal.throwIfAborted();
    const handler = handlers[task.kind];
    if (!handler) throw new TaskError("handler_unavailable", false);
    const next = await handler(task, signal);
    signal.throwIfAborted();
    if (next) await checkpointTask(db, task, next);
  } catch (error) {
    await db.raw("SELECT grove_task_failure(?::uuid,?::uuid,?,?,?)", [
      task.id,
      task.leaseId,
      error instanceof TaskError
        ? error.code
        : signal.aborted
          ? "task_interrupted"
          : "task_unavailable",
      !(error instanceof TaskError) || error.retryable,
      retryDelay(task.failures),
    ]);
  } finally {
    heartbeatStop.abort();
    await heartbeat;
  }
  return true;
}
