import {
  MemoryModel,
  camelRows,
  tenant,
  databaseSignal,
  withDatabaseSignal,
  type Knex,
} from "@lib/database";
import { currentTelemetry } from "@lib/telemetry/context";
import { processingLease } from "./job-lease.ts";
import { retryDelay } from "./task-runner.ts";
import type { QueueLane } from "@lib/shared/jobs";
import {
  briefPreference,
  processingEnabled,
  type PreferenceKey,
} from "@lib/shared/preferences";
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
  type SourceRef,
  type Usage,
  type Annotation,
  type Organization,
  type ModelProfiles,
} from "@lib/shared/models";
import {
  currentRelationshipProfile,
  enqueueRelationship,
  relationshipKinds,
  relationshipProfile,
} from "./relationship-data.ts";
import {
  runRelationshipJob,
  type RelationshipJob,
} from "./relationship-jobs.ts";
import {
  isNotebookSummary,
  notebookSummaryProfile,
  runNotebookSummary,
  summaryProfile,
  type SummaryJob,
} from "./notebook-summaries.ts";
import { assistanceProfile } from "./assistance-data.ts";
import { runAssistanceJob, type AssistanceJob } from "./assistance-jobs.ts";
import { billingAllows } from "./billing-quotas.ts";

export const briefTarget = (scope: BriefRequest) =>
  `${scope.projectId ?? "personal"}${scope.taskId ? `:task:${scope.taskId}` : ""}`;
export const providerProfiles = (providers: Providers) => [
  ...Object.values(providers)
    .filter(Boolean)
    .map((provider) => provider!.profile),
  ...[currentRelationshipProfile(providers)].filter((p): p is string => !!p),
  ...(providers.generation
    ? [
        notebookSummaryProfile(providers.generation.profile),
        assistanceProfile(
          providers.generation.profile,
          providers.embedding?.profile,
        ),
        assistanceProfile(
          providers.generation.profile,
          providers.embedding?.profile,
          "cleanup",
        ),
      ]
    : []),
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
  const account = await trx("accounts").where({ id: accountId }).first();
  if (!account?.[briefPreference(scope)]) return;
  profile = summaryProfile(profile, scope);
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
      epoch: trx.raw("(SELECT epoch FROM processing_control WHERE singleton)"),
      attempts: 0,
      failedAt: null,
      errorCode: null,
      leaseId: null,
      leaseUntil: null,
      dispatchId: null,
      dispatchUntil: null,
      dispatchedAt: null,
      dueAt: trx.raw("now() + (? * interval '1 second')", [delay]),
    });
}
export async function invalidateBriefs(
  trx: Knex.Transaction,
  accountId: string,
) {
  const scopes = (q: Knex.QueryBuilder) =>
    q.whereRaw("scope->>'projectId' IS NULL OR scope->>'taskId' IS NOT NULL");
  const old = await trx("memory_briefs")
    .modify(scopes)
    .select("scope", "profile");
  await trx("memory_briefs").modify(scopes).delete();
  for (const row of old)
    await queueBrief(trx, accountId, row.scope, row.profile);
  await trx("jobs")
    .where({ kind: "brief" })
    .modify(scopes)
    .update({
      attempts: 0,
      failedAt: null,
      leaseId: null,
      leaseUntil: null,
      dispatchId: null,
      dispatchUntil: null,
      dispatchedAt: null,
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
  only?: PreferenceKey[],
) {
  // Settings re-enable only the requested features; preserve unrelated jobs/leases.
  if (!only) {
    await trx("jobs").where({ memoryId: row.id }).delete();
    await trx("memory_enrichments").where({ memoryId: row.id }).delete();
  }
  if (
    row.status !== "active" ||
    (row.expiresAt && new Date(row.expiresAt) <= new Date())
  )
    return;
  const account = await trx("accounts").where({ id: row.accountId }).first();
  const enabled = (key: PreferenceKey) =>
    account[key] && (!only || only.includes(key));
  const connectionProfile = relationshipProfile(profiles);
  if (enabled("noteConnectionsEnabled") && connectionProfile)
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
    ["embedding", !only ? profiles.embedding : undefined],
    [
      "decision",
      enabled("classificationEnabled") ? profiles.decision : undefined,
    ],
    [
      "organization",
      enabled("titlesTagsEnabled") ? profiles.generation : undefined,
    ],
  ] as const) {
    if (provider)
      await trx("jobs")
        .insert({
          accountId: row.accountId,
          memoryId: row.id,
          version: row.version,
          target: row.id,
          kind,
          profile: provider,
        })
        .onConflict(["accountId", "kind", "target", "profile"])
        .ignore();
  }
  if (profiles.generation) {
    if (enabled(briefPreference({ projectId: row.projectId })))
      await queueBrief(
        trx,
        row.accountId,
        { projectId: row.projectId },
        profiles.generation,
      );
    if (row.taskId && enabled("progressSummariesEnabled"))
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
  if (!account[briefPreference(scope)]) return empty;
  const target = briefTarget(scope),
    profile = summaryProfile(providers.generation.profile, scope);
  const row = await trx("memory_briefs").where({ target, profile }).first();
  const notebook = isNotebookSummary(scope)
    ? await trx("projects")
        .where({ id: scope.projectId })
        .first("contentVersion")
    : undefined;
  if (
    row &&
    (notebook
      ? row.notebookVersion === notebook.contentVersion
      : row.contentVersion === account.contentVersion) &&
    (!row.expiresAt || new Date(row.expiresAt) > new Date()) &&
    (await validSources(trx, row.sources, scope))
  ) {
    return {
      ...empty,
      status: "ready",
      content: row.content,
      updatedAt: new Date(row.createdAt).toISOString(),
      sourceCount: row.coverage?.examined ?? row.sources.length,
      ...(row.coverage ? { coverage: row.coverage } : {}),
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
  db: Knex,
  trx: Knex.Transaction,
  accountId: string,
  role: string,
  limit: number,
) {
  await trx.raw("SELECT pg_advisory_xact_lock(hashtextextended(?, 6))", [
    accountId,
  ]);
  const result = await trx("inference_usage")
    .whereRaw("day = (now() AT TIME ZONE 'UTC')::date")
    .sum("requests as count")
    .first();
  if (Number(result?.count ?? 0) >= limit) return false;
  if (
    role === "generation" &&
    !(await billingAllows(db, trx, accountId, "generation"))
  )
    return false;
  await trx.raw(
    `INSERT INTO inference_usage(account_id, role, day, requests) VALUES (?, ?, (now() AT TIME ZONE 'UTC')::date, 1)
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
        ...(options.signal ? [options.signal] : []),
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
    reserve(db, trx, accountId, role, limit),
  );
  if (!allowed) throw new InferenceError("inference_budget");
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  try {
    return await run({
      signal: databaseSignal(),
      onUsage: (value) => {
        usage = value;
      },
    });
  } finally {
    await withDatabaseSignal(undefined, () =>
      recordUsage(db, accountId, role, usage),
    );
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
      .whereRaw("day = (now() AT TIME ZONE 'UTC')::date")
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
  options: {
    lane?: QueueLane;
    accountLimit?: number;
    providerLimit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<boolean> {
  const profiles = providerProfiles(providers);
  if (!profiles.length) return false;
  const claimed = camelRows<Job | RelationshipJob | AssistanceJob>(
    await db.raw(
      "SELECT * FROM grove_claim_processing(?::text[], ?::uuid, ?, ?, ?)",
      [
        profiles,
        wantedId ?? null,
        options.lane ?? null,
        options.accountLimit ?? 2,
        options.providerLimit ?? 8,
      ],
    ),
  )[0];
  if (!claimed) return false;
  const lease = processingLease(db, claimed, options.signal);
  if (
    claimed.kind === "assistance" ||
    (claimed.kind === "brief" &&
      claimed.scope &&
      isNotebookSummary(claimed.scope as BriefRequest))
  ) {
    try {
      return claimed.kind === "assistance"
        ? await runAssistanceJob(
            db,
            providers,
            dailyLimit,
            claimed,
            resolveProfiles,
            lease.signal,
          )
        : await runNotebookSummary(
            db,
            providers,
            dailyLimit,
            claimed as SummaryJob,
            resolveProfiles,
            lease.signal,
          );
    } finally {
      await lease.close();
    }
  }
  if ((relationshipKinds as readonly string[]).includes(claimed.kind)) {
    try {
      return await runRelationshipJob(
        db,
        providers,
        dailyLimit,
        claimed as RelationshipJob,
        resolveProfiles,
        lease.signal,
      );
    } finally {
      await lease.close();
    }
  }
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
      const lease = await trx("jobs")
        .where({ id: job.id, leaseId: job.leaseId })
        .whereRaw(
          "epoch=(SELECT epoch FROM processing_control WHERE singleton)",
        )
        .where("leaseUntil", ">", trx.fn.now())
        .first("id");
      if (!lease) return;
      if (!account || !processingEnabled(account, job.kind, job.scope)) {
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
      if (!(await reserve(db, trx, job.accountId, role, dailyLimit))) {
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
      signal: lease.signal,
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
        .whereRaw(
          "epoch=(SELECT epoch FROM processing_control WHERE singleton)",
        )
        .where("leaseUntil", ">", trx.fn.now())
        .forUpdate()
        .first();
      if (!lease) return;
      if (job.memoryId && !row) {
        await trx("jobs").where({ id: job.id }).delete();
        return;
      }
      if (!processingEnabled(account, job.kind, job.scope)) {
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
        if (profile && row?.projectId && account.notebookConnectionsEnabled) {
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
            retryDelay(job.attempts),
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
    await lease.close();
    currentTelemetry().operation(
      "job_run",
      started,
      failed ? "unavailable" : completed ? "success" : "cancelled",
    );
    await recordUsage(db, job.accountId, role, usage);
  }
  return true;
}
