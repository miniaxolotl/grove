import { MemoryModel, camelRows, tenant, type Knex } from "@lib/database";
import { currentTelemetry } from "@lib/telemetry/context";
import {
  InferenceError,
  type Embedder,
  type Providers,
  type Source,
  type InferenceOptions,
} from "@lib/ai";
import {
  briefContentSchema,
  organizationSchema,
  type Brief,
  type BriefRequest,
  type Enrichment,
  type SourceRef,
  type Usage,
  type Annotation,
  type Organization,
  type ModelProfiles,
} from "@lib/shared/models";
import {
  currentRelationshipProfile,
  enqueueRelationship,
  legacyRelationshipsFor,
  relationshipKinds,
  relationshipProfile,
} from "./relationship-data.ts";
import {
  runRelationshipJob,
  type RelationshipJob,
} from "./relationship-jobs.ts";

export const briefTarget = (scope: BriefRequest) =>
  `${scope.projectId ?? "personal"}${scope.taskId ? `:task:${scope.taskId}` : ""}`;
export const providerProfiles = (providers: Providers) => [
  ...Object.values(providers)
    .filter(Boolean)
    .map((provider) => provider!.profile),
  ...[currentRelationshipProfile(providers)].filter((p): p is string => !!p),
];
export async function registerEmbedding(db: Knex, embedder: Embedder) {
  await db("embedding_profiles")
    .insert({
      id: embedder.profile,
      model: embedder.model,
      dimensions: embedder.dimensions,
    })
    .onConflict("id")
    .ignore();
  const row = await db("embedding_profiles")
    .where({ id: embedder.profile })
    .first();
  if (row.dimensions !== embedder.dimensions)
    throw new InferenceError("embedding_profile_mismatch", false);
}
const eligible = (trx: Knex.Transaction) =>
  MemoryModel.query(trx)
    .where({ status: "active" })
    .where((b) =>
      b.whereNull("expiresAt").orWhere("expiresAt", ">", trx.fn.now()),
    );
const source = (row: MemoryModel): Source => ({
  id: row.id,
  version: row.version,
  content: row.content,
  kind: row.kind,
  verification: row.source.verification,
});

export async function queueBrief(
  trx: Knex.Transaction,
  accountId: string,
  scope: BriefRequest,
  profile: string,
  delay = 5,
) {
  await trx("jobs")
    .insert({
      accountId,
      target: briefTarget(scope),
      kind: "brief",
      profile,
      scope: JSON.stringify(scope),
      dueAt: trx.raw("now() + (? * interval '1 second')", [delay]),
    })
    .onConflict(["accountId", "kind", "target", "profile"])
    .merge({
      attempts: 0,
      failedAt: null,
      errorCode: null,
      leaseId: null,
      leaseUntil: null,
      dueAt: trx.raw("now() + (? * interval '1 second')", [delay]),
    });
}
export async function invalidateBriefs(
  trx: Knex.Transaction,
  accountId: string,
) {
  const old = await trx("memory_briefs").select("scope", "profile");
  await trx("memory_briefs").delete();
  for (const row of old)
    await queueBrief(trx, accountId, row.scope, row.profile);
  await trx("jobs")
    .where({ kind: "brief" })
    .update({
      attempts: 0,
      failedAt: null,
      leaseId: null,
      leaseUntil: null,
      dueAt: trx.raw("now() + interval '5 seconds'"),
    });
}
export async function queueMemory(
  trx: Knex.Transaction,
  row: MemoryModel,
  providers: Providers,
  profiles: ModelProfiles = {
    embedding: providers.embedding?.profile ?? null,
    decision: providers.decision?.profile ?? null,
    generation: providers.generation?.profile ?? null,
  },
) {
  await trx("jobs").where({ memoryId: row.id }).delete();
  await trx("memory_enrichments").where({ memoryId: row.id }).delete();
  if (
    row.status !== "active" ||
    (row.expiresAt && new Date(row.expiresAt) <= new Date())
  )
    return;
  const account = await trx("accounts").where({ id: row.accountId }).first();
  const connectionProfile = relationshipProfile(profiles);
  if (account.organizeEnabled && connectionProfile)
    await enqueueRelationship(
      trx,
      row.accountId,
      "relationship_scan",
      row.id,
      connectionProfile,
      {},
      row,
    );
  for (const [kind, provider] of [
    ["embedding", profiles.embedding],
    ["decision", account.organizeEnabled ? profiles.decision : undefined],
    ["organization", account.organizeEnabled ? profiles.generation : undefined],
  ] as const) {
    if (provider)
      await trx("jobs").insert({
        accountId: row.accountId,
        memoryId: row.id,
        version: row.version,
        target: row.id,
        kind,
        profile: provider,
      });
  }
  if (profiles.generation && account.summariesEnabled) {
    await queueBrief(
      trx,
      row.accountId,
      { projectId: row.projectId },
      profiles.generation,
    );
    if (row.taskId)
      await queueBrief(
        trx,
        row.accountId,
        { projectId: row.projectId, taskId: row.taskId },
        profiles.generation,
      );
  }
}

async function validSources(
  trx: Knex.Transaction,
  refs: SourceRef[],
  scope: BriefRequest,
) {
  if (!refs.length) return true;
  const rows = await eligible(trx)
    .where({ projectId: scope.projectId })
    .whereIn(
      "id",
      refs.map((ref) => ref.id),
    );
  return refs.every((ref) =>
    rows.some(
      (row) =>
        row.id === ref.id &&
        row.version === ref.version &&
        (!scope.taskId || row.taskId === scope.taskId),
    ),
  );
}
export async function enrichmentFor(
  trx: Knex.Transaction,
  row: MemoryModel,
  providers: Providers,
  suppliedRelationships?: Enrichment["relationships"],
): Promise<Enrichment> {
  if (
    row.status !== "active" ||
    (row.expiresAt && new Date(row.expiresAt) <= new Date())
  )
    return { status: "disabled", tags: [], relationships: [], profiles: [] };
  const profiles = [
    providers.decision?.profile,
    providers.generation?.profile,
  ].filter((p): p is string => !!p);
  if (!profiles.length)
    return { status: "disabled", tags: [], relationships: [], profiles: [] };
  const records = await trx("memory_enrichments")
    .where({ memoryId: row.id, version: row.version })
    .whereIn("profile", profiles);
  const pending = await trx("jobs")
    .where({ memoryId: row.id, version: row.version })
    .whereIn("kind", ["decision", "organization"])
    .whereIn("profile", profiles)
    .select("failedAt");
  const classified = records.find((r) => r.kind === "decision") as
    | { data: Annotation; sources: SourceRef[] }
    | undefined;
  const organized = records.find((r) => r.kind === "organization") as
    | { data: Organization }
    | undefined;
  const relationships =
    suppliedRelationships ??
    (await legacyRelationshipsFor(trx, [row.id], providers)).get(row.id)!;
  return {
    status: pending.some((j) => j.failedAt)
      ? "failed"
      : pending.length
        ? "pending"
        : records.length
          ? "ready"
          : "disabled",
    title: organized?.data.title,
    tags: [
      ...new Set([
        ...(classified?.data.topics ?? []),
        ...(organized?.data.tags ?? []),
      ]),
    ].slice(0, 10),
    suggestedKind: classified?.data.kind,
    salience: classified?.data.salience,
    relationships,
    profiles: records.map((r) => r.profile),
  };
}
export async function briefFor(
  trx: Knex.Transaction,
  accountId: string,
  scope: BriefRequest,
  providers: Providers,
): Promise<Brief> {
  const empty: Brief = {
    scope,
    status: "disabled",
    content: null,
    profile: providers.generation?.profile ?? null,
    updatedAt: null,
    sourceCount: 0,
    truncated: false,
  };
  if (!providers.generation) return empty;
  const account = await trx("accounts").where({ id: accountId }).first();
  if (!account.summariesEnabled) return empty;
  const target = briefTarget(scope),
    profile = providers.generation.profile;
  const row = await trx("memory_briefs").where({ target, profile }).first();
  if (
    row &&
    row.contentVersion === account.contentVersion &&
    (await validSources(trx, row.sources, scope))
  ) {
    return {
      ...empty,
      status: "ready",
      content: row.content,
      updatedAt: new Date(row.createdAt).toISOString(),
      sourceCount: row.sources.length,
      truncated: row.truncated,
    };
  }
  const job = await trx("jobs")
    .where({ kind: "brief", target, profile })
    .first();
  // Expiry can invalidate a brief without a write. Hide it immediately and schedule a replacement.
  if (row) await trx("memory_briefs").where({ target, profile }).delete();
  if (!job)
    await trx("jobs")
      .insert({
        accountId,
        target,
        kind: "brief",
        profile,
        scope: JSON.stringify(scope),
      })
      .onConflict(["accountId", "kind", "target", "profile"])
      .ignore();
  return { ...empty, status: job?.failedAt ? "failed" : "pending" };
}

type Job = {
  id: string;
  accountId: string;
  memoryId: string | null;
  version: number | null;
  kind: "embedding" | "decision" | "organization" | "brief";
  target: string;
  scope: BriefRequest | null;
  profile: string;
  leaseId: string;
  attempts: number;
};
async function reserve(
  trx: Knex.Transaction,
  accountId: string,
  role: string,
  limit: number,
) {
  await trx.raw("SELECT pg_advisory_xact_lock(hashtextextended(?, 6))", [
    accountId,
  ]);
  const result = await trx("inference_usage")
    .whereRaw("day = CURRENT_DATE")
    .sum("requests as count")
    .first();
  if (Number(result?.count ?? 0) >= limit) return false;
  await trx.raw(
    `INSERT INTO inference_usage(account_id, role, requests) VALUES (?, ?, 1)
    ON CONFLICT(account_id, day, role) DO UPDATE SET requests = inference_usage.requests + 1`,
    [accountId, role],
  );
  return true;
}
export async function queryEmbedding(
  db: Knex,
  accountId: string,
  embedder: Embedder,
  text: string,
  limit: number,
  signal?: AbortSignal,
) {
  return budgetedInference(db, accountId, "embedding", limit, (options) =>
    embedder.embed(text, "query", {
      ...options,
      signal: AbortSignal.any([
        AbortSignal.timeout(850),
        ...(signal ? [signal] : []),
      ]),
    }),
  );
}
export async function budgetedInference<T>(
  db: Knex,
  accountId: string,
  role: string,
  limit: number,
  run: (options: InferenceOptions) => Promise<T>,
) {
  const allowed = await tenant(db, accountId, (trx) =>
    reserve(trx, accountId, role, limit),
  );
  if (!allowed) throw new InferenceError("inference_budget");
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  try {
    return await run({
      onUsage: (value) => {
        usage = value;
      },
    });
  } finally {
    await recordUsage(db, accountId, role, usage);
  }
}
async function recordUsage(
  db: Knex,
  accountId: string,
  role: string,
  usage: Usage,
) {
  if (!usage.inputTokens && !usage.outputTokens) return;
  await tenant(db, accountId, async (trx) => {
    await trx("inference_usage")
      .where({ accountId, role })
      .whereRaw("day = CURRENT_DATE")
      .increment({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
  });
}
export async function runProcessingJob(
  db: Knex,
  providers: Providers,
  dailyLimit: number,
  wantedId?: string,
  resolveProfiles?: (trx: Knex.Transaction) => Promise<ModelProfiles>,
): Promise<boolean> {
  const profiles = providerProfiles(providers);
  if (!profiles.length) return false;
  const claimed = camelRows<Job | RelationshipJob>(
    await db.raw("SELECT * FROM grove_claim_job(?::text[], ?::uuid)", [
      profiles,
      wantedId ?? null,
    ]),
  )[0];
  if (!claimed) return false;
  if ((relationshipKinds as readonly string[]).includes(claimed.kind))
    return runRelationshipJob(
      db,
      providers,
      dailyLimit,
      claimed as RelationshipJob,
      resolveProfiles,
    );
  const job = claimed as Job;
  const started = performance.now();
  let completed = false;
  let failed = false;
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const role =
    job.kind === "embedding"
      ? "embedding"
      : job.kind === "decision"
        ? "decision"
        : "generation";
  try {
    const input = await tenant(db, job.accountId, async (trx) => {
      const account = await trx("accounts")
        .where({ id: job.accountId, status: "active" })
        .forShare()
        .first();
      const finish = () =>
        trx("jobs").where({ id: job.id, leaseId: job.leaseId }).delete();
      if (
        !account ||
        ((job.kind === "decision" || job.kind === "organization") &&
          !account.organizeEnabled) ||
        (job.kind === "brief" && !account.summariesEnabled)
      ) {
        await finish();
        return;
      }
      let rows: MemoryModel[];
      let candidates: MemoryModel[] = [];
      if (job.kind === "brief") {
        const query = eligible(trx).where({ projectId: job.scope!.projectId });
        if (job.scope!.taskId)
          query.where({ taskId: job.scope!.taskId, kind: "handoff" });
        rows = await query.orderBy("updatedAt", "desc").limit(81);
      } else {
        const memory = await eligible(trx)
          .findById(job.memoryId!)
          .where({ version: job.version! });
        if (!memory) {
          await finish();
          return;
        }
        rows = [memory];
        if (job.kind === "decision" && providers.embedding) {
          const embedding = await trx("memory_embeddings")
            .where({
              memoryId: memory.id,
              version: memory.version,
              profile: providers.embedding.profile,
            })
            .first();
          if (embedding) {
            candidates = await eligible(trx)
              .where({ projectId: memory.projectId })
              .whereNot("id", memory.id)
              .whereRaw(
                `EXISTS(SELECT 1 FROM memory_embeddings e WHERE e.account_id = memories.account_id AND e.memory_id = memories.id AND e.version = memories.version AND CASE WHEN e.profile = ? THEN (e.embedding <=> ?::vector) < ? ELSE false END)`,
                [
                  providers.embedding.profile,
                  embedding.embedding,
                  providers.embedding.distanceThreshold ?? 0.65,
                ],
              )
              .orderByRaw(
                `(SELECT e.embedding <=> ?::vector FROM memory_embeddings e WHERE e.account_id = memories.account_id AND e.memory_id = memories.id AND e.version = memories.version AND e.profile = ?)`,
                [embedding.embedding, providers.embedding.profile],
              )
              .limit(5);
          }
        }
      }
      const selected: MemoryModel[] = [];
      let remaining = 24000;
      for (const row of rows) {
        if (selected.length === 80 || row.content.length > remaining) break;
        selected.push(row);
        remaining -= row.content.length;
      }
      if (!(await reserve(trx, job.accountId, role, dailyLimit))) {
        await trx("jobs")
          .where({ id: job.id, leaseId: job.leaseId })
          .update({
            leaseId: null,
            leaseUntil: null,
            attempts: Math.max(0, job.attempts - 1),
            dueAt: trx.raw("date_trunc('day', now()) + interval '1 day'"),
            errorCode: "inference_budget",
          });
        return;
      }
      return {
        rows: selected,
        candidates,
        contentVersion: account.contentVersion as number,
        truncated: selected.length < rows.length,
      };
    });
    if (!input) return true;
    const options = {
      onUsage: (value: Usage) => {
        usage = value;
      },
    };
    const sources = input.rows.map(source);
    let embedding: number[] | undefined;
    let annotation: Annotation | undefined;
    let organization: Organization | undefined;
    let brief: Brief["content"];
    if (job.kind === "embedding") {
      await registerEmbedding(db, providers.embedding!);
      embedding = await providers.embedding!.embed(
        sources[0].content,
        "document",
        options,
      );
      if (
        embedding.length !== providers.embedding!.dimensions ||
        embedding.some((n) => !Number.isFinite(n))
      )
        throw new InferenceError("embedding_profile_mismatch", false);
    } else if (job.kind === "decision")
      annotation = await providers.decision!.classify(
        sources[0],
        input.candidates.map(source),
        options,
      );
    else if (job.kind === "organization")
      organization = await providers.generation!.generate(
        organizationSchema,
        "Write a short factual title and up to six concise lowercase topic tags for this memory. Preserve its meaning.",
        sources,
        options,
      );
    else {
      brief = sources.length
        ? await providers.generation!.generate(
            briefContentSchema,
            `${job.scope!.taskId ? "Create a task handoff with Goal, Completed work, Verification, Blockers, Next steps." : job.scope!.projectId ? "Create a project brief covering purpose, architecture, decisions, conventions and recorded open work." : "Create a compact personal profile of explicitly stated preferences and stable facts."} Omit sections lacking evidence. Each statement must cite supplied source IDs and exact versions. Keep the entire brief under 3000 characters.`,
            sources,
            options,
          )
        : { title: "No active memories yet", sections: [] };
      const refs = brief.sections.flatMap((section) =>
        section.statements.flatMap((statement) => statement.sources),
      );
      if (
        refs.some(
          (ref) =>
            !sources.some((s) => s.id === ref.id && s.version === ref.version),
        )
      )
        throw new InferenceError("generation_invalid_citation");
      if (JSON.stringify(brief).length > 12000)
        throw new InferenceError("generation_too_large");
    }
    await tenant(db, job.accountId, async (trx) => {
      await trx.raw("SELECT pg_advisory_xact_lock_shared(68142019)");
      const account = await trx("accounts")
        .where({ id: job.accountId, status: "active" })
        .forUpdate()
        .first();
      if (!account) return;
      const row = job.memoryId
        ? await eligible(trx)
            .findById(job.memoryId)
            .where({ version: job.version! })
            .forShare()
        : undefined;
      const lease = await trx("jobs")
        .where({ id: job.id, leaseId: job.leaseId })
        .where("leaseUntil", ">", trx.fn.now())
        .forUpdate()
        .first();
      if (!lease) return;
      if (job.memoryId && !row) {
        await trx("jobs").where({ id: job.id }).delete();
        return;
      }
      if (
        (job.kind === "brief" && !account.summariesEnabled) ||
        ((job.kind === "decision" || job.kind === "organization") &&
          !account.organizeEnabled)
      ) {
        await trx("jobs").where({ id: job.id }).delete();
        return;
      }
      if (
        job.kind === "brief" &&
        (account.contentVersion !== input.contentVersion ||
          !(await validSources(trx, sources, job.scope!)))
      ) {
        await trx("jobs")
          .where({ id: job.id })
          .update({
            leaseId: null,
            leaseUntil: null,
            attempts: 0,
            dueAt: trx.raw("now() + interval '5 seconds'"),
          });
        return;
      }
      if (embedding) {
        await trx("memory_embeddings")
          .insert({
            accountId: job.accountId,
            memoryId: job.memoryId,
            version: job.version,
            profile: job.profile,
            dimensions: providers.embedding!.dimensions,
            embedding: JSON.stringify(embedding),
          })
          .onConflict(["accountId", "memoryId", "version", "profile"])
          .merge(["embedding"]);
        const profile = currentRelationshipProfile(providers);
        if (profile && row?.projectId && account.organizeEnabled) {
          await trx("notebook_profiles")
            .where({ projectId: row.projectId, profile })
            .delete();
          await enqueueRelationship(
            trx,
            job.accountId,
            "notebook_profile",
            row.projectId,
            profile,
            {
              contentVersion: (
                await trx("projects").where({ id: row.projectId }).first()
              ).contentVersion,
            },
          );
        }
      }
      if (annotation || organization) {
        await trx("memory_enrichments")
          .insert({
            accountId: job.accountId,
            memoryId: job.memoryId,
            version: job.version,
            kind: job.kind,
            profile: job.profile,
            data: JSON.stringify(annotation ?? organization),
            sources: JSON.stringify(
              input.candidates.map(({ id, version }) => ({ id, version })),
            ),
          })
          .onConflict(["accountId", "memoryId", "version", "kind", "profile"])
          .merge(["data", "sources"]);
        if (annotation && row!.autoKind && row!.kind !== annotation.kind) {
          await trx("memories")
            .where({ id: row!.id, version: row!.version })
            .update({ kind: annotation.kind });
          await trx("accounts")
            .where({ id: job.accountId })
            .increment("contentVersion", 1);
          await invalidateBriefs(trx, job.accountId);
        }
      }
      if (job.kind === "brief")
        await trx("memory_briefs")
          .insert({
            accountId: job.accountId,
            target: job.target,
            scope: JSON.stringify(job.scope),
            profile: job.profile,
            contentVersion: input.contentVersion,
            content: JSON.stringify(brief!),
            sources: JSON.stringify(
              sources.map(({ id, version }) => ({ id, version })),
            ),
            truncated: input.truncated,
          })
          .onConflict(["accountId", "target", "profile"])
          .merge([
            "content",
            "sources",
            "contentVersion",
            "truncated",
            "createdAt",
          ]);
      await trx("jobs").where({ id: job.id, leaseId: job.leaseId }).delete();
      completed = true;
    });
  } catch (error) {
    failed = true;
    const code =
      error instanceof InferenceError ? error.code : "processing_unavailable";
    await tenant(db, job.accountId, async (trx) => {
      await trx("jobs")
        .where({ id: job.id, leaseId: job.leaseId })
        .update({
          leaseId: null,
          leaseUntil: null,
          dueAt: trx.raw("now() + (? * interval '1 second')", [
            Math.min(3600, 2 ** job.attempts * 10),
          ]),
          errorCode: code,
          failedAt:
            job.attempts >= 5 ||
            (error instanceof InferenceError && !error.retryable)
              ? trx.fn.now()
              : null,
        });
    });
  } finally {
    currentTelemetry().operation(
      "job_run",
      started,
      failed ? "unavailable" : completed ? "success" : "cancelled",
    );
    await recordUsage(db, job.accountId, role, usage);
  }
  return true;
}
