import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase, type Knex } from "@lib/database";
import { MemoryService } from "@lib/memory";
import { readServerEnvironment } from "@lib/environment";
import { ModelRegistry, modelProfiles } from "../../packages/api/src/models.ts";

export async function modelDataCounts(db: Knex) {
  const counts: Record<string, number> = {};
  for (const table of [
    "memories",
    "memory_revisions",
    "memory_embeddings",
    "memory_enrichments",
    "memory_briefs",
    "memory_relationships",
    "notebook_relationships",
    "notebook_profiles",
    "notebook_summary_nodes",
    "notebook_summary_work",
    "jobs",
    "ai_cache",
    "ai_provider_backoff",
  ])
    counts[table] = Number(
      (await db(table).count("* as count").first())?.count ?? 0,
    );
  return counts;
}
export async function resetModelData(db: Knex) {
  return db.transaction(async (trx) => {
    await trx.raw("SELECT pg_advisory_xact_lock(68142019)");
    // Serialize with writes and worker completion, which lock the account first.
    await trx("accounts").orderBy("id").forUpdate().select("id");
    const before = await modelDataCounts(trx);
    await trx("processing_control").increment("epoch", 1);
    await trx("ai_cache").delete();
    await trx("ai_provider_backoff").delete();
    await trx.raw(
      "INSERT INTO deleted_memories(account_id,id) SELECT account_id,id FROM memories ON CONFLICT DO NOTHING",
    );
    await trx("jobs").delete();
    await trx("memory_briefs").delete();
    await trx("memory_embeddings").delete();
    await trx("memory_enrichments").delete();
    await trx("memory_relationships").delete();
    await trx("notebook_summary_nodes").delete();
    await trx("notebook_summary_work").delete();
    await trx("notebook_relationships").delete();
    await trx("notebook_profiles").delete();
    await trx("memories").delete();
    await trx("memory_operations").delete();
    await trx("assistance_requests").update({
      status: "stale",
      version: trx.raw("version+1"),
      result: null,
      state: "{}",
      undo: null,
      error: "Notes were reset. Refresh this preview.",
    });
    await trx("notebook_visits").delete();
    await trx("notebook_checkpoints").delete();
    await trx("accounts").increment("contentVersion", 1);
    return { before, after: await modelDataCounts(trx) };
  });
}
async function main() {
  const action = process.argv[2];
  if (!["status", "reindex", "reset"].includes(action))
    throw new Error("Use models.ts status|reindex|reset");
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  const db = createDatabase(url, {
    ssl: process.env.DATABASE_SSL === "require",
    max: 2,
  });
  try {
    if (action === "status")
      console.log(JSON.stringify(await modelDataCounts(db)));
    else if (action === "reset")
      console.log(JSON.stringify(await resetModelData(db)));
    else {
      const env = readServerEnvironment();
      const registry = new ModelRegistry(
        db,
        env,
        new MemoryService(db, env.CURSOR_SECRET),
      );
      const { config } = await registry.load();
      const profiles = modelProfiles(config);
      await db.transaction(async (trx) => {
        await trx.raw("SELECT pg_advisory_xact_lock(68142019)");
        await trx.raw("SELECT grove_reprocess(?, ?, ?)", [
          profiles.embedding,
          profiles.decision,
          profiles.generation,
        ]);
      });
      console.log(JSON.stringify({ profiles, ...(await modelDataCounts(db)) }));
    }
  } finally {
    await db.destroy();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error(
      "Model operation failed. Check the command, database owner connection, encryption key and model configuration.",
    );
    process.exitCode = 1;
  });
