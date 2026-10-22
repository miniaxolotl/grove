import type { Knex } from "@lib/database";
import {
  InferenceError,
  profileId,
  type Source,
  type GenerationProvider,
} from "@lib/ai";
import type {
  Assistance,
  AssistanceRequest,
  AssistanceResult,
} from "@lib/shared/assistance";
import type { SummaryEvidence } from "@lib/shared/summaries";
import { activeNotes } from "./relationship-data.ts";
import {
  changedSources,
  type NoteUndo,
  type ReadDependency,
} from "./note-changes.ts";

export const assistanceProfile = (generation: string, embedding?: string) =>
  profileId("assistance-v1", { generation, embedding: embedding ?? null });
export type ScopeDependency = {
  id: string;
  version?: number;
  contentVersion?: number;
};
export type AssistanceRow = Assistance & {
  accountId: string;
  input: AssistanceRequest;
  fingerprint: string;
  profile: string;
  dependencies: ReadDependency[];
  scopes: ScopeDependency[];
  state: Record<string, unknown>;
  undo: NoteUndo | null;
  application: string | null;
};
export type AssistanceStep = {
  sources: Source[];
  prompt: string;
  schema: Parameters<GenerationProvider["generate"]>[0];
  context?: {
    question: string;
    previousQuestions: string[];
    conversation?: unknown[];
  };
  finish: (value: unknown) => {
    result?: AssistanceResult;
    state?: Record<string, unknown>;
  };
};
export function groundEvidence(evidence: SummaryEvidence[], sources: Source[]) {
  if (
    evidence.some(
      (e) =>
        !sources.some(
          (s) =>
            e.id === s.id &&
            e.version === s.version &&
            s.content.includes(e.quote),
        ),
    )
  )
    throw new InferenceError("generation_invalid_citation", false);
}
export async function validAssistance(
  trx: Knex.Transaction,
  row: AssistanceRow,
) {
  if (
    row.state.expiresAt &&
    new Date(row.state.expiresAt as string) <= new Date()
  )
    throw changedSources();
  const notes = await activeNotes(trx).whereIn(
    "id",
    row.dependencies.map((r) => r.id),
  );
  if (
    row.dependencies.some(
      (ref) =>
        !notes.some(
          (note) =>
            note.id === ref.id &&
            note.version === ref.version &&
            (ref.projectId === undefined || note.projectId === ref.projectId),
        ),
    )
  )
    throw changedSources();
  const scopes = await trx("projects").whereIn(
    "id",
    row.scopes.map((s) => s.id),
  );
  if (
    row.scopes.some(
      (scope) =>
        !scopes.some(
          (p) =>
            p.id === scope.id &&
            (scope.version === undefined || scope.version === p.version) &&
            (scope.contentVersion === undefined ||
              scope.contentVersion === p.contentVersion),
        ),
    )
  )
    throw changedSources();
  if (row.kind === "filing") {
    const account = await trx("accounts").where({ id: row.accountId }).first();
    if (
      row.state.accountVersion !== account.contentVersion ||
      row.state.catalogVersion !== account.notebookCatalogVersion
    )
      throw changedSources();
  }
}
export const presentAssistance = (row: AssistanceRow): Assistance => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  version: row.version,
  result: row.result,
  error: row.error,
  applied: row.applied,
  progress: Number(row.state.progress ?? 0),
  expiresAt:
    row.expiresAt ??
    (row.state.expiresAt
      ? new Date(row.state.expiresAt as string).toISOString()
      : null),
});
