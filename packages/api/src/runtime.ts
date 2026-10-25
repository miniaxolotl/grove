import { createDatabase, closeDatabase, probeDatabase } from "@lib/database";
import {
  readServerEnvironment,
  type ServerEnvironment,
} from "@lib/environment";
import { createClient } from "@vercel/flags-core";
import { miniMaxTtsFlagKey } from "@lib/shared/speech-voices";
import { MemoryService } from "@lib/memory";
import { ModelRegistry } from "./models.ts";
import { createBilling } from "./billing-runtime.ts";
import { createArtifacts } from "./artifacts.ts";
import { createMediaStore } from "./media-store.ts";
import {
  createOpenAiSpeech,
  createMiniMaxSpeech,
  miniMaxSpeechVoices,
  createResearchProvider,
  type SpeechProviders,
} from "@lib/ai";

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
    await db.raw(
      "SELECT transcription_enabled,read_aloud_enabled,read_aloud_voice_id FROM accounts LIMIT 0",
    );
    await db.raw("SELECT synthesis_profiles FROM speech_configuration LIMIT 0");
    await db.raw(
      "SELECT speech_cache_key,speech_text_hash FROM export_objects LIMIT 0",
    );
    if (env.MEDIA_STORAGE !== "disabled") {
      await db.raw(
        "SELECT status,lease_id,object_key,duration_ms FROM media_objects LIMIT 0",
      );
      await db.raw("SELECT media_id,version FROM media_transcripts LIMIT 0");
      await db.raw(
        "SELECT media_id,version FROM media_revision_bindings LIMIT 0",
      );
    }
    const memories = new MemoryService(
      db,
      env.CURSOR_SECRET,
      undefined,
      {},
      env.AI_DAILY_REQUEST_LIMIT,
    );
    const models = new ModelRegistry(db, env, memories);
    if (env.BILLING_CONFIGURED) {
      await db.raw(
        "SELECT id,period,lease_id,worked FROM action_usage LIMIT 0",
      );
      await db.raw("SELECT id,lease_until FROM ai_operation_leases LIMIT 0");
      await db.raw(
        "SELECT id,price_id,product_id,period_end FROM billing_subscriptions LIMIT 0",
      );
    }
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
    const media = await createMediaStore(env);
    try {
      await media?.ready();
    } catch (error) {
      media?.close?.();
      artifacts?.close?.();
      throw error;
    }
    const speechFlags =
      env.SPEECH_ENABLED && env.FLAGS
        ? createClient(env.FLAGS, { staleIfError: 0, staleWhileRevalidate: 0 })
        : undefined;
    let speech: SpeechProviders;
    let billingRuntime: ReturnType<typeof createBilling>;
    try {
      speech = createSpeechProviders(
        env,
        !!media,
        !!artifacts,
        speechFlags
          ? async () =>
              (await speechFlags.evaluate<boolean>(miniMaxTtsFlagKey, false))
                .value === true
          : undefined,
      );
      billingRuntime = createBilling(env, memories);
    } catch (error) {
      await speechFlags?.shutdown();
      artifacts?.close?.();
      media?.close?.();
      throw error;
    }
    return {
      env,
      db,
      memories,
      models,
      artifacts,
      media,
      speech,
      billing: billingRuntime?.billing,
      close: async () => {
        await speechFlags?.shutdown();
        await billingRuntime?.close();
        artifacts?.close?.();
        media?.close?.();
        await closeDatabase(db);
      },
    };
  } catch (error) {
    await closeDatabase(db);
    throw error;
  }
}

/** FLAGS is the cloud control; the environment opt-in remains for self-hosting.
 * Providers stay registered while paused so a flag change needs no restart. */
export function createSpeechProviders(
  env: ServerEnvironment,
  media: boolean,
  artifacts: boolean,
  minimaxEnabled?: () => Promise<boolean>,
): SpeechProviders {
  if (!env.SPEECH_ENABLED) return {};
  if (!env.OPENAI_API_KEY?.trim()) throw new Error("speech_api_key_required");
  const remote = createOpenAiSpeech({
    apiKey: env.OPENAI_API_KEY,
    voice: env.TTS_VOICE,
  });
  const speech: SpeechProviders = {
    ...(media ? { transcription: remote.transcription } : {}),
    ...(artifacts ? { synthesis: { reed: remote.synthesis } } : {}),
  };
  const configured = !!env.MINIMAX_API_KEY?.trim() && artifacts;
  if (!env.FLAGS && env.MINIMAX_TTS_ENABLED && !configured)
    throw new Error("minimax_speech_key_and_storage_required");
  if (configured && (env.FLAGS ? !!minimaxEnabled : env.MINIMAX_TTS_ENABLED)) {
    speech.synthesis = {
      ...speech.synthesis,
      ...Object.fromEntries(
        Object.entries(miniMaxSpeechVoices).map(([id, voice]) => [
          id,
          {
            ...createMiniMaxSpeech({ apiKey: env.MINIMAX_API_KEY!, voice }),
            sampleId: `${id}-v1`,
            ...(env.FLAGS ? { available: minimaxEnabled } : {}),
          },
        ]),
      ),
    };
  }
  return speech;
}
