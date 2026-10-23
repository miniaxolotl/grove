import { randomUUID, createHash } from "node:crypto";
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
  "media_object",
  "media_binding",
  "media_transcript_revision",
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
  const mediaNotes = () =>
    trx("memories")
      .select("id")
      .modify((query) => {
        if (projects) query.whereIn("projectId", projects);
      });
  if (kind === "media_binding") {
    if (!task.payload.includeMedia) return [];
    const q = trx("media_revision_bindings")
      .whereIn("memoryId", mediaNotes())
      .select("mediaId", "memoryId", "version")
      .orderBy("mediaId")
      .orderBy("version")
      .limit(pageSize);
    if (after)
      q.whereRaw("(media_id,version)>(?::uuid,?::integer)", [
        after,
        Number(task.cursor.afterVersion),
      ]);
    return q;
  }
  if (kind === "media_transcript_revision") {
    if (!task.payload.includeMedia) return [];
    const q = trx("media_transcript_revisions as r")
      .join("media_objects as o", function () {
        this.on("o.accountId", "=", "r.accountId").andOn(
          "o.id",
          "=",
          "r.mediaId",
        );
      })
      .whereIn("o.memoryId", mediaNotes())
      .select("r.mediaId", "r.version", "r.text", "r.createdAt", "o.memoryId")
      .orderBy("r.mediaId")
      .orderBy("r.version")
      .limit(pageSize);
    if (after)
      q.whereRaw("(r.media_id,r.version)>(?::uuid,?::integer)", [
        after,
        Number(task.cursor.afterVersion),
      ]);
    return q;
  }
  if (kind === "media_object") {
    if (!task.payload.includeMedia) return [];
    const q = trx("media_objects as o")
      .where({ "o.status": "ready" })
      .whereIn("o.memoryId", mediaNotes())
      .whereExists(
        trx("media_revision_bindings as b")
          .select(trx.raw("1"))
          .whereRaw("b.account_id=o.account_id AND b.media_id=o.id"),
      )
      .select("o.*")
      .orderBy("o.id")
      .limit(1);
    if (after) q.where("o.id", ">", after);
    return q;
  }
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
    q.select("id", "name", "identity", "parentId", "version", "createdAt");
    if (projects) q.whereIn("id", projects);
  } else if (kind === "conversation")
    q.select("id", "title", "scope", "version", "createdAt", "updatedAt");
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
  media?: { read(key: string, signal: AbortSignal): Promise<Readable> } | null,
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
          result: {
            key,
            bytes,
            format: task.payload.includeMedia
              ? "grove.ndjson.v3"
              : "grove.ndjson.v2",
          },
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
      if (stages[stage] === "media_object") {
        if (!media) throw new TaskError("media_storage_unavailable", false);
        const row = rows[0];
        let bytes = 0;
        const content = Readable.from(
          (async function* () {
            const metadata = {
              type: "media_object",
              id: row.id,
              memoryId: row.memoryId,
              mime: row.mime,
              bytes: row.bytes,
              sha256: row.sha256,
              width: row.width,
              height: row.height,
              durationMs: row.durationMs ?? null,
            };
            const first = Buffer.from(JSON.stringify(metadata) + "\n");
            bytes += first.length;
            yield first;
            const source = await media.read(row.objectKey, signal),
              hash = createHash("sha256");
            let received = 0,
              offset = 0;
            for await (const chunk of source) {
              signal.throwIfAborted();
              received += chunk.length;
              if (received > row.bytes)
                throw new TaskError("media_integrity", false);
              hash.update(chunk);
              for (let from = 0; from < chunk.length; from += 48 * 1024) {
                const piece = chunk.subarray(from, from + 48 * 1024);
                const record = Buffer.from(
                  JSON.stringify({
                    type: "media_chunk",
                    id: row.id,
                    offset,
                    data: piece.toString("base64"),
                  }) + "\n",
                );
                offset += piece.length;
                bytes += record.length;
                yield record;
              }
            }
            if (received !== row.bytes || hash.digest("hex") !== row.sha256)
              throw new TaskError("media_integrity", false);
          })(),
        );
        await store.write(key, content, signal);
        await taskTransaction(db, task, async (trx) => {
          await assertVersion(trx, task);
          await trx("export_objects")
            .where({ objectKey: key })
            .update({ part, bytes });
          return {
            processed: Number(task.processed) + 1,
            cursor: { stage, part: part + 1, afterId: row.id },
          };
        });
        return;
      }
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
                    last.id ??
                    last.mediaId ??
                    last.memoryId ??
                    last.projectId ??
                    last.key,
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
