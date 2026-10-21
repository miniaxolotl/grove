import { createHash } from "node:crypto";
import { MemoryModel, type Knex, type QueryBuilder } from "@lib/database";
import type { Providers } from "@lib/ai";
import type { ModelProfiles } from "@lib/shared/models";
import type {
  ConnectionLevel,
  ConnectionSource,
  NoteConnection,
  RelationshipAssessment,
  ConnectionEvidence,
} from "@lib/shared/relationships";

export const relationshipKinds = [
  "relationship_scan",
  "note_relationship",
  "notebook_profile",
  "notebook_relationship",
] as const;
export type RelationshipKind = (typeof relationshipKinds)[number];
export const relationshipTable = (level: ConnectionLevel) =>
  level === "note" ? "memory_relationships" : "notebook_relationships";
export const relationHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function relationshipProfile(
  profiles: Pick<ModelProfiles, "generation" | "embedding">,
) {
  return profiles.generation
    ? `relationships-v1-${relationHash([profiles.generation, profiles.embedding])}`
    : null;
}
export const currentRelationshipProfile = (providers: Providers) =>
  relationshipProfile({
    generation: providers.generation?.profile ?? null,
    embedding: providers.embedding?.profile ?? null,
  });
export const activeNotes = (
  trx: Knex.Transaction,
): QueryBuilder<MemoryModel, MemoryModel[]> =>
  MemoryModel.query(trx)
    .where({ status: "active" })
    .where((b) =>
      b.whereNull("expiresAt").orWhere("expiresAt", ">", trx.fn.now()),
    );
export const noteTitle = (content: string) =>
  content
    .split("\n")
    .find((line) => line.trim())
    ?.replace(/^#{1,6}\s+/, "")
    .slice(0, 120) || "Untitled note";
export const connectionSource = (row: MemoryModel): ConnectionSource => ({
  id: row.id,
  version: row.version,
  content: row.content,
  title: noteTitle(row.content),
  projectId: row.projectId,
});
export type StoredAssessment = Omit<RelationshipAssessment, "evidence"> & {
  evidence: ConnectionEvidence[];
  coverage: NoteConnection["coverage"];
  breadth: NoteConnection["breadth"];
};
export type RelationshipRow = {
  id: string;
  accountId: string;
  leftId: string;
  rightId: string;
  leftVersion: number;
  rightVersion: number;
  profile: string;
  revision: string;
  assessment: StoredAssessment;
  expiresAt: Date | null;
  updatedAt: Date;
  dismissedRevision: string | null;
  reviewVersion: number;
};
export const unexpired = (date: Date | string | null) =>
  !date || new Date(date).getTime() > Date.now();

/** One bounded query for each endpoint type, then one for all cited notes. */
export async function presentRelationships(
  trx: Knex.Transaction,
  level: ConnectionLevel,
  rows: RelationshipRow[],
  allowed?: (projectId: string | null) => boolean,
): Promise<NoteConnection[]> {
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.leftId, r.rightId]))];
  const endpoints =
    level === "note"
      ? await activeNotes(trx).whereIn("id", ids)
      : await trx("projects").whereIn("id", ids);
  const byId = new Map<
    string,
    { id: string; title: string; version: number; projectId: string | null }
  >(
    endpoints.map((r) => [
      r.id,
      {
        id: r.id,
        title: level === "note" ? noteTitle(r.content) : r.name,
        version: level === "note" ? r.version : r.contentVersion,
        projectId: level === "note" ? r.projectId : r.id,
      },
    ]),
  );
  const cited = [
    ...new Set(rows.flatMap((r) => r.assessment.evidence.map((e) => e.id))),
  ];
  const notes = new Map(
    (await activeNotes(trx).whereIn("id", cited)).map((r) => [r.id, r]),
  );
  const result: NoteConnection[] = [];
  for (const row of rows) {
    const left = byId.get(row.leftId),
      right = byId.get(row.rightId);
    const data = row.assessment;
    if (
      !left ||
      !right ||
      left.version !== row.leftVersion ||
      right.version !== row.rightVersion ||
      !unexpired(row.expiresAt) ||
      data.relationship === "unrelated" ||
      (allowed && (!allowed(left.projectId) || !allowed(right.projectId))) ||
      (level === "note" && left.projectId !== right.projectId)
    )
      continue;
    if (
      data.evidence.some((ref) => {
        const note = notes.get(ref.id);
        return (
          !note ||
          note.version !== ref.version ||
          note.content.slice(ref.start, ref.end) !== ref.quote ||
          note.projectId !== ref.projectId ||
          (allowed && !allowed(note.projectId)) ||
          (level === "notebook" &&
            note.projectId !== row.leftId &&
            note.projectId !== row.rightId)
        );
      })
    )
      continue;
    result.push({
      id: row.id,
      level,
      type: data.relationship,
      reason: data.reason,
      basis: data.basis,
      direction: data.direction,
      from: { id: left.id, title: left.title },
      to: { id: right.id, title: right.title },
      evidence: data.evidence.map((e) => ({
        ...e,
        title: noteTitle(notes.get(e.id)!.content),
      })),
      coverage: data.coverage,
      breadth: data.breadth,
      revision: row.revision,
      reviewVersion: row.reviewVersion,
      dismissed: row.dismissedRevision === row.revision,
      updatedAt: new Date(row.updatedAt).toISOString(),
    });
  }
  return result;
}

export async function enqueueRelationship(
  trx: Knex.Transaction,
  accountId: string,
  kind: RelationshipKind,
  target: string,
  profile: string,
  scope: object,
  note?: { id: string; version: number },
  replace = false,
) {
  const query = trx("jobs")
    .insert({
      accountId,
      kind,
      target,
      profile,
      scope: JSON.stringify(scope),
      memoryId: note?.id ?? null,
      version: note?.version ?? null,
      dueAt: trx.raw("now() + interval '5 seconds'"),
    })
    .onConflict(["accountId", "kind", "target", "profile"]);
  if (replace)
    await query.merge({
      scope: JSON.stringify(scope),
      version: note?.version ?? null,
      attempts: 0,
      failedAt: null,
      errorCode: null,
      leaseId: null,
      leaseUntil: null,
      dispatchedAt: null,
      dueAt: trx.raw("now() + interval '5 seconds'"),
    });
  else await query.ignore();
}
