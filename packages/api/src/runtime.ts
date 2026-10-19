import { createDatabase, closeDatabase, probeDatabase } from "@lib/database";
import { readServerEnvironment } from "@lib/environment";
import { MemoryService } from "@lib/memory";
import { createLocalEmbedder } from "./embedding.ts";

export async function createRuntime() {
  const env = readServerEnvironment();
  const db = createDatabase(env.DATABASE_URL, {
    ssl: env.DATABASE_SSL === "require",
  });
  try {
    await probeDatabase(db);
    const embedder =
      env.EMBEDDING_MODE === "local"
        ? await createLocalEmbedder(env.EMBEDDING_CACHE)
        : undefined;
    return {
      env,
      db,
      memories: new MemoryService(db, env.CURSOR_SECRET, embedder),
      close: () => closeDatabase(db),
    };
  } catch (error) {
    await closeDatabase(db);
    throw error;
  }
}
