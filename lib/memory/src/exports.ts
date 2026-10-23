import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { tenant, type Knex } from "@lib/database";
import {
  TaskError,
  taskTransaction,
  type ClaimedTask,
  type TaskHandler,
} from "./task-runner.ts";

export interface ArtifactStore {
  ready?(): Promise<void>;
  close?(): void;
  write(
    key: string,
    data: Buffer | Readable,
    signal: AbortSignal,
  ): Promise<void>;
  read(key: string, signal?: AbortSignal): Promise<Readable>;
  remove(key: string, signal?: AbortSignal): Promise<void>;
}
const stages = [
  "notebook",
  "note",
  "revision",
  "conversation",
  "turn",
  "note_relationship",
  "notebook_relationship",
  "notebook_checkpoint",
  "notebook_visit",
  "assistance_review",
  "assistance_operation",
  "ask_settings",
] as const;
const pageSize = 100;
const assertVersion = async (trx: Knex.Transaction, task: ClaimedTask) => {
  const account = await trx("accounts")
    .where({ id: task.accountId, status: "active" })
    .first();
  if (!account || String(account.exportVersion) !== task.payload.exportVersion)
    throw new TaskError("export_changed", false);
};
async function prepare(db: Knex, task: ClaimedTask, key: string) {
  await tenant(db, task.accountId!, async (trx) => {
    await trx("accounts").where({ id: task.accountId }).forShare().first();
    await assertVersion(trx, task);
    const current = await trx("background_tasks")
      .where({ id: task.id, leaseId: task.leaseId, status: "running" })
      .where("leaseUntil", ">", trx.fn.now())
      .forShare()
      .first();
    if (
      !current ||
      (current.expiresAt && new Date(current.expiresAt) <= new Date())
    )
      throw new TaskError("export_expired", false);
    await trx("export_objects").insert({
      objectKey: key,
      accountId: task.accountId,
      taskId: task.id,
    });
  });
}
async function page(trx: Knex.Transaction, task: ClaimedTask, stage: number) {
  // Keep notebook trees in PostgreSQL rather than loading an unbounded scope
  // into the request/task payload. Each retry resolves the current tree.
  const projects = task.payload.projectId
    ? trx
        .withRecursive(
          "export_scope",
          trx.raw(
            `
        SELECT id FROM projects WHERE id=?::uuid
        UNION SELECT p.id FROM projects p JOIN export_scope s ON p.parent_id=s.id WHERE ?::boolean
      `,
            [String(task.payload.projectId), !!task.payload.includeDescendants],
          ),
        )
        .select("id")
        .from("export_scope")
    : null;
  const after = task.cursor.afterId as string | undefined;
  const kind = stages[stage];
  if (kind === "ask_settings")
    return projects ? [] : trx("accounts").select("id", "askTools");
  if (kind === "notebook_checkpoint" || kind === "notebook_visit") {
    const checkpoint = kind === "notebook_checkpoint";
    const column = checkpoint ? "projectId" : "id";
    const q = trx(checkpoint ? "notebook_checkpoints" : "notebook_visits")
      .select(
        checkpoint
          ? ["projectId", "token"]
          : ["id", "projectId", "fromToken", "toToken", "baseline", "at"],
      )
      .whereIn("projectId", projects ?? trx("projects").select("id"))
      .orderBy(column)
      .limit(pageSize);
    if (after) q.where(column, ">", after);
    return q;
  }
  if (kind === "assistance_review" || kind === "assistance_operation") {
    // These records can span notebooks; scoped exports must not reveal another scope.
    if (projects) return [];
    const review = kind === "assistance_review",
      column = review ? "key" : "id";
    const q = trx(review ? "assistance_reviews" : "assistance_requests")
      .select(
        review
          ? ["key", "version", "dismissed"]
          : [
              "id",
              "kind",
              "status",
              "version",
              "dependencies",
              "scopes",
              "applied",
              "application",
              "createdAt",
              "updatedAt",
            ],
      )
      .orderBy(column)
      .limit(pageSize);
    if (!review) q.whereRaw("jsonb_array_length(applied)>0");
    if (after) q.where(column, ">", after);
    return q;
  }
  if (kind === "revision") {
    const q = trx("memory_revisions as r")
      .join("memories as m", function () {
        this.on("m.id", "=", "r.memoryId").andOn(
          "m.accountId",
          "=",
          "r.accountId",
        );
      })
      .select("r.memoryId", "r.version", "r.content", "r.source", "r.createdAt")
      .orderBy("r.memoryId")
      .orderBy("r.version")
      .limit(pageSize);
    if (projects) q.whereIn("m.projectId", projects);
    if (after)
      q.whereRaw("(r.memory_id,r.version)>(?::uuid,?::integer)", [
        after,
        Number(task.cursor.afterVersion),
      ]);
    return q;
  }
  if (projects && (kind === "conversation" || kind === "turn")) return [];
  const tables = {
    notebook: "projects",
    note: "memories",
    conversation: "conversations",
    turn: "conversation_turns",
    note_relationship: "memory_relationships",
    notebook_relationship: "notebook_relationships",
  } as const;
  const q = trx(tables[kind]).orderBy("id").limit(pageSize);
  if (after) q.where("id", ">", after);
  if (kind === "note") {
    q.select(
      "id",
      "projectId",
      "content",
      "kind",
      "autoKind",
      "status",
      "version",
      "source",
      "taskId",
      "retentionDays",
      "expiresAt",
      "createdAt",
      "updatedAt",
    );
    if (projects) q.whereIn("projectId", projects);
  } else if (kind === "notebook") {
    q.select(
      "id",
      "name",
      "identity",
      "parentId",
      "version",
      "status",
      "createdAt",
    );
    if (projects) q.whereIn("id", projects);
  } else if (kind === "conversation")
    q.select(
      "id",
      "title",
      "scope",
      "version",
      "tools",
      "toolsVersion",
      "createdAt",
      "updatedAt",
    );
  else if (kind === "turn")
    q.select(
      "id",
      "conversationId",
      "position",
      "question",
      "format",
      "status",
      "result",
      "createdAt",
    );
  else {
    const endpoint = kind === "note_relationship" ? "memories" : "projects";
    for (const side of ["leftId", "rightId"])
      q.whereIn(
        side,
        trx(endpoint)
          .select("id")
          .modify((b) => {
            if (projects)
              b.whereIn(
                kind === "note_relationship" ? "projectId" : "id",
                projects,
              );
          }),
      );
    q.select(
      "id",
      "leftId",
      "rightId",
      "leftVersion",
      "rightVersion",
      "assessment",
      "revision",
      "dismissedRevision",
      "reviewVersion",
    );
  }
  return q;
}

export function exportHandlers(
  db: Knex,
  store: ArtifactStore,
): { export: TaskHandler; artifact_cleanup: TaskHandler } {
  const exportTask: TaskHandler = async (task, signal) => {
    const stage = Number(task.cursor.stage ?? 0),
      part = Number(task.cursor.part ?? 0);
    const key = `exports/${task.accountId}/${task.id}/${randomUUID()}.ndjson`;
    if (stage >= stages.length) {
      await prepare(db, task, key);
      let bytes = 0;
      const content = Readable.from(
        (async function* () {
          let after = -1;
          while (true) {
            signal.throwIfAborted();
            const pieces = await tenant(db, task.accountId!, (trx) =>
              trx("export_objects")
                .where({ taskId: task.id })
                .where("part", ">", after)
                .orderBy("part")
                .limit(50),
            );
            for (const piece of pieces) {
              const stream = await store.read(piece.objectKey, signal);
              for await (const chunk of stream) {
                signal.throwIfAborted();
                bytes += Buffer.byteLength(chunk);
                yield chunk;
              }
              after = piece.part;
            }
            if (pieces.length < 50) break;
          }
        })(),
      );
      await store.write(key, content, signal);
      await taskTransaction(db, task, async (trx) => {
        await assertVersion(trx, task);
        await trx("export_objects").where({ objectKey: key }).update({ bytes });
        return {
          complete: true,
          result: { key, bytes, format: "grove.ndjson.v2" },
        };
      });
      return;
    }
    const rows = await tenant(db, task.accountId!, async (trx) => {
      await assertVersion(trx, task);
      return page(trx, task, stage);
    });
    if (rows.length) {
      await prepare(db, task, key);
      const data = Buffer.from(
        rows
          .map((row) => JSON.stringify({ type: stages[stage], ...row }))
          .join("\n") + "\n",
      );
      await store.write(key, data, signal);
      await taskTransaction(db, task, async (trx) => {
        await assertVersion(trx, task);
        await trx("export_objects")
          .where({ objectKey: key })
          .update({ part, bytes: data.length });
        const last = rows.at(-1)!;
        return {
          processed: Number(task.processed) + rows.length,
          cursor: {
            stage: rows.length < pageSize ? stage + 1 : stage,
            part: part + 1,
            ...(rows.length === pageSize
              ? {
                  afterId:
                    last.id ?? last.memoryId ?? last.projectId ?? last.key,
                  afterVersion: last.version,
                }
              : {}),
          },
        };
      });
    } else
      await taskTransaction(db, task, async (trx) => {
        await assertVersion(trx, task);
        return { cursor: { stage: stage + 1, part } };
      });
  };
  const artifact_cleanup: TaskHandler = async (task, signal) => {
    const objects = await tenant(db, task.accountId!, (trx) =>
      trx("export_objects")
        .where("expiresAt", "<=", trx.fn.now())
        .orderBy("objectKey")
        .limit(100),
    );
    for (const object of objects) {
      signal.throwIfAborted();
      await store.remove(object.objectKey, signal);
    }
    await taskTransaction(db, task, async (trx) => {
      if (objects.length)
        await trx("export_objects")
          .whereIn(
            "objectKey",
            objects.map((object) => object.objectKey),
          )
          .delete();
      return {
        complete: objects.length < 100,
        processed: Number(task.processed) + objects.length,
      };
    });
  };
  return { export: exportTask, artifact_cleanup };
}
