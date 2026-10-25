import { MemoryModel, tenant, type Knex } from "@lib/database";
import { InferenceError, type Providers } from "@lib/ai";
import { processingEnabled } from "@lib/shared/preferences";
import type { ModelProfiles } from "@lib/shared/models";
import { currentTelemetry } from "@lib/telemetry/context";
import { retryDelay } from "./task-runner.ts";
import {
  lexicalCandidates,
  relationshipTerms,
} from "./relationship-discovery.ts";
import {
  groundRelationship,
  assessRelationship,
  noteRelationshipInstructions,
  notebookRelationshipInstructions,
  noteAssessmentSchema,
  notebookAssessmentSchema,
  type RelationshipJudgment,
  type RelationshipAssessment,
  type ConnectionLevel,
  type ConnectionSource,
} from "@lib/shared/relationships";
import { budgetedInference } from "./processing.ts";
import {
  inheritBillingQuotas,
  reserveAction,
  settleAction,
  UsageLimitError,
} from "./billing-quotas.ts";
import {
  activeNotes,
  connectionSource,
  currentRelationshipProfile,
  enqueueRelationship,
  relationHash,
  relationshipProfile,
  relationshipTable,
  unexpired,
  type RelationshipKind,
  type RelationshipRow,
  type StoredAssessment,
} from "./relationship-data.ts";
import {
  advanceNotebookProfile,
  notebookPairInput,
  scheduleNotebookProfiles,
} from "./notebook-relationships.ts";

export type RelationshipJob = {
  id: string;
  accountId: string;
  kind: RelationshipKind;
  target: string;
  memoryId: string | null;
  version: number | null;
  profile: string;
  leaseId: string;
  attempts: number;
  scope: { leftId?: string; rightId?: string; action?: string };
};
export type PairInput = {
  level: ConnectionLevel;
  leftId: string;
  rightId: string;
  leftVersion: number;
  rightVersion: number;
  expiresAt: Date | null;
  left: ConnectionSource[];
  right: ConnectionSource[];
  leftTotal: number;
  rightTotal: number;
};
export const pairRevision = (input: PairInput, profile: string) =>
  relationHash([
    profile,
    input.level,
    input.leftId,
    input.rightId,
    input.leftVersion,
    input.rightVersion,
    input.expiresAt,
  ]);
export const earliestExpiry = (dates: (Date | null)[]) =>
  dates
    .filter((d): d is Date => !!d)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null;

export async function queuePair(
  trx: Knex.Transaction,
  accountId: string,
  level: ConnectionLevel,
  a: string,
  b: string,
  profile: string,
  action?: string,
) {
  if (a === b) return;
  const [leftId, rightId] = [a, b].sort();
  const endpoints =
    level === "note"
      ? await activeNotes(trx).whereIn("id", [leftId, rightId]).orderBy("id")
      : await trx("notebook_profiles as n")
          .join("projects as p", "p.id", "n.projectId")
          .whereIn("n.projectId", [leftId, rightId])
          .where({ "n.profile": profile, "n.complete": true })
          .where("n.total", ">", 0)
          .whereRaw(
            "n.content_version=p.content_version AND (n.expires_at IS NULL OR n.expires_at>now())",
          )
          .orderBy("n.projectId")
          .select("n.*");
  if (
    endpoints.length !== 2 ||
    (level === "note" && endpoints[0].projectId !== endpoints[1].projectId)
  )
    return;
  const snapshot = relationHash(
    endpoints.map((endpoint) => [
      level === "note" ? endpoint.version : endpoint.contentVersion,
      endpoint.expiresAt,
    ]),
  );
  await enqueueRelationship(
    trx,
    accountId,
    level === "note" ? "note_relationship" : "notebook_relationship",
    `${leftId}:${rightId}`,
    profile,
    {
      leftId,
      rightId,
      snapshot,
      leftVersion:
        level === "note" ? endpoints[0].version : endpoints[0].contentVersion,
      rightVersion:
        level === "note" ? endpoints[1].version : endpoints[1].contentVersion,
      expiresAt:
        earliestExpiry(
          endpoints.map((endpoint) => endpoint.expiresAt),
        )?.getTime() ?? null,
      ...(action ? { action } : {}),
    },
  );
}
async function scanNote(
  trx: Knex.Transaction,
  job: RelationshipJob,
  providers: Providers,
  contentVersion: number,
) {
  const note = await activeNotes(trx)
    .findById(job.memoryId!)
    .where({ version: job.version! });
  if (!note) return;
  const action = job.scope.action
    ? await reserveAction(
        trx,
        trx,
        job.accountId,
        "organization",
        job.scope.action,
      )
    : null;
  const candidates = await noteCandidates(trx, note, providers);
  for (const other of candidates)
    await queuePair(
      trx,
      job.accountId,
      "note",
      note.id,
      other.id,
      job.profile,
      job.scope.action,
    );
  const previous = await trx("memory_relationships")
    .where((b) => b.where("leftId", note.id).orWhere("rightId", note.id))
    .orderBy("updatedAt", "desc")
    .limit(20);
  for (const pair of previous)
    await queuePair(
      trx,
      job.accountId,
      "note",
      pair.leftId,
      pair.rightId,
      job.profile,
      job.scope.action,
    );
  const scopeVersion = note.projectId
    ? (await trx("projects").where({ id: note.projectId }).first())
        .contentVersion
    : contentVersion;
  await trx("memory_enrichments")
    .insert({
      accountId: job.accountId,
      memoryId: note.id,
      version: note.version,
      profile: job.profile,
      kind: "relationship_scan",
      data: JSON.stringify({ scopeVersion }),
      sources: "[]",
    })
    .onConflict(["accountId", "memoryId", "version", "kind", "profile"])
    .merge({ data: JSON.stringify({ scopeVersion }), createdAt: trx.fn.now() });
  await settleAction(trx, action, "completed");
}

export async function noteCandidates(
  trx: Knex.Transaction,
  note: MemoryModel,
  providers: Providers,
) {
  const candidates = new Map<string, MemoryModel>();
  let vectors: MemoryModel[] = [];
  const sameScope = () =>
    activeNotes(trx)
      .where({ projectId: note.projectId })
      .whereNot("id", note.id);
  for (const other of await sameScope()
    .where({ content: note.content })
    .orderBy("id")
    .limit(2))
    candidates.set(other.id, other);
  const vector =
    providers.embedding &&
    (await trx("memory_embeddings")
      .where({
        memoryId: note.id,
        version: note.version,
        profile: providers.embedding.profile,
      })
      .first());
  if (vector) {
    vectors = await sameScope()
      .whereRaw(
        `EXISTS (SELECT 1 FROM memory_embeddings e WHERE e.account_id=memories.account_id AND e.memory_id=memories.id AND e.version=memories.version AND CASE WHEN e.profile=? THEN (e.embedding <=> ?::vector) < ? ELSE false END)`,
        [
          providers.embedding!.profile,
          vector.embedding,
          providers.embedding!.distanceThreshold ?? 0.65,
        ],
      )
      .orderByRaw(
        `(SELECT e.embedding <=> ?::vector FROM memory_embeddings e WHERE e.account_id=memories.account_id AND e.memory_id=memories.id AND e.version=memories.version AND e.profile=?)`,
        [vector.embedding, providers.embedding!.profile],
      )
      .limit(5);
  }
  // OR terms supplement vectors and work when embedding generation is disabled.
  const terms = relationshipTerms(note.content);
  let pool: MemoryModel[] = [];
  if (terms.length) {
    const shortlist = (hints: string[]) => {
      const query = hints.join(" OR ");
      return sameScope()
        .whereRaw("search @@ websearch_to_tsquery('english', ?)", [query])
        .orderByRaw(
          "ts_rank(search, websearch_to_tsquery('english', ?)) DESC",
          [query],
        )
        .orderBy("id")
        .limit(16);
    };
    pool = await shortlist(terms);
    const documents = pool.map(
      (row) => new Set(relationshipTerms(row.content)),
    );
    const counts = terms.map(
      (term) => documents.filter((tokens) => tokens.has(term)).length,
    );
    const minimum = Math.min(...counts);
    const focused = terms.filter((_, i) => counts[i] === minimum);
    // A template-saturated SQL shortlist can hide distinguishing terms before
    // reranking. Reserve half the 32-row budget for its least represented hints.
    if (focused.length < terms.length) pool.push(...(await shortlist(focused)));
  }
  const lexical = lexicalCandidates(
    note.content,
    [...new Map(pool.map((row) => [row.id, row])).values()],
    5,
  );
  // Interleave independent rankings rather than letting vectors consume the cap.
  for (let i = 0; i < Math.max(vectors.length, lexical.length); i++) {
    for (const row of [lexical[i], vectors[i]])
      if (row) candidates.set(row.id, row);
  }
  return [...candidates.values()].slice(0, 8);
}
async function pairInput(
  trx: Knex.Transaction,
  job: RelationshipJob,
  providers: Providers,
): Promise<PairInput | undefined> {
  const { leftId, rightId } = job.scope;
  if (!leftId || !rightId || leftId >= rightId) return;
  if (job.kind === "notebook_relationship")
    return notebookPairInput(trx, leftId, rightId, job.profile, providers);
  const notes = await activeNotes(trx)
    .whereIn("id", [leftId, rightId])
    .orderBy("id");
  if (notes.length !== 2 || notes[0].projectId !== notes[1].projectId) return;
  return {
    level: "note",
    leftId,
    rightId,
    leftVersion: notes[0].version,
    rightVersion: notes[1].version,
    expiresAt: earliestExpiry(notes.map((n) => n.expiresAt)),
    left: [connectionSource(notes[0])],
    right: [connectionSource(notes[1])],
    leftTotal: 1,
    rightTotal: 1,
  };
}

export async function scheduleRelationships(
  trx: Knex.Transaction,
  accountId: string,
  profiles: ModelProfiles,
) {
  const profile = relationshipProfile(profiles);
  if (!profile) return 0;
  const rows = await trx("memories as m")
    .leftJoin("projects as p", "p.id", "m.projectId")
    .join("accounts as a", "a.id", "m.accountId")
    .where("a.noteConnectionsEnabled", true)
    .where("m.status", "active")
    .where((b) =>
      b.whereNull("m.expiresAt").orWhere("m.expiresAt", ">", trx.fn.now()),
    )
    .whereNotExists(
      trx("jobs as j")
        .select(trx.raw("1"))
        .whereRaw(
          "j.account_id=m.account_id AND j.memory_id=m.id AND j.version=m.version",
        )
        .where({ "j.kind": "relationship_scan", "j.profile": profile }),
    )
    .whereNotExists(
      trx("memory_enrichments as e")
        .select(trx.raw("1"))
        .whereRaw(
          "e.account_id=m.account_id AND e.memory_id=m.id AND e.version=m.version AND (e.data->>'scopeVersion')::int = COALESCE(p.content_version, a.content_version)",
        )
        .where({ "e.kind": "relationship_scan", "e.profile": profile }),
    )
    .orderBy("m.id")
    .limit(100)
    .select("m.id", "m.version");
  for (const row of rows)
    await enqueueRelationship(
      trx,
      accountId,
      "relationship_scan",
      row.id,
      profile,
      {},
      row,
    );
  const account = await trx("accounts").where({ id: accountId }).first();
  if (account.notebookConnectionsEnabled)
    await scheduleNotebookProfiles(trx, accountId, profile);
  // A scan's twenty-pair window must not strand lower-ranked old-policy pairs.
  for (const level of ["note", "notebook"] as const) {
    if (
      !(level === "note"
        ? account.noteConnectionsEnabled
        : account.notebookConnectionsEnabled)
    )
      continue;
    const endpoint = level === "note" ? "memories" : "projects";
    const old = trx(`${relationshipTable(level)} as r`)
      .join(`${endpoint} as l`, "l.id", "r.leftId")
      .join(`${endpoint} as n`, "n.id", "r.rightId")
      .whereNot("r.profile", profile)
      .where({ "l.status": "active", "n.status": "active" });
    if (level === "note") {
      old
        .whereRaw("l.project_id IS NOT DISTINCT FROM n.project_id")
        .whereRaw(
          "(l.expires_at IS NULL OR l.expires_at>now()) AND (n.expires_at IS NULL OR n.expires_at>now())",
        );
    } else {
      old
        .join("notebook_profiles as lp", "lp.projectId", "l.id")
        .join("notebook_profiles as np", "np.projectId", "n.id")
        .where({
          "lp.profile": profile,
          "np.profile": profile,
          "lp.complete": true,
          "np.complete": true,
        })
        .whereRaw(
          "lp.content_version=l.content_version AND np.content_version=n.content_version",
        )
        .whereRaw(
          "(lp.expires_at IS NULL OR lp.expires_at>now()) AND (np.expires_at IS NULL OR np.expires_at>now())",
        );
    }
    // Existing jobs suppress only the snapshot they actually checked. Changed
    // sources must revisit even an exhausted pair outside the per-note window.
    const version = level === "note" ? "version" : "content_version";
    const leftExpiry = level === "note" ? "l.expires_at" : "lp.expires_at";
    const rightExpiry = level === "note" ? "n.expires_at" : "np.expires_at";
    old.whereNotExists(
      trx("jobs as j")
        .select(trx.raw("1"))
        .where({
          "j.profile": profile,
          "j.kind":
            level === "note" ? "note_relationship" : "notebook_relationship",
        })
        .whereRaw(
          "j.account_id=r.account_id AND j.target=r.left_id::text || ':' || r.right_id::text",
        )
        .whereRaw(
          `(j.scope->>'leftVersion')::int=l.${version} AND (j.scope->>'rightVersion')::int=n.${version}`,
        )
        .whereRaw(
          `(j.scope->>'expiresAt')::numeric IS NOT DISTINCT FROM FLOOR(EXTRACT(EPOCH FROM LEAST(${leftExpiry}, ${rightExpiry}))*1000)`,
        ),
    );
    for (const pair of await old
      .orderBy("r.id")
      .limit(20)
      .select("r.leftId", "r.rightId"))
      await queuePair(
        trx,
        accountId,
        level,
        pair.leftId,
        pair.rightId,
        profile,
      );
  }
  return rows.length;
}

export async function runRelationshipJob(
  db: Knex,
  providers: Providers,
  dailyLimit: number,
  job: RelationshipJob,
  resolveProfiles?: (trx: Knex.Transaction) => Promise<ModelProfiles>,
  signal?: AbortSignal,
) {
  const started = performance.now();
  let outcome: "success" | "cancelled" | "unavailable" = "cancelled";
  const inLease = <T>(
    run: (
      trx: Knex.Transaction,
      account: { contentVersion: number },
    ) => Promise<T>,
  ) =>
    tenant(db, job.accountId, async (trx) => {
      await trx.raw("SELECT pg_advisory_xact_lock_shared(68142019)");
      const account = await trx("accounts")
        .where({ id: job.accountId, status: "active" })
        .forUpdate()
        .first();
      inheritBillingQuotas(db, trx);
      const lease = await trx("jobs")
        .where({ id: job.id, leaseId: job.leaseId })
        .whereRaw(
          "epoch=(SELECT epoch FROM processing_control WHERE singleton)",
        )
        .where("leaseUntil", ">", trx.fn.now())
        .forUpdate()
        .first();
      if (!lease) return;
      const profile = resolveProfiles
        ? relationshipProfile(await resolveProfiles(trx))
        : currentRelationshipProfile(providers);
      if (
        !account ||
        !processingEnabled(account, job.kind) ||
        profile !== job.profile
      ) {
        await trx("jobs").where({ id: job.id }).delete();
        return;
      }
      return run(trx, account);
    });
  try {
    const input = await inLease(async (trx, account) => {
      if (job.kind === "relationship_scan")
        await scanNote(trx, job, providers, account.contentVersion);
      else if (job.kind === "notebook_profile") {
        const complete = await advanceNotebookProfile(trx, job, providers);
        if (!complete) return;
      } else {
        const value = await pairInput(trx, job, providers);
        if (value) {
          const old = await trx<RelationshipRow>(relationshipTable(value.level))
            .where({ leftId: value.leftId, rightId: value.rightId })
            .first();
          if (
            !old ||
            old.revision !== pairRevision(value, job.profile) ||
            old.profile !== job.profile ||
            !unexpired(old.expiresAt)
          )
            return value;
        }
      }
      await trx("jobs").where({ id: job.id }).delete();
      outcome = "success";
    });
    if (!input) return true;
    const generated = await budgetedInference(
      db,
      job.accountId,
      "generation",
      dailyLimit,
      (options) =>
        providers.generation!.generate<RelationshipJudgment>(
          input.level === "note"
            ? noteAssessmentSchema
            : notebookAssessmentSchema,
          `${input.level === "note" ? noteRelationshipInstructions : notebookRelationshipInstructions}\nLEFT source IDs: ${input.left.map((s) => s.id).join(", ")}. RIGHT source IDs: ${input.right.map((s) => s.id).join(", ")}. Examining ${input.left.length} of ${input.leftTotal} left notes and ${input.right.length} of ${input.rightTotal} right notes.`,
          [...input.left, ...input.right].map(({ id, version, content }) => ({
            id,
            version,
            content,
            kind: "fact",
          })),
          { ...options, signal },
        ),
    );
    let assessment: RelationshipAssessment;
    let evidence;
    try {
      assessment = assessRelationship(
        generated,
        input.level,
        input.left,
        input.right,
      );
      evidence = groundRelationship(
        assessment,
        input.level,
        input.left,
        input.right,
      );
    } catch {
      throw new InferenceError("relationship_invalid_evidence");
    }
    const coverage = (sources: ConnectionSource[], total: number) => ({
      total,
      examined: sources.length,
      supporting: new Set(
        sources
          .filter((s) => evidence.some((e) => e.id === s.id))
          .map((s) => s.content),
      ).size,
    });
    const from = coverage(input.left, input.leftTotal),
      to = coverage(input.right, input.rightTotal);
    const data: StoredAssessment = {
      ...assessment,
      evidence,
      coverage: { from, to },
      breadth: [from, to].every(
        (c) =>
          c.examined === c.total &&
          c.supporting >= 2 &&
          c.supporting / c.total >= 0.5,
      )
        ? "broad"
        : "thread",
    };
    await inLease(async (trx) => {
      const current = await pairInput(trx, job, providers);
      if (
        current &&
        pairRevision(current, job.profile) === pairRevision(input, job.profile)
      ) {
        const previous = await trx<RelationshipRow>(
          relationshipTable(input.level),
        )
          .where({ leftId: input.leftId, rightId: input.rightId })
          .forUpdate()
          .first();
        const revision = pairRevision(input, job.profile);
        const carryDismissal =
          previous &&
          previous.dismissedRevision === previous.revision &&
          previous.leftVersion === input.leftVersion &&
          previous.rightVersion === input.rightVersion &&
          String(previous.expiresAt) === String(input.expiresAt);
        const payload = {
          accountId: job.accountId,
          leftId: input.leftId,
          rightId: input.rightId,
          leftVersion: input.leftVersion,
          rightVersion: input.rightVersion,
          revision,
          dismissedRevision: carryDismissal
            ? revision
            : (previous?.dismissedRevision ?? null),
          profile: job.profile,
          expiresAt: input.expiresAt,
          assessment: JSON.stringify(data),
          updatedAt: trx.fn.now(),
        };
        await trx(relationshipTable(input.level))
          .insert(payload)
          .onConflict(["accountId", "leftId", "rightId"])
          .merge(payload);
        outcome = "success";
        await trx("jobs").where({ id: job.id }).delete();
      } else
        await trx("jobs")
          .where({ id: job.id })
          .update({
            attempts: 0,
            leaseId: null,
            leaseUntil: null,
            dispatchedAt: null,
            dueAt: trx.raw("now() + interval '5 seconds'"),
          });
    });
  } catch (error) {
    outcome = "unavailable";
    const budget =
      (error instanceof InferenceError && error.code === "inference_budget") ||
      error instanceof UsageLimitError;
    await tenant(db, job.accountId, async (trx) => {
      await trx("jobs")
        .where({ id: job.id, leaseId: job.leaseId })
        .update({
          leaseId: null,
          leaseUntil: null,
          dispatchedAt: null,
          attempts: budget ? Math.max(0, job.attempts - 1) : job.attempts,
          dueAt:
            error instanceof UsageLimitError
              ? error.resetAt
                ? new Date(error.resetAt)
                : trx.raw("now()+interval '1 second'")
              : budget
                ? trx.raw("date_trunc('day', now()) + interval '1 day'")
                : trx.raw("now() + (? * interval '1 second')", [
                    retryDelay(job.attempts),
                  ]),
          failedAt:
            !budget &&
            (job.attempts >= 5 ||
              (error instanceof InferenceError && !error.retryable))
              ? trx.fn.now()
              : null,
          errorCode:
            error instanceof InferenceError || error instanceof UsageLimitError
              ? error.code
              : "processing_unavailable",
        });
    });
  } finally {
    currentTelemetry().operation("job_run", started, outcome);
  }
  return true;
}
