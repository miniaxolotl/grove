import type { Knex } from "@lib/database";
import { GroveError } from "@lib/shared/contracts";
import type {
  ConversationContext,
  ConversationScope,
  ContextCoverage,
} from "@lib/shared/conversations";
import type { SourceRef } from "@lib/shared/models";
import { inConversationScope } from "./conversation-scope.ts";

/** Resolve IDs under RLS; rank only direct selected members, never global results.
 * Twelve full notes are at most 72,000 characters under the existing note contract. */
export async function resolveConversationContext(
  trx: Knex.Transaction,
  scope: ConversationScope,
  selection: ConversationContext | undefined,
  query: string,
): Promise<{
  sources: SourceRef[];
  notebooks: SourceRef[];
  coverage?: ContextCoverage;
}> {
  if (!selection) return { sources: [], notebooks: [] };
  const unavailable = () =>
    new GroveError(
      "context_unavailable",
      "A selected source is unavailable in this conversation. Remove it or choose it again.",
      409,
    );
  const books = await trx("projects")
    .whereIn("id", selection.notebooks)
    .where({ status: "active" })
    .select("id", "version");
  if (
    books.length !== selection.notebooks.length ||
    books.some((book) => !inConversationScope(scope, book.id))
  )
    throw unavailable();
  const active = () =>
    trx("memories")
      .where({ status: "active" })
      .where((q) =>
        q.whereNull("expiresAt").orWhere("expiresAt", ">", trx.fn.now()),
      );
  const pins = await active()
    .whereIn("id", selection.notes)
    .select("id", "version", "projectId");
  if (
    pins.length !== selection.notes.length ||
    pins.some((pin) => !inConversationScope(scope, pin.projectId))
  )
    throw unavailable();
  const members = active()
    .whereIn("projectId", selection.notebooks)
    .whereNotIn("id", selection.notes);
  const count = await members.clone().count("id as count").first();
  const notebookEligible = Number(count?.count ?? 0);
  const remaining = 12 - pins.length;
  const matches =
    remaining && notebookEligible
      ? await members
          .select("id", "version")
          .orderByRaw(
            "ts_rank_cd(search, websearch_to_tsquery('english', ?)) DESC",
            [query],
          )
          .orderBy("updatedAt", "desc")
          .orderBy("id")
          .limit(remaining)
      : [];
  const sources = [
    ...selection.notes.map((id) => pins.find((pin) => pin.id === id)!),
    ...matches,
  ].map(({ id, version }) => ({ id, version }));
  const eligible = pins.length + notebookEligible;
  return {
    sources,
    notebooks: books.map(({ id, version }) => ({ id, version })),
    coverage: {
      eligible,
      provided: sources.length,
      partial: sources.length < eligible,
      notebookEligible,
      notebookProvided: matches.length,
    },
  };
}
