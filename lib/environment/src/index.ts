import { z } from "zod";

const origin = z.url().transform((value, ctx) => {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Use an HTTPS origin (HTTP is allowed on loopback)",
    });
    return z.NEVER;
  }
  return url.origin;
});
export const serverEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(26080),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["require", "disable"]).default("disable"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(64).default(8),
  DATABASE_ACQUIRE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30000)
    .default(2000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30000)
    .default(10000),
  API_MAX_IN_FLIGHT: z.coerce.number().int().min(1).max(256).default(32),
  API_MAX_QUEUED: z.coerce.number().int().min(0).max(256).default(32),
  API_QUEUE_TIMEOUT_MS: z.coerce.number().int().min(1).max(5000).default(250),
  API_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60000)
    .default(10000),
  API_INTERACTIVE_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(32)
    .default(4),
  API_INTERACTIVE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(180000)
    .default(90000),
  API_ORIGIN: origin,
  SITE_URL: origin,
  CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  CLERK_ISSUER: origin,
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1),
  GROVE_EDITION: z.enum(["self-hosted", "cloud"]).default("self-hosted"),
  EMBEDDING_MODE: z.enum(["local", "remote", "disabled"]).optional(),
  EMBEDDING_CACHE: z.string().default("./data/models"),
  EMBEDDING_URL: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(32).max(16000).optional(),
  EMBEDDING_QUERY_PREFIX: z.string().optional(),
  EMBEDDING_DOCUMENT_PREFIX: z.string().optional(),
  EMBEDDING_DISTANCE_THRESHOLD: z.coerce.number().min(0).max(2).optional(),
  DECISION_PROVIDER: z.enum(["system-one", "disabled"]).default("disabled"),
  DECISION_URL: z.string().optional(),
  DECISION_MODEL: z.string().optional(),
  DECISION_API_KEY: z.string().optional(),
  DECISION_PATH: z.enum(["/decisions", "/systemone"]).default("/decisions"),
  GENERATION_PROVIDER: z
    .enum(["minimax", "openai-compatible", "disabled"])
    .default("disabled"),
  GENERATION_URL: z.string().optional(),
  GENERATION_MODEL: z.string().optional(),
  GENERATION_API_KEY: z.string().optional(),
  GENERATION_OUTPUT_FORMAT: z
    .enum(["tool", "json-schema", "json"])
    .default("tool"),
  GENERATION_REASONING_EFFORT: z
    .enum(["low", "medium", "high", "omit"])
    .default("low"),
  GENERATION_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(256)
    .max(16384)
    .default(4096),
  DEEPINFRA_API_KEY: z.string().optional(),
  MINIMAX_API_KEY: z.string().optional(),
  MODEL_ADMIN_SUBJECTS: z.string().default(""),
  MODEL_SETTINGS_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  AI_DAILY_REQUEST_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000000)
    .default(2000),
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  INDEXING_CONCURRENCY: z.coerce.number().int().min(0).max(32).default(2),
  EMAIL_CONCURRENCY: z.coerce.number().int().min(0).max(8).default(1),
  MAINTENANCE_CONCURRENCY: z.coerce.number().int().min(0).max(8).default(1),
  BULK_CONCURRENCY: z.coerce.number().int().min(0).max(8).default(1),
  JOB_ACCOUNT_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  JOB_PROVIDER_CONCURRENCY: z.coerce.number().int().min(1).max(128).default(8),
  WORKER_LANES: z
    .string()
    .default("indexing,enrichment,email,maintenance,bulk")
    .refine(
      (value) =>
        value
          .split(",")
          .every((lane) =>
            ["indexing", "enrichment", "email", "maintenance", "bulk"].includes(
              lane,
            ),
          ),
      "Unknown worker lane",
    ),
  WORKER_LEGACY_QUEUE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  EXPORT_STORAGE: z.enum(["disabled", "local", "s3"]).optional(),
  // Explicit opt-in until the revision-scoped media API is available.
  MEDIA_STORAGE: z.enum(["disabled", "local", "s3"]).default("disabled"),
  MEDIA_DIRECTORY: z.string().default("./data/media"),
  MEDIA_S3_ENDPOINT: z.url().optional(),
  MEDIA_S3_REGION: z.string().default("us-east-1"),
  MEDIA_S3_BUCKET: z.string().optional(),
  MEDIA_S3_ACCESS_KEY_ID: z.string().optional(),
  MEDIA_S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Exact endpoint/bucket receipt from an operator lifecycle/ACL inspection.
  // Spaces scoped keys cannot read these settings; never use an account-wide key in runtime.
  MEDIA_S3_LIFECYCLE_VERIFIED_FOR: z.string().optional(),
  MEDIA_S3_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  EXPORT_DIRECTORY: z.string().default("./data/exports"),
  EXPORT_S3_ENDPOINT: z.url().optional(),
  EXPORT_S3_REGION: z.string().default("us-east-1"),
  EXPORT_S3_BUCKET: z.string().optional(),
  EXPORT_S3_ACCESS_KEY_ID: z.string().optional(),
  EXPORT_S3_SECRET_ACCESS_KEY: z.string().optional(),
  EXPORT_S3_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AMQP_URL: z
    .url()
    .refine(
      (value) => new URL(value).protocol === "amqps:",
      "Use TLS for the job broker",
    )
    .optional(),
  ORGANIZATION_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86400)
    .default(900),
  RESEND_API_KEY: z.string().startsWith("re_").optional(),
  EMAIL_FROM: z.string().email().default("notifications@mail.usegrove.cloud"),
  CURSOR_SECRET: z.string().min(32),
  SHARE_LINK_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
});
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;
export function readServerEnvironment(env = process.env): ServerEnvironment {
  return serverEnvironmentSchema.parse(
    Object.fromEntries(
      Object.entries(env).filter(
        ([key, value]) =>
          value !== "" ||
          ["EMBEDDING_QUERY_PREFIX", "EMBEDDING_DOCUMENT_PREFIX"].includes(key),
      ),
    ),
  );
}
