import type { Providers } from "@lib/ai";
import type { Knex, MemoryModel } from "@lib/database";
import type { Memory } from "@lib/shared/contracts";
import type { Annotation, Organization } from "@lib/shared/models";
import { legacyRelationshipsFor } from "./relationship-data.ts";

/** Read page metadata in bounded batches. RLS and exact revision/profile matches
 * apply to every read; embedding values never leave PostgreSQL for presentation. */
export async function presentMemories(
  trx: Knex.Transaction,
  rows: MemoryModel[],
  providers: Providers,
): Promise<Memory[]> {
  if (!rows.length) return [];
  const now = Date.now();
  const active = rows.filter(
    (row) =>
      row.status === "active" &&
      (!row.expiresAt || new Date(row.expiresAt).getTime() > now),
  );
  const revisions = active.map((row) => [row.id, row.version]);
  const account = active.length ? await trx("accounts").first() : undefined;
  const decision = account?.classificationEnabled
    ? providers.decision?.profile
    : undefined;
  const generation = account?.titlesTagsEnabled
    ? providers.generation?.profile
    : undefined;
  const profiles = [decision, generation].filter(
    (profile): profile is string => !!profile,
  );
  const embeddings =
    providers.embedding && active.length
      ? await trx("memory_embeddings")
          .whereIn(["memoryId", "version"], revisions)
          .where({ profile: providers.embedding.profile })
          .select("memoryId")
      : [];
  const records = profiles.length
    ? await trx("memory_enrichments")
        .whereIn(["memoryId", "version"], revisions)
        .whereIn("profile", profiles)
        .select("memoryId", "kind", "profile", "data")
    : [];
  const jobs = active.length
    ? await trx("jobs")
        .whereIn(["memoryId", "version"], revisions)
        .where((query) => {
          query.whereRaw("false");
          if (providers.embedding)
            query.orWhere({
              kind: "embedding",
              profile: providers.embedding.profile,
            });
          if (decision) query.orWhere({ kind: "decision", profile: decision });
          if (generation)
            query.orWhere({ kind: "organization", profile: generation });
        })
        .select("memoryId", "kind", "failedAt")
    : [];
  const relationships = await legacyRelationshipsFor(
    trx,
    active.map((row) => row.id),
    providers,
  );
  const ready = new Set(embeddings.map((row) => row.memoryId));
  const iso = (value: Date | string | null) =>
    value === null ? null : new Date(value).toISOString();
  return rows.map((row) => {
    const enabled =
      row.status === "active" &&
      (!row.expiresAt || new Date(row.expiresAt).getTime() > now);
    const enrichment = records.filter(
      (record) =>
        record.memoryId === row.id &&
        ((record.kind === "decision" && record.profile === decision) ||
          (record.kind === "organization" && record.profile === generation)),
    );
    const pending = jobs.filter(
      (job) => job.memoryId === row.id && job.kind !== "embedding",
    );
    const classified = enrichment.find((record) => record.kind === "decision")
      ?.data as Annotation | undefined;
    const organized = enrichment.find(
      (record) => record.kind === "organization",
    )?.data as Organization | undefined;
    return {
      id: row.id,
      projectId: row.projectId,
      content: row.content,
      kind: row.kind,
      autoKind: row.autoKind,
      status: row.status,
      version: row.version,
      source: row.source,
      taskId: row.taskId,
      retentionDays: row.retentionDays,
      expiresAt: iso(row.expiresAt),
      purgeAt: iso(row.purgeAt),
      createdAt: iso(row.createdAt)!,
      updatedAt: iso(row.updatedAt)!,
      indexing:
        !providers.embedding || !enabled
          ? "disabled"
          : ready.has(row.id)
            ? "ready"
            : jobs.some(
                  (job) =>
                    job.memoryId === row.id &&
                    job.kind === "embedding" &&
                    job.failedAt,
                )
              ? "failed"
              : "pending",
      enrichment: !enabled
        ? { status: "disabled", tags: [], relationships: [], profiles: [] }
        : {
            status: pending.some((job) => job.failedAt)
              ? "failed"
              : pending.length
                ? "pending"
                : enrichment.length
                  ? "ready"
                  : "disabled",
            title: organized?.title,
            tags: account?.titlesTagsEnabled
              ? [
                  ...new Set([
                    ...(classified?.topics ?? []),
                    ...(organized?.tags ?? []),
                  ]),
                ].slice(0, 10)
              : [],
            suggestedKind: classified?.kind,
            salience: classified?.salience,
            relationships: relationships.get(row.id) ?? [],
            profiles: enrichment.map((record) => record.profile),
          },
    };
  });
}
