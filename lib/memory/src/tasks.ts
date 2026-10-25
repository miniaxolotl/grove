import { createHash } from "node:crypto";
import { GroveError, type Principal } from "@lib/shared/contracts";
import type {
  Task,
  TaskKind,
  ExportRequest,
  ImportRequest,
} from "@lib/shared/jobs";
import type { MemoryService } from "./index.ts";

type TaskRow = {
  id: string;
  kind: TaskKind;
  status: Task["status"];
  payload: Record<string, unknown>;
  processed: string | number;
  total: string | number | null;
  attempts: number;
  errorCode: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  expiresAt: Date | string | null;
  result: { key?: string; bytes?: number } | null;
};

export const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class Tasks {
  constructor(
    private service: MemoryService,
    readonly exportsEnabled: boolean,
  ) {}
  async export(principal: Principal, request: ExportRequest) {
    if (!this.exportsEnabled)
      throw new GroveError(
        "exports_unavailable",
        "Export storage is not configured",
        503,
      );
    return this.enqueue(
      principal,
      "export",
      request.id,
      request,
      async (trx, account) => {
        if (request.projectId) {
          if (
            !(await trx("projects")
              .where({ id: request.projectId })
              .first("id"))
          )
            throw new GroveError("not_found", "Notebook not found", 404);
        }
        const active = await trx("background_tasks")
          .where({ kind: "export" })
          .whereIn("status", ["pending", "running"])
          .first("id");
        if (active)
          throw new GroveError(
            "export_busy",
            "An export is already running",
            409,
          );
        return {
          ...request,
          exportVersion: String(account.exportVersion),
        };
      },
    );
  }
  async import(principal: Principal, request: ImportRequest) {
    if (
      new Set(request.records.map((r) => r.sourceId)).size !==
      request.records.length
    )
      throw new GroveError("invalid_request", "Source IDs must be unique");
    return this.enqueue(
      principal,
      "import",
      request.id,
      request,
      async (trx) => {
        const ids = [
          ...new Set(
            request.records.flatMap((r) => (r.projectId ? [r.projectId] : [])),
          ),
        ];
        if ((await trx("projects").whereIn("id", ids)).length !== ids.length)
          throw new GroveError("not_found", "Notebook not found", 404);
        return request;
      },
    );
  }
  private async enqueue(
    principal: Principal,
    kind: TaskKind,
    id: string,
    input: unknown,
    payload: (
      trx: import("@lib/database").Knex.Transaction,
      account: { exportVersion?: string | number },
    ) => Promise<object>,
  ) {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const hash = fingerprint(input);
      const old = await trx("background_tasks").where({ id }).first();
      if (old) {
        if (old.kind !== kind || old.payload.fingerprint !== hash)
          throw new GroveError(
            "operation_conflict",
            "This request ID was already used",
            409,
          );
        return this.present(old, String(account.exportVersion));
      }
      const pending = await trx("background_tasks")
        .whereIn("status", ["pending", "running"])
        .whereIn("kind", [
          "export",
          "import",
          "connector_sync",
          "document_prepare",
          "document_import",
        ])
        .count("id as total")
        .first();
      if (Number(pending?.total) >= 20)
        throw new GroveError(
          "queue_full",
          "Wait for existing jobs to finish",
          429,
        );
      const [row] = await trx("background_tasks")
        .insert({
          id,
          accountId: account.id,
          kind,
          dedupeKey: id,
          payload: JSON.stringify({
            ...(await payload(trx, account)),
            fingerprint: hash,
          }),
          ...(kind === "import"
            ? { total: (input as ImportRequest).records.length }
            : {}),
          ...(kind === "export"
            ? { expiresAt: trx.raw("now()+interval '1 day'") }
            : {}),
        })
        .onConflict("id")
        .ignore()
        .returning("*");
      if (!row)
        throw new GroveError(
          "operation_conflict",
          "This request ID was already used",
          409,
        );
      return this.present(row, String(account.exportVersion));
    });
  }
  async list(principal: Principal, projectId?: string) {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const query = trx("background_tasks")
        .whereIn("kind", [
          "export",
          "import",
          "connector_sync",
          "document_prepare",
          "document_import",
        ])
        .orderBy("createdAt", "desc")
        .limit(10);
      if (projectId) query.whereRaw("payload->>'projectId'=?", [projectId]);
      return (await query).map((row) =>
        this.present(row, String(account.exportVersion)),
      );
    });
  }
  async get(principal: Principal, id: string) {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const row = await trx("background_tasks").where({ id }).first();
      if (!row) throw new GroveError("not_found", "Job not found", 404);
      return this.present(row, String(account.exportVersion));
    });
  }
  async action(principal: Principal, id: string, action: "cancel" | "retry") {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const row = await trx("background_tasks")
        .where({ id })
        .whereIn("kind", [
          "export",
          "import",
          "connector_sync",
          "document_prepare",
          "document_import",
        ])
        .forUpdate()
        .first();
      if (!row) throw new GroveError("not_found", "Job not found", 404);
      if (row.kind === "document_prepare" || row.kind === "document_import") {
        const batch = await trx("document_import_batches")
          .where({ id: row.payload.batchId, taskId: id })
          .first();
        if (
          !batch ||
          batch.status !==
            (row.kind === "document_prepare" ? "preparing" : "applying") ||
          (row.kind === "document_prepare" &&
            new Date(batch.expiresAt) <= new Date())
        )
          throw new GroveError(
            "import_changed",
            "This import cannot be resumed. Open its current status.",
            409,
          );
        if (action === "cancel")
          await trx("document_import_batches")
            .where({ id: batch.id })
            .update({ status: "cancelled", version: batch.version + 1 });
      }
      if (action === "cancel") {
        if (["pending", "running"].includes(row.status))
          await trx("background_tasks").where({ id }).update({
            status: "cancelled",
            leaseId: null,
            leaseUntil: null,
            updatedAt: trx.fn.now(),
            finishedAt: trx.fn.now(),
          });
      } else if (
        ["failed", "cancelled"].includes(row.status) ||
        (row.kind === "export" &&
          !this.present(row, String(account.exportVersion)).downloadable &&
          (row.status === "succeeded" ||
            (row.expiresAt && new Date(row.expiresAt) <= new Date())))
      ) {
        if (row.kind === "export") {
          if (
            row.payload.projectId &&
            !(await trx("projects")
              .where({ id: row.payload.projectId })
              .first("id"))
          )
            throw new GroveError("not_found", "Notebook not found", 404);
          if (
            await trx("background_tasks")
              .where({ kind: "export" })
              .whereNot({ id })
              .whereIn("status", ["pending", "running"])
              .first("id")
          )
            throw new GroveError(
              "export_busy",
              "An export is already running",
              409,
            );
          await trx("export_objects")
            .where({ taskId: id })
            .update({ part: null });
        }
        await trx("background_tasks")
          .where({ id })
          .update({
            status: "pending",
            failures: 0,
            errorCode: null,
            finishedAt: null,
            leaseId: null,
            leaseUntil: null,
            dispatchedAt: null,
            dispatchId: null,
            dispatchUntil: null,
            dueAt: trx.fn.now(),
            updatedAt: trx.fn.now(),
            ...(row.kind === "export"
              ? {
                  cursor: "{}",
                  processed: 0,
                  result: null,
                  payload: JSON.stringify({
                    ...row.payload,
                    exportVersion: String(account.exportVersion),
                  }),
                  expiresAt: trx.raw("now()+interval '1 day'"),
                }
              : {}),
          });
      }
      return this.present(
        await trx("background_tasks").where({ id }).first(),
        String(account.exportVersion),
      );
    });
  }
  async artifact(principal: Principal, id: string) {
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const row = await trx("background_tasks")
        .where({ id, kind: "export" })
        .first();
      if (
        !row ||
        !this.present(row, String(account.exportVersion)).downloadable
      )
        throw new GroveError(
          "export_unavailable",
          "Export is not available. Retry it to prepare a new copy.",
          409,
        );
      return {
        key: row.result.key as string,
        bytes: Number(row.result.bytes),
        filename: row.payload.projectId
          ? "grove-notebook.ndjson"
          : "grove-account.ndjson",
      };
    });
  }
  private present(row: TaskRow, version: string): Task {
    const stale =
      row.kind === "export" &&
      row.status === "succeeded" &&
      String(row.payload.exportVersion) !== version;
    const expired = row.expiresAt && new Date(row.expiresAt) <= new Date();
    return {
      id: row.id,
      kind: row.kind,
      status: stale || expired ? "failed" : row.status,
      processed: Number(row.processed),
      total: row.total == null ? null : Number(row.total),
      attempts: row.attempts,
      error: stale
        ? "export_changed"
        : expired
          ? "export_expired"
          : row.errorCode,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      ...(row.kind === "export"
        ? {
            scope: {
              projectId:
                typeof row.payload.projectId === "string"
                  ? row.payload.projectId
                  : null,
              includeDescendants: !!row.payload.includeDescendants,
            },
          }
        : {}),
      downloadable:
        row.kind === "export" &&
        row.status === "succeeded" &&
        !stale &&
        !expired &&
        !!row.result?.key,
    };
  }
}
