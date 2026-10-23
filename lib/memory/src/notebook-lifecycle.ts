import { createHash } from "node:crypto";
import type { Knex } from "@lib/database";
import { GroveError } from "@lib/shared/contracts";
import type {
  NotebookLifecycleAction,
  NotebookLifecycleInput,
  NotebookLifecyclePreview,
  NotebookLifecycleResult,
} from "@lib/shared/notebook-lifecycle";
import type { ModelProfiles } from "@lib/shared/models";
import { relationshipProfile } from "./relationship-data.ts";

/** Called under the ordinary account mutation lock, including when previewing. */
export async function previewNotebookLifecycle(
  trx: Knex.Transaction,
  accountId: string,
  id: string,
): Promise<NotebookLifecyclePreview> {
  const project = await trx("projects")
    .where({ id })
    .first("id", "name", "identity", "parentId", "version", "status");
  if (!project) throw new GroveError("not_found", "Notebook not found", 404);
  const { rows } = await trx.raw(
    `WITH RECURSIVE subtree(id) AS (
    SELECT id FROM projects WHERE id=?
    UNION SELECT p.id FROM projects p JOIN subtree s ON p.parent_id=s.id
  ) SELECT array_agg(id ORDER BY id) AS ids FROM subtree`,
    [id],
  );
  const projectIds = rows[0].ids as string[];
  const count = await trx("memories")
    .whereIn("projectId", projectIds)
    .count("id AS total")
    .first();
  const account = await trx("accounts")
    .where({ id: accountId })
    .first("contentVersion", "changeToken", "notebookCatalogVersion");
  const parent = project.parentId
    ? await trx("projects").where({ id: project.parentId }).first("status")
    : undefined;
  return {
    project,
    projectIds,
    notebooks: projectIds.length,
    notes: Number(count?.total ?? 0),
    // Conservative: unrelated concurrent edits also require explicit re-review.
    fingerprint: createHash("sha256")
      .update(JSON.stringify({ id, ...account }))
      .digest("hex"),
    canRestore:
      project.status === "archived" &&
      (!project.parentId || parent?.status === "active"),
  };
}

export async function applyNotebookLifecycle(
  trx: Knex.Transaction,
  accountId: string,
  id: string,
  action: NotebookLifecycleAction,
  input: NotebookLifecycleInput,
  profiles: ModelProfiles,
): Promise<NotebookLifecycleResult> {
  const preview = await previewNotebookLifecycle(trx, accountId, id);
  if (
    preview.project.version !== input.expectedVersion ||
    preview.fingerprint !== input.fingerprint
  )
    throw new GroveError(
      "version_conflict",
      "Your notebooks or notes changed. Review the affected contents again.",
      409,
    );
  if (
    (action === "archive" && preview.project.status !== "active") ||
    (action === "restore" && !preview.canRestore)
  )
    throw new GroveError(
      "notebook_inactive",
      "Restore the parent notebook first, or review this notebook's current state.",
      409,
    );
  const ids = preview.projectIds;
  const archived = await trx("projects")
    .where({ id })
    .first("archiveOperationId");
  const projectQuery = () => trx("projects").whereIn("id", ids);
  const notes = () => trx("memories").whereIn("projectId", ids);
  if (action === "delete") {
    // Migration 014 intercepts DELETE before row removal and writes tombstones
    // under its narrow SECURITY DEFINER trigger. Direct UPDATE cannot cross the
    // restrictive visibility policy. Authored rows and revisions remain retained.
    await notes().delete();
    await projectQuery().delete();
    return { action, projectIds: ids };
  }
  // Revocation is deliberate and permanent: restoring never republishes a link.
  await trx("public_shares")
    .where((q) =>
      q.whereIn("projectId", ids).orWhereIn("memoryId", notes().select("id")),
    )
    .whereNull("revokedAt")
    .update({
      revokedAt: trx.fn.now(),
      tokenDigest: null,
      tokenCiphertext: null,
      version: trx.raw("version+1"),
    });
  if (action === "restore")
    await projectQuery()
      .where({ archiveOperationId: archived.archiveOperationId })
      .update({
        status: "active",
        archiveOperationId: null,
        version: trx.raw("version+1"),
      });
  // One set-based revision write, not one HTTP-sized save per note. Lifetimes stay unchanged.
  await trx.raw(
    `WITH changed AS (
    UPDATE memories SET status=?,archive_operation_id=?,version=version+1,updated_at=now()
      WHERE project_id=ANY(?::uuid[]) AND status=? ${action === "restore" ? "AND archive_operation_id=?" : ""}
    RETURNING account_id,id,version,content,source
  ) INSERT INTO memory_revisions(account_id,memory_id,version,content,source)
    SELECT account_id,id,version,content,source FROM changed`,
    [
      action === "archive" ? "archived" : "active",
      action === "archive" ? input.operationId : null,
      ids,
      action === "archive" ? "active" : "archived",
      ...(action === "restore" ? [archived.archiveOperationId] : []),
    ],
  );
  if (action === "archive")
    await projectQuery()
      .where({ status: "active" })
      .update({
        status: "archived",
        archiveOperationId: input.operationId,
        version: trx.raw("version+1"),
      });
  for (const table of ["jobs", "memory_embeddings", "memory_enrichments"])
    await trx(table).whereIn("memoryId", notes().select("id")).delete();
  for (const table of ["memory_briefs", "jobs"])
    await trx(table)
      .whereRaw("scope->>'projectId'=ANY(?::text[])", [ids])
      .delete();
  for (const table of [
    "notebook_profiles",
    "notebook_summary_nodes",
    "notebook_summary_work",
  ])
    await trx(table).whereIn("projectId", ids).delete();
  if (action === "restore") {
    const account = await trx("accounts").where({ id: accountId }).first();
    const kinds = [
      ["embedding", profiles.embedding],
      ["decision", account.classificationEnabled && profiles.decision],
      ["organization", account.titlesTagsEnabled && profiles.generation],
      [
        "relationship_scan",
        account.noteConnectionsEnabled && relationshipProfile(profiles),
      ],
    ] as const;
    for (const [kind, profile] of kinds) {
      if (!profile) continue;
      await trx.raw(
        `INSERT INTO jobs(account_id,memory_id,version,target,kind,profile,scope)
        SELECT account_id,id,version,id::text,?,?, '{}'::jsonb FROM memories
        WHERE project_id=ANY(?::uuid[]) AND status='active' AND (expires_at IS NULL OR expires_at>now())
        ON CONFLICT(account_id,kind,target,profile) DO NOTHING`,
        [kind, profile, ids],
      );
    }
    await trx("accounts")
      .where({ id: accountId })
      .update({ organizationDueAt: trx.fn.now() });
  }
  return { action, projectIds: ids };
}
