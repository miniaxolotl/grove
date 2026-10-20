import { createDatabase, closeDatabase, probeDatabase } from "@lib/database";
import { readServerEnvironment } from "@lib/environment";
import { MemoryService } from "@lib/memory";
import { ModelRegistry } from "./models.ts";

export async function createRuntime() {
  const env = readServerEnvironment();
  const db = createDatabase(env.DATABASE_URL, {
    ssl: env.DATABASE_SSL === "require",
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
    return {
      env,
      db,
      memories,
      models,
      close: () => closeDatabase(db),
    };
  } catch (error) {
    await closeDatabase(db);
    throw error;
  }
}
