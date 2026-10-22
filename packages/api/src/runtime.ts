import { createDatabase, closeDatabase, probeDatabase } from "@lib/database";
import { readServerEnvironment } from "@lib/environment";
import { MemoryService } from "@lib/memory";
import { ModelRegistry } from "./models.ts";
import { createArtifacts } from "./artifacts.ts";

export async function createRuntime() {
  const env = readServerEnvironment();
  const db = createDatabase(env.DATABASE_URL, {
    ssl: env.DATABASE_SSL === "require",
    max: env.DATABASE_POOL_MAX,
    acquireTimeoutMs: env.DATABASE_ACQUIRE_TIMEOUT_MS,
    statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
  });
  try {
    await probeDatabase(db);
    const memories = new MemoryService(
      db,
      env.CURSOR_SECRET,
      undefined,
      {},
      env.AI_DAILY_REQUEST_LIMIT,
    );
    const models = new ModelRegistry(db, env, memories);
    await models.refresh();
    const artifacts = createArtifacts(env);
    await artifacts?.ready?.();
    return {
      env,
      db,
      memories,
      models,
      artifacts,
      close: async () => {
        artifacts?.close?.();
        await closeDatabase(db);
      },
    };
  } catch (error) {
    await closeDatabase(db);
    throw error;
  }
}
