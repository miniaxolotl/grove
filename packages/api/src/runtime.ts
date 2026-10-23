import { createDatabase, closeDatabase, probeDatabase } from "@lib/database";
import { readServerEnvironment } from "@lib/environment";
import { MemoryService } from "@lib/memory";
import { ModelRegistry } from "./models.ts";
import { createArtifacts } from "./artifacts.ts";
import { createResearchProvider } from "@lib/ai";

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
    memories.research = {
      ...(env.EXA_API_KEY
        ? { exa: createResearchProvider("exa", env.EXA_API_KEY) }
        : {}),
      ...(env.TAVILY_API_KEY
        ? { tavily: createResearchProvider("tavily", env.TAVILY_API_KEY) }
        : {}),
    };
    memories.researchLimits = {
      dailyCalls: env.RESEARCH_DAILY_CALL_LIMIT,
      monthlyMicrodollars: Math.floor(
        env.RESEARCH_MONTHLY_BUDGET_USD * 1_000_000,
      ),
    };
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
