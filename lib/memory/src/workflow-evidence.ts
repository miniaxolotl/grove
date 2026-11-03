import type { Knex } from "@lib/database";
import type { AssistanceResult } from "@lib/shared/assistance";
import type { WorkflowEvidenceInput } from "@lib/shared/notebook-workflows";
import { GroveError } from "@lib/shared/contracts";
import { activeNotes } from "./relationship-data.ts";
import { changedSources } from "./note-changes.ts";

export const workflowEvidenceLimits = { notes: 12, characters: 24000 } as const;

/** Scope before ranking, load bodies only for selected evidence, never drop pins. */
export async function workflowEvidence(
  trx: Knex.Transaction,
  input: WorkflowEvidenceInput,
) {
  const eligible = () =>
    activeNotes(trx).modify((query) => {
      if (input.sources)
        query.whereIn(
          "id",
          input.sources.map((ref) => ref.id),
        );
      else query.where({ projectId: input.projectId });
    });
  const counted = await eligible().count("id as count").first();
  const total = Number(counted ? Reflect.get(counted, "count") : 0);
  // PostgreSQL ranks only permitted direct members. A missing lexical match is not
  // grounds to widen the source scope or treat a notebook summary as evidence.
  const terms = [
    ...new Set(input.query.match(/[\p{L}\p{N}]{3,}/gu) ?? []),
  ].slice(0, 32);
  const query = eligible()
    .select("id", "version", "projectId", "expiresAt")
    .select(trx.raw("length(content) AS source_length"));
  if (!input.sources && terms.length)
    query.orderByRaw(
      `(${terms.map(() => "CASE WHEN content ILIKE ? THEN 1 ELSE 0 END").join("+")}) DESC`,
      terms.map((term) => `%${term}%`),
    );
  const candidates = await query
    .orderBy("id")
    .limit(input.sources ? workflowEvidenceLimits.notes : 128);
  if (
    input.sources?.some(
      (ref) =>
        !candidates.some(
          (note) => note.id === ref.id && note.version === ref.version,
        ),
    )
  )
    throw changedSources();
  let characters = 0;
  const selected = candidates
    .filter((note) => {
      const length = Number(Reflect.get(note, "sourceLength"));
      if (characters + length > workflowEvidenceLimits.characters) return false;
      characters += length;
      return true;
    })
    .slice(0, workflowEvidenceLimits.notes);
  if (input.sources && selected.length !== input.sources.length)
    throw new GroveError(
      "evidence_too_large",
      "Select fewer or shorter notes (24,000 source characters per result).",
      400,
    );
  const sources = await eligible()
    .whereIn(
      "id",
      selected.map((note) => note.id),
    )
    .orderBy("id");
  const coverage: AssistanceResult["coverage"] = {
    total,
    examined: sources.length,
    supplied: sources.length,
    cited: 0,
    partial: sources.length < total,
    ...(sources.length < total
      ? {
          reason:
            "Only the supplied notes were reviewed. Narrow the topic or select exact notes to review other evidence.",
        }
      : {}),
  };
  return { sources, coverage };
}
