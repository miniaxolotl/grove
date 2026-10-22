import { randomUUID } from "node:crypto";
import type { Knex } from "@lib/database";
import { rememberSchema } from "@lib/shared/contracts";
import {
  importRecordSchema,
  importRequestSchema,
  type ImportRequest,
} from "@lib/shared/jobs";
import { type MemoryService, sessionPrincipal } from "./index.ts";
import { fingerprint } from "./tasks.ts";
import { TaskError, taskTransaction, type TaskHandler } from "./task-runner.ts";

type ImportedRecord = ImportRequest["records"][number];
export interface ConnectorAdapter {
  /** Credentials are resolved by the adapter; they never enter broker messages. */
  page(input: {
    accountId: string;
    cursor: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<{
    records: ImportedRecord[];
    cursor: Record<string, unknown>;
    complete: boolean;
    retryAfterSeconds?: number;
  }>;
}
const operationId = (value: unknown) => {
  const hash = fingerprint(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
export async function enqueueConnectorSync(
  trx: Knex.Transaction,
  accountId: string,
  source: string,
) {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(source))
    throw new TaskError("connector_invalid", false);
  const checkpoint = await trx("connector_checkpoints")
    .where({ source })
    .first();
  const [row] = await trx("background_tasks")
    .insert({
      id: randomUUID(),
      accountId,
      kind: "connector_sync",
      dedupeKey: source,
      payload: JSON.stringify({ source }),
      cursor: JSON.stringify(checkpoint?.cursor ?? {}),
    })
    .onConflict(["accountId", "kind", "dedupeKey"])
    .merge({
      status: "pending",
      failures: 0,
      errorCode: null,
      cursor: JSON.stringify(checkpoint?.cursor ?? {}),
      processed: 0,
      dueAt: trx.fn.now(),
      finishedAt: null,
      updatedAt: trx.fn.now(),
      leaseId: null,
      leaseUntil: null,
      dispatchId: null,
      dispatchUntil: null,
      dispatchedAt: null,
    })
    .whereNotIn("background_tasks.status", ["pending", "running"])
    .returning("id");
  return row?.id as string | undefined;
}
export function importHandlers(
  service: MemoryService,
  connectors: ReadonlyMap<string, ConnectorAdapter> = new Map(),
): { import: TaskHandler; connector_sync: TaskHandler } {
  const apply = async (
    trx: Knex.Transaction,
    accountId: string,
    source: string,
    records: ImportedRecord[],
  ) => {
    const account = await trx("accounts")
      .where({ id: accountId, status: "active" })
      .first();
    if (!account) throw new TaskError("account_unavailable", false);
    const scoped = service.inTransaction(trx);
    const principal = sessionPrincipal(accountId, account.clerkSubject);
    for (const value of records) {
      const record = importRecordSchema.parse(value);
      const hash = fingerprint(record);
      const old = await trx("import_sources")
        .where({ source, externalId: record.sourceId })
        .first();
      if (old?.fingerprint === hash) continue;
      if (old) {
        const current = await trx("memories")
          .where({ id: old.memoryId })
          .first();
        if (!current) continue; // A remote update cannot revive a locally deleted source.
        if (current.version !== old.version)
          throw new TaskError("import_conflict", false);
      }
      const note = await scoped.remember(
        principal,
        rememberSchema.parse({
          operationId: operationId([
            accountId,
            source,
            record.sourceId,
            old?.version ?? 0,
            hash,
          ]),
          ...(old ? { id: old.memoryId, expectedVersion: old.version } : {}),
          content: record.content,
          projectId: record.projectId,
          source: { agent: "import" },
        }),
      );
      await trx("import_sources")
        .insert({
          accountId,
          source,
          externalId: record.sourceId,
          memoryId: note.id,
          version: note.version,
          fingerprint: hash,
        })
        .onConflict(["accountId", "source", "externalId"])
        .merge(["memoryId", "version", "fingerprint"]);
    }
  };
  const importTask: TaskHandler = async (task, signal) => {
    const request = importRequestSchema.parse({
      id: task.payload.id,
      source: task.payload.source,
      records: task.payload.records,
    });
    const offset = Number(task.cursor.offset ?? 0),
      records = request.records.slice(offset, offset + 10);
    await taskTransaction(service.db, task, async (trx) => {
      signal.throwIfAborted();
      await apply(trx, task.accountId!, request.source, records);
      return {
        cursor: { offset: offset + records.length },
        processed: offset + records.length,
        complete: offset + records.length >= request.records.length,
      };
    });
  };
  const connector_sync: TaskHandler = async (task, signal) => {
    const source = String(task.payload.source),
      adapter = connectors.get(source);
    if (!adapter) throw new TaskError("connector_unavailable", false);
    const result = await adapter.page({
      accountId: task.accountId!,
      cursor: task.cursor,
      signal,
    });
    if (
      result.records.length > 100 ||
      JSON.stringify(result.cursor).length > 16000
    )
      throw new TaskError("connector_page_too_large", false);
    if (
      !result.complete &&
      fingerprint(result.cursor) === fingerprint(task.cursor)
    )
      throw new TaskError("connector_stalled", false);
    await taskTransaction(service.db, task, async (trx) => {
      signal.throwIfAborted();
      await apply(trx, task.accountId!, source, result.records);
      await trx("connector_checkpoints")
        .insert({
          accountId: task.accountId,
          source,
          cursor: JSON.stringify(result.cursor),
        })
        .onConflict(["accountId", "source"])
        .merge(["cursor"]);
      return {
        cursor: result.cursor,
        processed: Number(task.processed) + result.records.length,
        complete: result.complete,
        delay: result.retryAfterSeconds ?? 0,
      };
    });
  };
  return { import: importTask, connector_sync };
}
