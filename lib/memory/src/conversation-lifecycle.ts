import { randomUUID } from "node:crypto";
import { MemoryModel, type Knex } from "@lib/database";
import { GroveError, type Memory, type Principal } from "@lib/shared/contracts";
import type {
  ConversationScope,
  LifecycleChanges,
  LifecycleProposal,
} from "@lib/shared/conversations";
import type { NotebookLifecyclePreview } from "@lib/shared/notebook-lifecycle";
import type { SourceRef } from "@lib/shared/models";
import type { MemoryService } from "./index.ts";
import { inConversationScope } from "./conversation-scope.ts";
import { changedSources } from "./note-changes.ts";

export type LifecycleUndo = {
  lifecycle: true;
  notes: {
    id: string;
    version: number;
    status: "active" | "archived";
    expiresAt: Date | string | null;
    purgeAt: Date | string | null;
  }[];
  notebooks: NotebookLifecyclePreview[];
};

export async function lifecyclePreview(
  service: MemoryService,
  principal: Principal,
  trx: Knex.Transaction,
  changes: LifecycleChanges,
  sources: Memory[],
  notebooks: SourceRef[],
  scope: ConversationScope,
): Promise<LifecycleProposal> {
  if (!changes.notes.length && !changes.notebooks.length)
    throw changedSources();
  if (
    new Set(changes.notes.map((n) => n.id)).size !== changes.notes.length ||
    new Set(changes.notebooks.map((n) => n.id)).size !==
      changes.notebooks.length
  )
    throw changedSources();
  for (const ref of changes.notes) {
    const note = sources.find(
      (n) => n.id === ref.id && n.version === ref.version,
    );
    if (
      !note ||
      !inConversationScope(scope, note.projectId) ||
      (changes.action === "archive" && note.status !== "active") ||
      (changes.action === "restore" &&
        note.status !== "archived" &&
        (!note.expiresAt || new Date(note.expiresAt) > new Date()))
    )
      throw changedSources();
  }
  const notebookPreviews: NotebookLifecyclePreview[] = [];
  const covered = new Set<string>();
  for (const ref of changes.notebooks) {
    if (
      !inConversationScope(scope, ref.id) ||
      !notebooks.some(
        (item) => item.id === ref.id && item.version === ref.version,
      )
    )
      throw changedSources();
    const preview = await service
      .inTransaction(trx)
      .previewProjectLifecycle(principal, ref.id);
    if (
      preview.project.version !== ref.version ||
      preview.projectIds.some(
        (id) => covered.has(id) || !inConversationScope(scope, id),
      ) ||
      (changes.action === "archive" && preview.project.status !== "active") ||
      (changes.action === "restore" && !preview.canRestore)
    )
      throw changedSources();
    preview.projectIds.forEach((id) => covered.add(id));
    notebookPreviews.push(preview);
  }
  if (
    changes.notes.some((ref) =>
      covered.has(sources.find((n) => n.id === ref.id)!.projectId ?? ""),
    )
  )
    throw changedSources();
  return { ...changes, notebookPreviews, status: "proposed" };
}

export async function applyLifecycle(
  service: MemoryService,
  principal: Principal,
  trx: Knex.Transaction,
  proposal: LifecycleProposal,
  scope: ConversationScope,
  undo?: LifecycleUndo,
) {
  if (undo && proposal.action === "delete")
    throw new GroveError(
      "not_undoable",
      "Deleted notes and notebooks cannot be restored here.",
      409,
    );
  const domain = service.inTransaction(trx);
  const refs = undo?.notes ?? proposal.notes;
  const notes = await MemoryModel.query(trx)
    .whereIn(
      "id",
      refs.map((n) => n.id),
    )
    .orderBy("id")
    .forUpdate();
  if (
    refs.some(
      (ref) =>
        !notes.some(
          (n) =>
            n.id === ref.id &&
            n.version === ref.version &&
            inConversationScope(scope, n.projectId),
        ),
    )
  )
    throw changedSources();
  const notebooks = undo?.notebooks ?? proposal.notebookPreviews;
  // Validate every dependency before a mutation changes the account fingerprint.
  for (const expected of notebooks) {
    const current = await domain.previewProjectLifecycle(
      principal,
      expected.project.id,
    );
    if (
      current.project.version !== expected.project.version ||
      current.fingerprint !== expected.fingerprint ||
      current.projectIds.some((id) => !inConversationScope(scope, id))
    )
      throw new GroveError(
        "version_conflict",
        "Your notebooks or notes changed. Review the affected contents again.",
        409,
      );
  }
  const originals: LifecycleUndo["notes"] = [];
  const applied: { id: string; version: number }[] = [];
  for (const note of notes) {
    let version = note.version + 1;
    if (undo) {
      const before = undo.notes.find((n) => n.id === note.id)!;
      const restored = await MemoryModel.query(trx).patchAndFetchById(note.id, {
        status: before.status,
        expiresAt: before.expiresAt as Date | null,
        purgeAt: before.purgeAt as Date | null,
        version,
        updatedAt: trx.fn.now(),
      });
      await service.revise(trx, restored);
    } else if (proposal.action === "delete") {
      const result = await domain.forget(principal, {
        operationId: randomUUID(),
        items: [{ id: note.id, expectedVersion: note.version }],
      });
      if (result.results[0].outcome !== "deleted") throw changedSources();
      version = note.version;
    } else {
      const changed = await domain.lifecycle(
        principal,
        note.id,
        proposal.action,
        { operationId: randomUUID(), expectedVersion: note.version },
      );
      version = changed.version;
    }
    originals.push({
      id: note.id,
      version,
      status: note.status,
      expiresAt: note.expiresAt,
      purgeAt: note.purgeAt,
    });
    applied.push({ id: note.id, version });
  }
  for (const expected of notebooks) {
    const current = await domain.previewProjectLifecycle(
      principal,
      expected.project.id,
    );
    await domain.projectLifecycle(
      principal,
      expected.project.id,
      undo
        ? proposal.action === "archive"
          ? "restore"
          : "archive"
        : proposal.action,
      {
        operationId: randomUUID(),
        expectedVersion: current.project.version!,
        fingerprint: current.fingerprint,
      },
    );
  }
  const next: NotebookLifecyclePreview[] = [];
  if (proposal.action !== "delete")
    for (const item of notebooks)
      next.push(
        await domain.previewProjectLifecycle(principal, item.project.id),
      );
  return {
    applied,
    undo: { lifecycle: true as const, notes: originals, notebooks: next },
  };
}
