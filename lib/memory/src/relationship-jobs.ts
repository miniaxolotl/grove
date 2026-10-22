import { MemoryModel, tenant, type Knex } from "@lib/database";
import { InferenceError, type Providers } from "@lib/ai";
import { processingEnabled } from "@lib/shared/preferences";
import type { ModelProfiles } from "@lib/shared/models";
import { currentTelemetry } from "@lib/telemetry/context";
import {
  groundRelationship,
  noteRelationshipInstructions,
  notebookRelationshipInstructions,
  noteAssessmentSchema,
  notebookAssessmentSchema,
  type RelationshipAssessment,
  normalizeRelationshipAssessment,
  type ConnectionLevel,
  type ConnectionSource,
} from "@lib/shared/relationships";
import { budgetedInference } from "./processing.ts";
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
  scope: { leftId?: string; rightId?: string };
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
export const pairRevision = (input: PairInput) =>
  relationHash([
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
    { leftId, rightId, snapshot },
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
  const candidates = await noteCandidates(trx, note, providers);
  for (const other of candidates)
    await queuePair(trx, job.accountId, "note", note.id, other.id, job.profile);
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
}

export async function noteCandidates(
  trx: Knex.Transaction,
  note: MemoryModel,
  providers: Providers,
) {
  const candidates = new Map<string, MemoryModel>();
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
    for (const other of await sameScope()
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
      .limit(5))
      candidates.set(other.id, other);
  }
  // OR terms supplement vectors and work when embedding generation is disabled.
  const terms = [
    ...new Set(
      note.content.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [],
    ),
  ]
    .slice(0, 16)
    .join(" OR ");
  if (terms)
    for (const other of await sameScope()
      .whereRaw("search @@ websearch_to_tsquery('english', ?)", [terms])
      .orderByRaw("ts_rank(search, websearch_to_tsquery('english', ?)) DESC", [
        terms,
      ])
      .orderBy("id")
      .limit(3))
      candidates.set(other.id, other);
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
  return rows.length;
}

export async function runRelationshipJob(
  db: Knex,
  providers: Providers,
  dailyLimit: number,
  job: RelationshipJob,
  resolveProfiles?: (trx: Knex.Transaction) => Promise<ModelProfiles>,
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
      const lease = await trx("jobs")
        .where({ id: job.id, leaseId: job.leaseId })
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
            old.revision !== pairRevision(value) ||
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
    const assessment = normalizeRelationshipAssessment(
      await budgetedInference(
        db,
        job.accountId,
        "generation",
        dailyLimit,
        (options) =>
          providers.generation!.generate<RelationshipAssessment>(
            input.level === "note"
              ? noteAssessmentSchema
              : notebookAssessmentSchema,
            `${input.level === "note" ? noteRelationshipInstructions : notebookRelationshipInstructions}\nLEFT source IDs: ${input.left.map((s) => s.id).join(", ")}. RIGHT source IDs: ${input.right.map((s) => s.id).join(", ")}. Examining ${input.left.length} of ${input.leftTotal} left notes and ${input.right.length} of ${input.rightTotal} right notes.`,
            [...input.left, ...input.right].map((s) => ({
              ...s,
              kind: "fact",
            })),
            options,
          ),
      ),
    );
    let evidence;
    try {
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
      if (current && pairRevision(current) === pairRevision(input)) {
        const payload = {
          accountId: job.accountId,
          leftId: input.leftId,
          rightId: input.rightId,
          leftVersion: input.leftVersion,
          rightVersion: input.rightVersion,
          revision: pairRevision(input),
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
      error instanceof InferenceError && error.code === "inference_budget";
    await tenant(db, job.accountId, async (trx) => {
      await trx("jobs")
        .where({ id: job.id, leaseId: job.leaseId })
        .update({
          leaseId: null,
          leaseUntil: null,
          dispatchedAt: null,
          attempts: budget ? Math.max(0, job.attempts - 1) : job.attempts,
          dueAt: budget
            ? trx.raw("date_trunc('day', now()) + interval '1 day'")
            : trx.raw("now() + (? * interval '1 second')", [
                Math.min(3600, 2 ** job.attempts * 10),
              ]),
          failedAt:
            !budget &&
            (job.attempts >= 5 ||
              (error instanceof InferenceError && !error.retryable))
              ? trx.fn.now()
              : null,
          errorCode:
            error instanceof InferenceError
              ? error.code
              : "processing_unavailable",
        });
    });
  } finally {
    currentTelemetry().operation("job_run", started, outcome);
  }
  return true;
}
