import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  createRemoteEmbedder,
  createDecisionProvider,
  createGenerationProvider,
  type Providers,
} from "@lib/ai";
import {
  modelConfigSchema,
  type ModelConfig,
  type ModelRole,
  type ModelSettings,
} from "@lib/shared/models";
import { GroveError, type Principal } from "@lib/shared/contracts";
import { policy } from "@lib/config";
import type { ServerEnvironment } from "@lib/environment";
import type { Knex } from "@lib/database";
import { budgetedInference, type MemoryService } from "@lib/memory";
import { createLocalEmbedder } from "./embedding.ts";

const roles = ["embedding", "decision", "generation"] as const;
export function environmentModels(env: ServerEnvironment): ModelConfig {
  const cloud = env.GROVE_EDITION === "cloud";
  if (cloud && (!env.DEEPINFRA_API_KEY || !env.MINIMAX_API_KEY))
    throw new Error("Cloud requires DEEPINFRA_API_KEY and MINIMAX_API_KEY");
  const remote = cloud || env.EMBEDDING_MODE === "remote";
  return modelConfigSchema.parse({
    embedding: {
      provider: remote
        ? "openai-compatible"
        : env.EMBEDDING_MODE === "disabled"
          ? "disabled"
          : "local",
      baseUrl: cloud
        ? "https://api.deepinfra.com/v1/openai"
        : (env.EMBEDDING_URL ?? "https://api.deepinfra.com/v1/openai"),
      model: cloud
        ? "Qwen/Qwen3-Embedding-8B"
        : (env.EMBEDDING_MODEL ??
          (remote ? "Qwen/Qwen3-Embedding-8B" : policy.embeddingModel)),
      apiKey: cloud
        ? env.DEEPINFRA_API_KEY
        : (env.EMBEDDING_API_KEY ?? env.DEEPINFRA_API_KEY ?? ""),
      dimensions: cloud
        ? 4096
        : (env.EMBEDDING_DIMENSIONS ?? (remote ? 4096 : 384)),
      queryPrefix: cloud
        ? "Instruct: Retrieve relevant personal or project memories that answer the query.\nQuery: "
        : (env.EMBEDDING_QUERY_PREFIX ??
          (remote &&
          (!env.EMBEDDING_MODEL ||
            env.EMBEDDING_MODEL === "Qwen/Qwen3-Embedding-8B")
            ? "Instruct: Retrieve relevant personal or project memories that answer the query.\nQuery: "
            : "")),
      documentPrefix: cloud ? "" : (env.EMBEDDING_DOCUMENT_PREFIX ?? ""),
      distanceThreshold:
        env.EMBEDDING_DISTANCE_THRESHOLD ?? (remote ? 0.65 : 0.45),
    },
    decision: {
      provider: cloud ? "system-one" : env.DECISION_PROVIDER,
      baseUrl: cloud
        ? "https://api.deepinfra.com/v1"
        : (env.DECISION_URL ?? "https://api.deepinfra.com/v1"),
      model: cloud
        ? "Cloudflare/clef-flash"
        : (env.DECISION_MODEL ?? "Cloudflare/clef-flash"),
      apiKey: cloud
        ? env.DEEPINFRA_API_KEY
        : (env.DECISION_API_KEY ?? env.DEEPINFRA_API_KEY ?? ""),
      path: cloud ? "/decisions" : env.DECISION_PATH,
    },
    generation: {
      provider: cloud ? "minimax" : env.GENERATION_PROVIDER,
      baseUrl: cloud
        ? "https://api.minimax.io/v1"
        : (env.GENERATION_URL ?? "https://api.minimax.io/v1"),
      model: cloud
        ? "MiniMax-M3.1-Flash"
        : (env.GENERATION_MODEL ?? "MiniMax-M3.1-Flash"),
      apiKey: cloud
        ? env.MINIMAX_API_KEY
        : (env.GENERATION_API_KEY ?? env.MINIMAX_API_KEY ?? ""),
      outputFormat: env.GENERATION_OUTPUT_FORMAT,
      reasoningEffort: env.GENERATION_REASONING_EFFORT,
      maxOutputTokens: env.GENERATION_MAX_OUTPUT_TOKENS,
      timeoutMs: 60000,
    },
  });
}
export function remoteProviders(config: ModelConfig): Providers {
  return {
    embedding:
      config.embedding.provider === "openai-compatible"
        ? createRemoteEmbedder(config.embedding)
        : undefined,
    decision:
      config.decision.provider === "system-one"
        ? createDecisionProvider(config.decision)
        : undefined,
    generation:
      config.generation.provider !== "disabled"
        ? createGenerationProvider(config.generation)
        : undefined,
  };
}
export function modelProfiles(config: ModelConfig) {
  const providers = remoteProviders(config);
  return {
    embedding:
      config.embedding.provider === "local"
        ? policy.embeddingProfile
        : (providers.embedding?.profile ?? null),
    decision: providers.decision?.profile ?? null,
    generation: providers.generation?.profile ?? null,
  };
}
function encrypt(config: ModelConfig, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from("grove-model-settings-v1"));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(config), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
function decrypt(encrypted: string, key: string) {
  const bytes = Buffer.from(encrypted, "base64");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    bytes.subarray(0, 12),
  );
  cipher.setAAD(Buffer.from("grove-model-settings-v1"));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return modelConfigSchema.parse(
    JSON.parse(
      Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString("utf8"),
    ),
  );
}

export class ModelRegistry {
  config: ModelConfig;
  version = 0;
  private applied = "";
  private refreshing?: Promise<void>;
  private local?: ReturnType<typeof createLocalEmbedder>;
  constructor(
    readonly db: Knex,
    readonly env: ServerEnvironment,
    readonly service: MemoryService,
  ) {
    this.config = environmentModels(env);
    this.service.jobProfiles = async (trx) =>
      modelProfiles((await this.load(trx)).config);
  }
  canEdit(principal: Principal) {
    return (
      this.env.GROVE_EDITION === "self-hosted" &&
      !!this.env.MODEL_SETTINGS_KEY &&
      principal.type === "session" &&
      this.env.MODEL_ADMIN_SUBJECTS.split(",")
        .map((v) => v.trim())
        .includes(principal.subject)
    );
  }
  assertEditor(principal: Principal) {
    if (!this.canEdit(principal))
      throw new GroveError(
        "forbidden",
        "Model settings require the configured installation administrator",
        403,
      );
  }
  async load(db: Knex | Knex.Transaction = this.db) {
    if (this.env.GROVE_EDITION === "cloud")
      return { config: environmentModels(this.env), version: 0 };
    const stored = await db("model_settings")
      .where({ singleton: true })
      .first();
    if (!stored) return { config: environmentModels(this.env), version: 0 };
    if (!this.env.MODEL_SETTINGS_KEY)
      throw new Error(
        "MODEL_SETTINGS_KEY is required for stored model configuration",
      );
    return {
      config: decrypt(stored.encrypted, this.env.MODEL_SETTINGS_KEY),
      version: stored.version as number,
    };
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.apply().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  private async apply() {
    const { config, version } = await this.load();
    const fingerprint = JSON.stringify(config);
    if (this.applied === fingerprint) {
      this.version = version;
      return;
    }
    const providers = remoteProviders(config);
    if (config.embedding.provider === "local") {
      this.local ??= createLocalEmbedder(this.env.EMBEDDING_CACHE).catch(
        (error) => {
          this.local = undefined;
          throw error;
        },
      );
      providers.embedding = await this.local;
    }
    if (providers.embedding)
      await this.db("embedding_profiles")
        .insert({
          id: providers.embedding.profile,
          model: providers.embedding.model,
          dimensions: providers.embedding.dimensions,
        })
        .onConflict("id")
        .ignore();
    this.service.providers = providers;
    this.config = config;
    this.version = version;
    this.applied = fingerprint;
  }
  describe(principal: Principal): ModelSettings {
    const config = structuredClone(this.config);
    const credentials = {
      embedding: false,
      decision: false,
      generation: false,
    };
    for (const role of roles) {
      credentials[role] = !!config[role].apiKey;
      config[role].apiKey = "";
    }
    return {
      edition: this.env.GROVE_EDITION,
      editable: this.canEdit(principal),
      version: this.version,
      config,
      credentials,
      profiles: modelProfiles(config),
    };
  }
  async save(
    principal: Principal,
    input: {
      expectedVersion: number;
      config: ModelConfig;
      clearKeys: ModelRole[];
    },
  ) {
    this.assertEditor(principal);
    return this.service.access(
      principal,
      "admin",
      async ({ trx }) => {
        const previous = await this.load(trx);
        if (previous.version !== input.expectedVersion)
          throw new GroveError(
            "version_conflict",
            "Model settings changed; reload before saving",
            409,
          );
        const config = structuredClone(input.config);
        for (const role of roles) {
          if (input.clearKeys.includes(role)) config[role].apiKey = "";
          else if (!config[role].apiKey) {
            if (
              config[role].baseUrl !== previous.config[role].baseUrl &&
              previous.config[role].apiKey
            )
              throw new GroveError(
                "credential_required",
                "Supply a key or clear it when changing the provider URL",
              );
            config[role].apiKey = previous.config[role].apiKey;
          }
        }
        const profiles = modelProfiles(config);
        if (profiles.embedding)
          await trx("embedding_profiles")
            .insert({
              id: profiles.embedding,
              model: config.embedding.model,
              dimensions: config.embedding.dimensions,
            })
            .onConflict("id")
            .ignore();
        await trx("model_settings")
          .insert({
            singleton: true,
            version: previous.version + 1,
            encrypted: encrypt(config, this.env.MODEL_SETTINGS_KEY!),
            updatedAt: trx.fn.now(),
          })
          .onConflict("singleton")
          .merge(["version", "encrypted", "updatedAt"]);
        if (
          JSON.stringify(modelProfiles(previous.config)) !==
          JSON.stringify(profiles)
        )
          await trx.raw("SELECT grove_reprocess(?, ?, ?)", [
            profiles.embedding,
            profiles.decision,
            profiles.generation,
          ]);
      },
      true,
    );
  }
  async test(role: ModelRole, accountId: string) {
    return budgetedInference(
      this.db,
      accountId,
      role,
      this.env.AI_DAILY_REQUEST_LIMIT,
      async (options) => {
        const request = { ...options, signal: AbortSignal.timeout(10000) };
        const start = Date.now();
        const providers = this.service.providers;
        if (role === "embedding" && providers.embedding) {
          const vector = await providers.embedding.embed(
            "Grove connection test",
            "query",
            request,
          );
          return {
            role,
            status: "ready",
            dimensions: vector.length,
            latencyMs: Date.now() - start,
          };
        }
        const sources = [
          {
            id: "00000000-0000-4000-8000-000000000001",
            version: 1,
            content: "The user prefers concise replies.",
            kind: "preference",
          },
        ];
        if (role === "decision" && providers.decision)
          await providers.decision.classify(sources[0], [], request);
        else if (role === "generation" && providers.generation) {
          const { organizationSchema } = await import("@lib/shared/models");
          await providers.generation.generate(
            organizationSchema,
            "Give this memory a title and tags.",
            sources,
            request,
          );
        } else
          throw new GroveError(
            "provider_disabled",
            "This model role is disabled",
          );
        return { role, status: "ready", latencyMs: Date.now() - start };
      },
    );
  }
}
