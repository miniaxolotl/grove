import { camelRows, tenant, type Knex } from "@lib/database";
import type { Providers } from "@lib/ai";
import type { BriefRequest, ModelProfiles } from "@lib/shared/models";
import { summaryPreferences } from "@lib/shared/preferences";
import { briefFor } from "./processing.ts";
import { scheduleRelationships } from "./relationship-jobs.ts";

/** Repair missing derived data without rewriting notes or resetting failed jobs. */
export async function scheduleOrganization(
  db: Knex,
  providers: Providers,
  intervalSeconds: number,
  resolveProfiles?: (trx: Knex.Transaction) => Promise<ModelProfiles>,
) {
  const accounts = camelRows<{ id: string }>(
    await db.raw("SELECT * FROM grove_organization_accounts(?)", [
      intervalSeconds,
    ]),
  );
  let queued = 0;
  for (const { id: accountId } of accounts) {
    queued += await tenant(db, accountId, async (trx) => {
      await trx.raw("SELECT pg_advisory_xact_lock_shared(68142019)");
      const account = await trx("accounts")
        .where({ id: accountId, status: "active" })
        .forUpdate()
        .first();
      if (!account) return 0;
      const profiles = resolveProfiles
        ? await resolveProfiles(trx)
        : {
            embedding: providers.embedding?.profile,
            decision: providers.decision?.profile,
            generation: providers.generation?.profile,
          };
      let count = 0;
      if (account.noteConnectionsEnabled || account.notebookConnectionsEnabled)
        count += await scheduleRelationships(trx, accountId, {
          embedding: profiles.embedding ?? null,
          decision: profiles.decision ?? null,
          generation: profiles.generation ?? null,
        });
      for (const [kind, profile] of [
        ["embedding", profiles.embedding],
        ["decision", account.classificationEnabled && profiles.decision],
        ["organization", account.titlesTagsEnabled && profiles.generation],
      ] as const) {
        if (!profile) continue;
        const output =
          kind === "embedding" ? "memory_embeddings" : "memory_enrichments";
        const rows = await trx("memories as m")
          .where("m.status", "active")
          .where((b) =>
            b
              .whereNull("m.expiresAt")
              .orWhere("m.expiresAt", ">", trx.fn.now()),
          )
          .whereNotExists(
            trx("jobs as j")
              .select(trx.raw("1"))
              .whereRaw(
                "j.account_id = m.account_id AND j.memory_id = m.id AND j.version = m.version",
              )
              .where({ "j.kind": kind, "j.profile": profile }),
          )
          .where((b) => {
            b.whereNotExists(
              trx(`${output} as e`)
                .select(trx.raw("1"))
                .whereRaw(
                  "e.account_id = m.account_id AND e.memory_id = m.id AND e.version = m.version",
                )
                .where("e.profile", profile),
            );
            if (kind === "decision")
              b.orWhereRaw(
                `EXISTS (SELECT 1 FROM memory_enrichments e WHERE e.account_id=m.account_id AND e.memory_id=m.id AND e.version=m.version AND e.profile=? AND e.kind='decision' AND (
              EXISTS (SELECT 1 FROM jsonb_array_elements(e.sources) s WHERE NOT EXISTS (SELECT 1 FROM memories r WHERE r.account_id=m.account_id AND r.id=(s->>'id')::uuid AND r.version=(s->>'version')::int AND r.project_id IS NOT DISTINCT FROM m.project_id AND r.status='active' AND (r.expires_at IS NULL OR r.expires_at>now())))
              OR (e.created_at < now()-interval '1 day' AND EXISTS (SELECT 1 FROM memories r WHERE r.account_id=m.account_id AND r.project_id IS NOT DISTINCT FROM m.project_id AND r.status='active' AND r.created_at>e.created_at))
            ))`,
                [profile],
              );
          })
          .orderBy("m.updatedAt")
          .limit(100)
          .select("m.id", "m.version");
        for (const row of rows) {
          const inserted = await trx("jobs")
            .insert({
              accountId,
              memoryId: row.id,
              version: row.version,
              target: row.id,
              kind,
              profile,
            })
            .onConflict(["accountId", "kind", "target", "profile"])
            .ignore()
            .returning("id");
          count += inserted.length;
        }
      }
      // briefFor verifies exact revisions and expiry even when no API read occurs.
      if (
        summaryPreferences.some((key) => account[key]) &&
        providers.generation &&
        profiles.generation === providers.generation.profile
      ) {
        const projects = await trx("memories").distinct("projectId").limit(101);
        const tasks = await trx("memories")
          .where({ kind: "handoff", status: "active" })
          .where((b) =>
            b.whereNull("expiresAt").orWhere("expiresAt", ">", trx.fn.now()),
          )
          .orderBy("updatedAt", "desc")
          .limit(100)
          .select("projectId", "taskId");
        const old = await trx("memory_briefs")
          .where({ profile: profiles.generation })
          .select("scope")
          .limit(200);
        const scopes = new Map<string, BriefRequest>();
        for (const scope of [
          { projectId: null },
          ...projects,
          ...tasks,
          ...old.map((r) => r.scope),
        ] as BriefRequest[])
          scopes.set(JSON.stringify(scope), scope);
        for (const scope of scopes.values())
          await briefFor(trx, accountId, scope, providers);
      }
      await trx("transactional_emails")
        .where((b) => b.whereNotNull("sentAt").orWhereNotNull("failedAt"))
        .where("createdAt", "<", trx.raw("now() - interval '30 days'"))
        .delete();
      return count;
    });
  }
  return { accounts: accounts.length, queued };
}
