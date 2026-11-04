import type { Knex } from "@lib/database";
import { GroveError, type Notebook } from "@lib/shared/contracts";
import type {
  OrganizeNotebook,
  NotebookOrganization,
} from "@lib/shared/notebook-organization";

export const notebookFields = [
  "id",
  "name",
  "identity",
  "parentId",
  "version",
  "status",
  "position",
];
export const orderConflict = () =>
  new GroveError(
    "notebook_order_conflict",
    "Your notebooks changed. Review the latest layout before moving again.",
    409,
  );
const invalid = (message: string) => new GroveError("invalid_request", message);
const missing = () => new GroveError("not_found", "Notebook not found", 404);

/** Called only inside the owning session's account-serialized transaction. */
export async function organizeNotebook(
  trx: Knex.Transaction,
  id: string,
  input: OrganizeNotebook,
  state: (trx: Knex.Transaction) => Promise<string>,
): Promise<NotebookOrganization> {
  if ((await state(trx)) !== input.expectedState) throw orderConflict();
  const rows: Notebook[] = await trx("projects")
    .where({ status: "active" })
    .select(notebookFields)
    .orderBy("position")
    .orderBy("id");
  const source = rows.find((p) => p.id === id);
  if (!source) throw missing();
  if (source.version !== input.expectedVersion) throw orderConflict();
  if (input.parentId && !rows.some((p) => p.id === input.parentId))
    throw missing();
  const byId = new Map(rows.map((p) => [p.id, p]));
  const seen = new Set([id]);
  for (
    let parent = input.parentId;
    parent;
    parent = byId.get(parent)?.parentId ?? null
  ) {
    if (seen.has(parent))
      throw invalid(
        "A notebook cannot be placed inside itself or its sub-notebooks.",
      );
    seen.add(parent);
  }
  const anchorId = input.beforeId ?? input.afterId;
  const anchor = anchorId ? byId.get(anchorId) : undefined;
  if (anchorId && !anchor) throw missing();
  if (
    anchor &&
    (anchor.id === id || (anchor.parentId ?? null) !== input.parentId)
  )
    throw invalid(
      "Choose another notebook in the destination as the position.",
    );
  const oldSiblings = rows.filter(
    (p) => (p.parentId ?? null) === (source.parentId ?? null),
  );
  const oldIndex = oldSiblings.findIndex((p) => p.id === id);
  const next = oldSiblings[oldIndex + 1],
    previous = oldSiblings[oldIndex - 1];
  const undo = {
    parentId: source.parentId ?? null,
    ...(next
      ? { beforeId: next.id }
      : previous
        ? { afterId: previous.id }
        : {}),
  };
  const siblings = rows.filter(
    (p) => p.id !== id && (p.parentId ?? null) === input.parentId,
  );
  const index = anchor
    ? siblings.findIndex((p) => p.id === anchor.id) + (input.afterId ? 1 : 0)
    : siblings.length;
  siblings.splice(index, 0, source);
  const reparent = (source.parentId ?? null) !== input.parentId;
  if (!reparent && siblings.every((p, i) => p.id === oldSiblings[i]?.id))
    return { project: source, state: input.expectedState, undo };
  if (reparent) {
    await trx("projects")
      .where({ id })
      .update({ parentId: input.parentId, version: trx.raw("version+1") });
  }
  // Renumber only the affected destination group, without content/version churn.
  const values = siblings.map((p, i) => ({ id: p.id, position: i + 1 }));
  await trx.raw(
    "UPDATE projects p SET position=v.position FROM jsonb_to_recordset(?::jsonb) AS v(id uuid,position integer) WHERE p.id=v.id AND p.position IS DISTINCT FROM v.position",
    [JSON.stringify(values)],
  );
  const project: Notebook = await trx("projects")
    .select(notebookFields)
    .where({ id })
    .first();
  return { project, state: await state(trx), undo };
}
