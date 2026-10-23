import type { MemoryModel, Knex } from "@lib/database";
import type { Providers } from "@lib/ai";
import { relationshipTerms } from "./relationship-discovery.ts";
import {
  activeNotes,
  connectionSource,
  enqueueRelationship,
  relationHash,
  unexpired,
} from "./relationship-data.ts";
import {
  earliestExpiry,
  queuePair,
  type PairInput,
  type RelationshipJob,
} from "./relationship-jobs.ts";

type Representative = { id: string; vector: number[]; hash: string };
type Candidate = { projectId: string; score: number; shared: number };
type ProfileData = {
  sum: number[];
  vectors: number;
  hashes: string[];
  representatives: Representative[];
  terms: Record<string, number>;
  candidateAfter?: string;
  candidates?: Candidate[];
  discoveryComplete?: boolean;
};
export type NotebookProfile = {
  projectId: string;
  contentVersion: number;
  profile: string;
  total: number;
  processed: number;
  afterId: string | null;
  complete: boolean;
  expiresAt: Date | null;
  data: ProfileData;
};
type Profile = NotebookProfile;
export const similarity = (a: number[], b: number[]) =>
  a.length && a.length === b.length
    ? a.reduce((n, x, i) => n + x * b[i], 0) /
      (Math.hypot(...a) * Math.hypot(...b) || 1)
    : 0;
export const vectorOf = (value: string | number[] | undefined): number[] =>
  typeof value === "string" ? JSON.parse(value) : (value ?? []);
export const words = (content: string) => relationshipTerms(content, 100);

export async function scheduleNotebookProfiles(
  trx: Knex.Transaction,
  accountId: string,
  profile: string,
) {
  const projects = await trx("projects as p")
    .whereNotExists(
      trx("notebook_profiles as n")
        .select(trx.raw("1"))
        .whereRaw(
          "n.account_id=p.account_id AND n.project_id=p.id AND n.content_version=p.content_version AND n.complete AND n.data->>'discoveryComplete'='true' AND (n.expires_at IS NULL OR n.expires_at>now())",
        )
        .where("n.profile", profile),
    )
    .whereNotExists(
      trx("jobs as j")
        .select(trx.raw("1"))
        .whereRaw(
          "j.account_id=p.account_id AND j.target=p.id::text AND j.scope->>'contentVersion'=p.content_version::text",
        )
        .where({ "j.kind": "notebook_profile", "j.profile": profile }),
    )
    .orderBy("p.id")
    .limit(20)
    .select("p.id", "p.contentVersion");
  for (const p of projects)
    await enqueueRelationship(
      trx,
      accountId,
      "notebook_profile",
      p.id,
      profile,
      { contentVersion: p.contentVersion },
    );
}
/** Profile all directly filed notes in stable bounded batches, without generation calls. */
export async function advanceNotebookProfile(
  trx: Knex.Transaction,
  job: Pick<RelationshipJob, "id" | "accountId" | "target" | "profile">,
  providers: Providers,
  discover = true,
) {
  const project = await trx("projects").where({ id: job.target }).first();
  if (!project) return true;
  let saved = await trx<Profile>("notebook_profiles")
    .where({ projectId: job.target, profile: job.profile })
    .first();
  if (
    saved &&
    (saved.contentVersion !== project.contentVersion ||
      !unexpired(saved.expiresAt))
  )
    saved = undefined;
  const data: ProfileData = saved?.data ?? {
    sum: [],
    vectors: 0,
    hashes: [],
    representatives: [],
    terms: {},
  };
  const notes = () => activeNotes(trx).where({ projectId: project.id });
  const stats = (await notes()
    .count("id as count")
    .min("expiresAt as expiresAt")
    .first()) as unknown as { count: string; expiresAt: Date | null };
  const batch = await notes()
    .modify((q) => {
      if (saved?.afterId) q.where("id", ">", saved.afterId);
    })
    .orderBy("id")
    .limit(64);
  const embeddings = providers.embedding
    ? await trx("memory_embeddings")
        .where({ profile: providers.embedding.profile })
        .whereIn(
          "memoryId",
          batch.map((n) => n.id),
        )
    : [];
  const seen = new Set(data.hashes);
  for (const note of batch) {
    const hash = relationHash(note.content.trim());
    if (seen.has(hash)) continue;
    seen.add(hash);
    const vector = vectorOf(
      embeddings.find(
        (e) => e.memoryId === note.id && e.version === note.version,
      )?.embedding,
    );
    if (vector.length) {
      if (!data.sum.length) data.sum = Array(vector.length).fill(0);
      vector.forEach((v, i) => {
        data.sum[i] += v;
      });
      data.vectors++;
    }
    for (const term of words(note.content))
      data.terms[term] =
        (Object.hasOwn(data.terms, term) ? data.terms[term] : 0) + 1;
    data.representatives.push({ id: note.id, vector, hash });
    if (data.representatives.length > 12) {
      // Keep diverse subjects; deterministic hashing is the no-vector reservoir.
      if (!vector.length)
        data.representatives.sort((a, b) => a.hash.localeCompare(b.hash)).pop();
      else {
        let closest = -Infinity,
          remove = data.representatives.length - 1;
        for (let i = 0; i < data.representatives.length; i++)
          for (let j = i + 1; j < data.representatives.length; j++) {
            const score = similarity(
              data.representatives[i].vector,
              data.representatives[j].vector,
            );
            if (score > closest) {
              closest = score;
              remove = j;
            }
          }
        data.representatives.splice(remove, 1);
      }
    }
  }
  data.hashes = [...seen];
  data.terms = Object.fromEntries(
    Object.entries(data.terms)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 128),
  );
  const processed = (saved?.processed ?? 0) + batch.length;
  const value: Profile = {
    projectId: project.id,
    profile: job.profile,
    contentVersion: project.contentVersion,
    expiresAt: stats.expiresAt,
    total: Number(stats.count),
    processed,
    afterId: batch.at(-1)?.id ?? saved?.afterId ?? null,
    complete: processed >= Number(stats.count),
    data,
  };
  await trx("notebook_profiles")
    .insert({ ...value, data: JSON.stringify(data), accountId: job.accountId })
    .onConflict(["accountId", "projectId", "profile"])
    .merge({ ...value, data: JSON.stringify(data), updatedAt: trx.fn.now() });
  const resume = async () => {
    await trx("jobs")
      .where({ id: job.id })
      .update({
        attempts: 0,
        leaseId: null,
        leaseUntil: null,
        dispatchedAt: null,
        dueAt: trx.raw("now() + interval '1 second'"),
      });
    return false;
  };
  if (!value.complete) return resume();
  if (!discover) return true;
  const others: Profile[] = !value.total
    ? []
    : await trx("notebook_profiles as n")
        .join("projects as p", "p.id", "n.projectId")
        .where({ "n.profile": job.profile, "n.complete": true })
        .whereNot("n.projectId", project.id)
        .where("n.total", ">", 0)
        .whereRaw(
          "n.content_version=p.content_version AND (n.expires_at IS NULL OR n.expires_at>now())",
        )
        .modify((query) => {
          if (data.candidateAfter)
            query.where("n.projectId", ">", data.candidateAfter);
        })
        .orderBy("n.projectId")
        .select("n.*")
        .limit(20);
  const ranked = [
    ...(data.candidates ?? []),
    ...others
      .map((p) => ({
        projectId: p.projectId,
        score: Math.max(
          similarity(data.sum, p.data.sum),
          ...data.representatives.flatMap((a) =>
            p.data.representatives.map((b) => similarity(a.vector, b.vector)),
          ),
        ),
        shared: Object.keys(data.terms).filter((t) =>
          Object.hasOwn(p.data.terms, t),
        ).length,
      }))
      .filter((p) => p.score > 0.35 || p.shared >= 2),
  ]
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.shared - a.shared ||
        a.projectId.localeCompare(b.projectId),
    )
    .slice(0, 5);
  data.candidateAfter = others.at(-1)?.projectId ?? data.candidateAfter;
  data.candidates = ranked;
  data.discoveryComplete = others.length < 20;
  await trx("notebook_profiles")
    .where({ projectId: project.id, profile: job.profile })
    .update({ data: JSON.stringify(data), updatedAt: trx.fn.now() });
  if (others.length === 20) return resume();
  for (const candidate of ranked)
    await queuePair(
      trx,
      job.accountId,
      "notebook",
      project.id,
      candidate.projectId,
      job.profile,
    );
  return true;
}
export async function notebookPairInput(
  trx: Knex.Transaction,
  leftId: string,
  rightId: string,
  profile: string,
  providers: Providers,
): Promise<PairInput | undefined> {
  const profiles = await trx<Profile>("notebook_profiles as n")
    .join("projects as p", "p.id", "n.projectId")
    .whereIn("n.projectId", [leftId, rightId])
    .where({ "n.profile": profile, "n.complete": true })
    .whereRaw(
      "n.content_version=p.content_version AND (n.expires_at IS NULL OR n.expires_at>now())",
    )
    .orderBy("n.projectId")
    .select("n.*");
  if (profiles.length !== 2 || profiles.some((p) => !p.total)) return;
  const select = async (own: Profile, other: Profile) => {
    const query = () => activeNotes(trx).where({ projectId: own.projectId });
    const chosen = new Map<string, MemoryModel>();
    const add = (rows: MemoryModel[]) => {
      for (const row of rows) chosen.set(row.id, row);
    };
    const refs = own.data.representatives
      .slice()
      .sort(
        (a, b) =>
          Math.max(
            0,
            ...other.data.representatives.map((r) =>
              similarity(b.vector, r.vector),
            ),
          ) -
          Math.max(
            0,
            ...other.data.representatives.map((r) =>
              similarity(a.vector, r.vector),
            ),
          ),
      )
      .slice(0, 4)
      .map((r) => r.id);
    add(await query().whereIn("id", refs).orderBy("id"));
    const shared = Object.keys(own.data.terms)
      .filter((t) => Object.hasOwn(other.data.terms, t))
      .slice(0, 12)
      .join(" OR ");
    if (shared)
      add(
        await query()
          .whereRaw("search @@ websearch_to_tsquery('english', ?)", [shared])
          .orderByRaw(
            "ts_rank(search, websearch_to_tsquery('english', ?)) DESC",
            [shared],
          )
          .orderBy("id")
          .limit(2),
      );
    if (providers.embedding && other.data.vectors)
      add(
        await query()
          .whereRaw(
            "EXISTS (SELECT 1 FROM memory_embeddings e WHERE e.account_id=memories.account_id AND e.memory_id=memories.id AND e.version=memories.version AND e.profile=?)",
            [providers.embedding.profile],
          )
          .orderByRaw(
            "(SELECT e.embedding <=> ?::vector FROM memory_embeddings e WHERE e.account_id=memories.account_id AND e.memory_id=memories.id AND e.version=memories.version AND e.profile=?)",
            [JSON.stringify(other.data.sum), providers.embedding.profile],
          )
          .limit(2),
      );
    add(await query().orderBy("createdAt").orderBy("id").limit(1));
    add(await query().orderBy("createdAt", "desc").orderBy("id").limit(1));
    let remaining = 12000;
    const rows = [];
    for (const row of chosen.values()) {
      if (row.content.length > remaining || rows.length === 8) continue;
      rows.push(connectionSource(row));
      remaining -= row.content.length;
    }
    return rows;
  };
  const left = await select(profiles[0], profiles[1]),
    right = await select(profiles[1], profiles[0]);
  if (!left.length || !right.length) return;
  return {
    level: "notebook",
    leftId,
    rightId,
    leftVersion: profiles[0].contentVersion,
    rightVersion: profiles[1].contentVersion,
    expiresAt: earliestExpiry(profiles.map((p) => p.expiresAt)),
    leftTotal: profiles[0].total,
    rightTotal: profiles[1].total,
    left,
    right,
  };
}
