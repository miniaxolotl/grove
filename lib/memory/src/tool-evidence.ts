import type { Knex } from "@lib/database";
import { GroveError } from "@lib/shared/contracts";
import type { WorkflowScope } from "@lib/shared/notebook-workflows";
import { activeNotes } from "./relationship-data.ts";
import { changedSources } from "./note-changes.ts";

/** Resolve explicit membership under the tenant transaction, never from a model. */
export async function toolScope(trx: Knex.Transaction, scope: WorkflowScope) {
  if (scope.kind !== "notebooks") return [];
  let projects = await trx("projects")
    .whereIn("id", scope.ids)
    .where({ status: "active" })
    .whereNull("deletedAt")
    .select("id", "version", "contentVersion");
  if (projects.length !== scope.ids.length)
    throw new GroveError(
      "not_found",
      "One or more selected notebooks are unavailable.",
      404,
    );
  if (scope.includeDescendants) {
    const { rows } = await trx.raw(
      `WITH RECURSIVE selected AS (
      SELECT id FROM projects WHERE id=ANY(?::uuid[]) AND status='active' AND deleted_at IS NULL
      UNION SELECT p.id FROM projects p JOIN selected s ON p.parent_id=s.id WHERE p.status='active' AND p.deleted_at IS NULL
    ) SELECT id FROM selected`,
      [scope.ids],
    );
    projects = await trx("projects")
      .whereIn(
        "id",
        rows.map((row: { id: string }) => row.id),
      )
      .select("id", "version", "contentVersion");
  }
  return projects;
}

export async function toolEvidence(
  trx: Knex.Transaction,
  scope: WorkflowScope,
  queryText: string,
  after: string | null = null,
  budget = { notes: 12, characters: 24000 },
) {
  const projects = await toolScope(trx, scope);
  const eligible = () =>
    activeNotes(trx)
      .where((q) =>
        q
          .whereNull("projectId")
          .orWhereExists(
            trx("projects")
              .select("id")
              .whereRaw("projects.id=memories.project_id")
              .where({ status: "active" })
              .whereNull("deletedAt"),
          ),
      )
      .modify((q) => {
        if (scope.kind === "notes")
          q.whereIn(
            "id",
            scope.sources.map((ref) => ref.id),
          );
        if (scope.kind === "notebooks")
          q.whereIn(
            "projectId",
            projects.map((project) => project.id),
          );
      });
  const metadata =
    scope.kind === "notes"
      ? await eligible().select("id", "version", "projectId", "expiresAt")
      : [];
  const counted =
    scope.kind === "notes"
      ? null
      : await eligible()
          .count("id as count")
          .min("expiresAt as deadline")
          .first();
  const total =
    scope.kind === "notes"
      ? metadata.length
      : Number(counted ? Reflect.get(counted, "count") : 0);
  if (
    scope.kind === "notes" &&
    scope.sources.some(
      (ref) =>
        !metadata.some(
          (note) => note.id === ref.id && note.version === ref.version,
        ),
    )
  )
    throw changedSources();
  const terms = [
    ...new Set(queryText.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []),
  ].slice(0, 32);
  const score = terms.length
    ? `(${terms.map(() => "CASE WHEN content ILIKE ? THEN 1 ELSE 0 END").join("+")})`
    : "0";
  const bindings = terms.map((term) => `%${term}%`);
  const ranked = () =>
    eligible()
      .select("id", "version", "projectId", "expiresAt")
      .select(
        trx.raw(
          `length(content) AS source_length, ${score} AS source_score`,
          bindings,
        ),
      );
  const candidates = ranked();
  if (after) {
    const cursor = await ranked().where("id", after).first();
    if (!cursor) throw changedSources();
    const value = Number(Reflect.get(cursor, "sourceScore"));
    candidates.whereRaw(`(${score} < ? OR (${score} = ? AND id>?::uuid))`, [
      ...bindings,
      value,
      ...bindings,
      value,
      after,
    ]);
  }
  const page = await candidates
    .orderByRaw("source_score DESC")
    .orderBy("id")
    .limit(128);
  let characters = 0;
  const ids: string[] = [];
  for (const note of page) {
    const size = Number(Reflect.get(note, "sourceLength"));
    if (ids.length === budget.notes || characters + size > budget.characters)
      break;
    characters += size;
    ids.push(note.id);
  }
  if (!ids.length && page.length)
    throw new GroveError(
      "evidence_too_large",
      "A selected note exceeds the evidence budget. Narrow the selection.",
      400,
    );
  const sources = await eligible().whereIn("id", ids).orderBy("id");
  const hasMore = page.length > ids.length;
  return {
    scopeExpiresAt:
      scope.kind === "notes"
        ? (metadata
            .filter((note) => note.expiresAt)
            .map((note) => new Date(note.expiresAt!))
            .sort((a, b) => a.getTime() - b.getTime())[0] ?? null)
        : counted && Reflect.get(counted, "deadline")
          ? new Date(Reflect.get(counted, "deadline"))
          : null,
    sources,
    projects,
    dependencies:
      scope.kind === "notes"
        ? metadata.map(({ id, version, projectId }) => ({
            id,
            version,
            projectId,
          }))
        : sources.map(({ id, version, projectId }) => ({
            id,
            version,
            projectId,
          })),
    nextCursor: hasMore ? ids.at(-1)! : null,
    coverage: {
      total,
      examined: sources.length,
      supplied: sources.length,
      cited: 0,
      partial: sources.length < total,
      ...(hasMore
        ? {
            reason:
              "This result covers a bounded batch. Continue reviewing to include more selected evidence.",
          }
        : {}),
    },
  };
}
