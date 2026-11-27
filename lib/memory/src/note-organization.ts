import { createHmac } from "node:crypto";
import type { Knex } from "@lib/database";
import { GroveError } from "@lib/shared/contracts";
import type {
  OrganizeNote,
  NoteOrganization,
} from "@lib/shared/note-organization";

export const noteOrderScope = (projectId?: string | null) =>
  projectId === undefined ? "all" : (projectId ?? "unfiled");
export function noteRank(trx: Knex.Transaction, projectId?: string | null) {
  return noteRankForScope(trx, noteOrderScope(projectId));
}
export function noteRankForScope(
  trx: Knex.Transaction,
  scope: string | Knex.Raw,
) {
  return trx.raw(
    `COALESCE((SELECT p.rank FROM note_order_positions p WHERE
    p.account_id=memories.account_id AND p.memory_id=memories.id AND p.scope=?),
    grove_note_default_rank(memories.id,memories.created_at))`,
    [scope],
  );
}
export async function noteOrderState(
  trx: Knex.Transaction,
  secret: string,
  projectId?: string | null,
) {
  const account = await trx("accounts").first(
    "id",
    "changeToken",
    "noteOrderVersion",
  );
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        account.id,
        noteOrderScope(projectId),
        account.changeToken,
        account.noteOrderVersion,
      ]),
    )
    .digest("hex");
}
export async function organizeNote(
  trx: Knex.Transaction,
  secret: string,
  accountId: string,
  id: string,
  input: OrganizeNote,
): Promise<NoteOrganization> {
  const eligible = trx("memories")
    .whereNull("deletedAt")
    .where({ status: "active" })
    .where((q) =>
      q.whereNull("expiresAt").orWhere("expiresAt", ">", trx.fn.now()),
    );
  if (input.projectId !== undefined)
    eligible.where({ projectId: input.projectId });
  if (
    input.projectId &&
    !(await trx("projects")
      .where({ id: input.projectId, status: "active" })
      .whereNull("deletedAt")
      .first("id"))
  )
    throw new GroveError("not_found", "Notebook not found", 404);
  const base = () =>
    trx
      .withMaterialized(
        "ordered_notes",
        eligible
          .clone()
          .select(
            "id",
            "version",
            trx.raw("(?)::text AS rank", [noteRank(trx, input.projectId)]),
          ),
      )
      .from("ordered_notes");
  const note = await base().where({ id }).first();
  if (!note)
    throw new GroveError("not_found", "Note not found in this order", 404);
  if (note.version !== input.expectedVersion)
    throw new GroveError(
      "version_conflict",
      "This note changed. Review it before organizing.",
      409,
    );
  if (
    input.expectedState !== (await noteOrderState(trx, secret, input.projectId))
  )
    throw new GroveError(
      "note_order_conflict",
      "This note order changed. Refresh and try again.",
      409,
    );
  const neighbor = (rank: string, noteId: string, direction: "asc" | "desc") =>
    base()
      .whereNot({ id })
      .whereRaw(
        `(rank::numeric,id) ${direction === "asc" ? ">" : "<"} (?::numeric,?::uuid)`,
        [rank, noteId],
      )
      .orderByRaw(`rank::numeric ${direction},id ${direction}`)
      .first();
  const [previous, next] = await Promise.all([
    neighbor(note.rank, id, "desc"),
    neighbor(note.rank, id, "asc"),
  ]);
  let left: { rank: string } | undefined, right: { rank: string } | undefined;
  const anchorId = input.beforeId ?? input.afterId;
  if (anchorId) {
    const anchor = await base()
      .where({ id: anchorId })
      .whereNot({ id })
      .first();
    if (!anchor)
      throw new GroveError(
        "not_found",
        "The destination note is unavailable",
        404,
      );
    if (input.beforeId) {
      right = anchor;
      left = await neighbor(anchor.rank, anchorId, "desc");
    } else {
      left = anchor;
      right = await neighbor(anchor.rank, anchorId, "asc");
    }
  } else
    left = await base()
      .whereNot({ id })
      .orderByRaw("rank::numeric desc,id desc")
      .first();
  const { rows } = await trx.raw(
    "SELECT CASE WHEN ?::numeric IS NULL THEN floor(COALESCE(?::numeric,0))-1024 WHEN ?::numeric IS NULL THEN ceil(?::numeric)+1024 ELSE (?::numeric+?::numeric)*0.5 END::text AS rank",
    [
      left?.rank ?? null,
      right?.rank ?? null,
      right?.rank ?? null,
      left?.rank ?? null,
      left?.rank ?? null,
      right?.rank ?? null,
    ],
  );
  if (rows[0].rank.length > 512)
    throw new GroveError(
      "note_order_conflict",
      "This position is too tightly packed. Review the order and choose another position.",
      409,
    );
  await trx("note_order_positions")
    .insert({
      accountId,
      scope: noteOrderScope(input.projectId),
      memoryId: id,
      rank: rows[0].rank,
    })
    .onConflict(["accountId", "scope", "memoryId"])
    .merge(["rank"]);
  await trx("accounts")
    .where({ id: accountId })
    .increment("noteOrderVersion", 1);
  await trx("accounts").where({ id: accountId }).increment("exportVersion", 1);
  return {
    id,
    state: await noteOrderState(trx, secret, input.projectId),
    undo: next
      ? { beforeId: next.id }
      : previous
        ? { afterId: previous.id }
        : {},
  };
}
