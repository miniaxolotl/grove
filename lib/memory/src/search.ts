import { MemoryModel, type Knex, type QueryBuilder } from "@lib/database";
import type { Embedder } from "@lib/ai";

/** Score each eligible full vector once, materializing only its ID and distance.
 * Fetch note bodies after top-k selection instead of repeating a correlated
 * embedding lookup for every match. CASE protects mixed-dimension profiles from
 * optimizer reordering; tenant/scope/revision/expiry filters stay in PostgreSQL. */
export function semanticMatches(
  trx: Knex.Transaction,
  eligible: QueryBuilder<MemoryModel>,
  embedder: Embedder,
  vector: number[],
  limit: number,
) {
  const scored = eligible
    .select(
      "memories.id",
      trx.raw(
        "CASE WHEN e.profile = ? THEN e.embedding <=> ?::vector END AS distance",
        [embedder.profile, JSON.stringify(vector)],
      ),
    )
    .join("memory_embeddings as e", (join) =>
      join
        .on("e.accountId", "memories.accountId")
        .on("e.memoryId", "memories.id")
        .on("e.version", "memories.version"),
    )
    .where("e.profile", embedder.profile)
    .toKnexQuery();
  const ranked = trx
    .withMaterialized("scored", scored)
    .select("id", "distance")
    .from("scored")
    .where("distance", "<", embedder.distanceThreshold ?? 0.45)
    .orderBy("distance")
    .orderBy("id")
    .limit(limit);
  return MemoryModel.query(trx)
    .select("memories.*")
    .join(ranked.as("ranked"), "ranked.id", "memories.id")
    .orderBy("ranked.distance")
    .orderBy("memories.id");
}
