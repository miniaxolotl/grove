import { MemoryModel, type Knex } from "@lib/database";
import { GroveError } from "@lib/shared/contracts";
import type { SourceRef } from "@lib/shared/models";

export type ReadDependency = SourceRef & { projectId?: string | null };
export type NoteWrite = {
  id?: string;
  version?: number;
  content?: string;
  status?: "active" | "archived";
  projectId?: string | null;
};
export type NoteUndo = {
  id: string;
  version: number;
  content: string;
  status: "active" | "archived";
  projectId?: string | null;
}[];
export const changedSources = () =>
  new GroveError(
    "sources_changed",
    "These notes changed. Refresh the preview.",
    409,
  );

/** Reads are fenced independently from writes: citing a note never grants a write. */
export async function applyNoteChanges(
  trx: Knex.Transaction,
  accountId: string,
  dependencies: ReadDependency[],
  writes: NoteWrite[],
  revise: (trx: Knex.Transaction, row: MemoryModel) => Promise<void>,
  options: {
    undo?: boolean;
    allowed?: (projectId: string | null) => boolean;
  } = {},
) {
  const ids = [
    ...new Set([
      ...dependencies.map((r) => r.id),
      ...writes.flatMap((w) => (w.id ? [w.id] : [])),
    ]),
  ];
  const rows = await MemoryModel.query(trx)
    .whereIn("id", ids)
    .orderBy("id")
    .forUpdate();
  if (
    dependencies.some(
      (ref) =>
        !rows.some(
          (row) =>
            row.id === ref.id &&
            row.version === ref.version &&
            (ref.projectId === undefined || ref.projectId === row.projectId) &&
            (!options.allowed || options.allowed(row.projectId)) &&
            (!row.expiresAt || new Date(row.expiresAt) > new Date()) &&
            (options.undo || row.status === "active"),
        ),
    )
  )
    throw changedSources();
  if (
    new Set(writes.flatMap((w) => (w.id ? [w.id] : []))).size !==
    writes.filter((w) => w.id).length
  )
    throw changedSources();
  const originals: NoteUndo = [],
    applied: SourceRef[] = [];
  for (const write of writes) {
    if (
      write.projectId &&
      !(await trx("projects").where({ id: write.projectId }).first("id"))
    )
      throw changedSources();
    const old = write.id ? rows.find((r) => r.id === write.id) : undefined;
    if (
      write.id &&
      (!old ||
        old.version !== write.version ||
        !dependencies.some(
          (r) => r.id === write.id && r.version === write.version,
        ))
    )
      throw changedSources();
    const row = old
      ? await MemoryModel.query(trx).patchAndFetchById(old.id, {
          ...(write.content === undefined ? {} : { content: write.content }),
          ...(write.status === undefined ? {} : { status: write.status }),
          ...(write.projectId === undefined
            ? {}
            : { projectId: write.projectId }),
          version: old.version + 1,
          updatedAt: trx.fn.now(),
        })
      : await MemoryModel.query(trx)
          .insert({
            accountId,
            content: write.content!,
            projectId: write.projectId ?? null,
            kind: "fact",
            autoKind: false,
            source: { agent: "website" },
          })
          .returning("*");
    originals.push({
      id: row.id,
      version: row.version,
      content: old?.content ?? row.content,
      status: old?.status ?? "archived",
      projectId: old ? old.projectId : row.projectId,
    });
    await revise(trx, row);
    applied.push({ id: row.id, version: row.version });
  }
  return { originals, applied };
}
