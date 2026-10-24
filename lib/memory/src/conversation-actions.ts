import { randomUUID } from "node:crypto";
import { type Knex, MemoryModel } from "@lib/database";
import { type Principal } from "@lib/shared/contracts";
import type {
  OrganizationChanges,
  OrganizationProposal,
  ConversationScope,
} from "@lib/shared/conversations";
import type { SourceRef } from "@lib/shared/models";
import type { MemoryService } from "./index.ts";
import { inConversationScope as scopeAllows } from "./conversation-scope.ts";
import {
  applyNoteChanges,
  changedSources,
  type NoteUndo,
} from "./note-changes.ts";

type Notebook = SourceRef & {
  name: string;
  identity: string;
  parentId: string | null;
  status: string;
};
export type OrganizationUndo = {
  notes: NoteUndo;
  applied: SourceRef[];
  notebooks: (Notebook & { created: boolean })[];
};

export function organizationPreview(
  changes: OrganizationChanges,
  sources: SourceRef[],
  notebooks: Notebook[],
  coverage: OrganizationProposal["coverage"],
  scope: ConversationScope,
): OrganizationProposal {
  if (
    [...changes.renames, ...(changes.notebookMoves ?? [])].some(
      (item) => !scopeAllows(scope, item.id),
    )
  )
    throw changedSources();
  if (
    !changes.notebooks.length &&
    !changes.renames.length &&
    !changes.moves.length &&
    !changes.notebookMoves?.length &&
    !changes.notes.length
  )
    throw changedSources();
  if (
    new Set(changes.notebooks.map((n) => n.key)).size !==
      changes.notebooks.length ||
    new Set(changes.moves.map((n) => n.id)).size !== changes.moves.length ||
    new Set(
      [...changes.renames, ...(changes.notebookMoves ?? [])].map((n) => n.id),
    ).size !==
      changes.renames.length + (changes.notebookMoves?.length ?? 0)
  )
    throw changedSources();
  const refs = new Set<string>();
  function destination(id: string | null, visiting = new Set<string>()): void {
    if (id === null) return;
    if (id.startsWith("new:")) {
      const node = changes.notebooks.find((n) => `new:${n.key}` === id);
      if (!node || visiting.has(id)) throw changedSources();
      destination(node.parent, new Set([...visiting, id]));
    } else {
      if (!notebooks.some((n) => n.id === id && n.status === "active"))
        throw changedSources();
      refs.add(id);
    }
  }
  for (const notebook of changes.notebooks) destination(`new:${notebook.key}`);
  for (const move of changes.moves) {
    if (!sources.some((s) => s.id === move.id && s.version === move.version))
      throw changedSources();
    destination(move.destination);
  }
  for (const note of changes.notes) destination(note.destination);
  for (const rename of changes.renames) {
    if (
      !notebooks.some((n) => n.id === rename.id && n.version === rename.version)
    )
      throw changedSources();
    refs.add(rename.id);
  }
  for (const move of changes.notebookMoves ?? []) {
    if (
      !notebooks.some(
        (n) =>
          n.id === move.id &&
          n.version === move.version &&
          n.status === "active",
      )
    )
      throw changedSources();
    refs.add(move.id);
    destination(move.destination);
  }
  return {
    ...changes,
    status: "proposed",
    notebookRefs: notebooks
      .filter((n) => refs.has(n.id))
      .map(({ id, version, name }) => ({ id, version, name })),
    coverage,
  };
}

export async function applyOrganization(
  service: MemoryService,
  principal: Principal,
  trx: Knex.Transaction,
  turnId: string,
  proposal: OrganizationProposal,
  scope: ConversationScope,
  revise: (trx: Knex.Transaction, row: MemoryModel) => Promise<void>,
  undo?: OrganizationUndo,
): Promise<{
  undo: OrganizationUndo;
  applied: SourceRef[];
  createdNotebooks: string[];
}> {
  const notebooks = await trx<Notebook>("projects")
    .select("id", "version", "name", "identity", "parentId", "status")
    .orderBy("id")
    .forUpdate();
  const refs = undo?.notebooks ?? proposal.notebookRefs;
  const domain = service.inTransaction(trx);
  if (
    [...proposal.renames, ...(proposal.notebookMoves ?? [])].some(
      (item) => !scopeAllows(scope, item.id),
    )
  )
    throw changedSources();
  if (
    refs.some(
      (ref) =>
        !notebooks.some(
          (n) =>
            n.id === ref.id &&
            n.version === ref.version &&
            n.status === "active",
        ),
    )
  )
    throw changedSources();
  if (undo) {
    const created = undo.notebooks.filter((n) => n.created).map((n) => n.id);
    if (created.length) {
      const extraNotes = await trx("memories")
        .whereIn("projectId", created)
        .whereNotIn(
          "id",
          undo.applied.map((n) => n.id),
        )
        .first("id");
      const extraChildren = await trx("projects")
        .whereIn("parentId", created)
        .whereNotIn(
          "id",
          undo.notebooks.map((n) => n.id),
        )
        .first("id");
      if (extraNotes || extraChildren) throw changedSources();
    }
    const { applied } = await applyNoteChanges(
      trx,
      principal.accountId,
      undo.applied,
      undo.notes.map((note) => ({
        ...note,
        version: undo.applied.find((ref) => ref.id === note.id)!.version,
      })),
      revise,
      { undo: true },
    );
    for (const original of [...undo.notebooks].sort(
      (a, b) => Number(a.created) - Number(b.created),
    )) {
      if (original.created) {
        await trx("projects")
          .where({ id: original.id })
          .update({
            status: "archived",
            archiveOperationId: turnId,
            version: original.version + 1,
          });
      } else
        await domain.updateNotebook(principal, {
          operationId: randomUUID(),
          id: original.id,
          expectedVersion: original.version,
          name: original.name,
          parentId: original.parentId,
        });
    }
    return { undo, applied, createdNotebooks: created };
  }
  // Validate the complete source set before creating any destination. All writes
  // below share the outer account-locked transaction, including domain savepoints.
  const rows = await MemoryModel.query(trx)
    .whereIn(
      "id",
      proposal.moves.map((move) => move.id),
    )
    .forUpdate();
  if (
    proposal.moves.some(
      (move) =>
        !rows.some(
          (row) =>
            row.id === move.id &&
            row.version === move.version &&
            row.status === "active" &&
            scopeAllows(scope, row.projectId) &&
            (!row.expiresAt || new Date(row.expiresAt) > new Date()),
        ),
    )
  )
    throw changedSources();
  const created = new Map<string, string>();
  const notebookUndo: OrganizationUndo["notebooks"] = [];
  async function resolve(id: string | null): Promise<string | null> {
    if (!id?.startsWith("new:")) return id;
    if (created.has(id)) return created.get(id)!;
    const requested = proposal.notebooks.find((n) => `new:${n.key}` === id)!;
    const parentId = await resolve(requested.parent);
    const notebook = await domain.project(principal, {
      name: requested.name,
      identity: `ask:${turnId}:${requested.key}`,
      parentId,
    });
    created.set(id, notebook.id);
    notebookUndo.push({
      ...notebook,
      version: notebook.version!,
      parentId: notebook.parentId ?? null,
      status: notebook.status!,
      created: true,
    });
    return notebook.id;
  }
  for (const notebook of proposal.notebooks)
    await resolve(`new:${notebook.key}`);
  for (const rename of proposal.renames) {
    const original = notebooks.find((n) => n.id === rename.id)!;
    const changed = await domain.project(
      principal,
      {
        name: rename.name,
        identity: original.identity,
        expectedVersion: rename.version,
      },
      rename.id,
    );
    notebookUndo.push({
      ...original,
      version: changed.version!,
      created: false,
    });
  }
  for (const move of proposal.notebookMoves ?? []) {
    const original = notebooks.find((n) => n.id === move.id)!;
    const changed = await domain.updateNotebook(principal, {
      operationId: randomUUID(),
      id: move.id,
      expectedVersion: move.version,
      parentId: await resolve(move.destination),
    });
    notebookUndo.push({
      ...original,
      version: changed.version!,
      created: false,
    });
  }
  const writes = [
    ...(await Promise.all(
      proposal.moves.map(async (move) => ({
        id: move.id,
        version: move.version,
        projectId: await resolve(move.destination),
      })),
    )),
    ...(await Promise.all(
      proposal.notes.map(async (note) => ({
        content: note.content,
        projectId: await resolve(note.destination),
      })),
    )),
  ];
  const { originals, applied } = await applyNoteChanges(
    trx,
    principal.accountId,
    proposal.moves,
    writes,
    revise,
    { allowed: (id) => scopeAllows(scope, id) },
  );
  return {
    undo: { notes: originals, applied, notebooks: notebookUndo },
    applied,
    createdNotebooks: [...created.values()],
  };
}
