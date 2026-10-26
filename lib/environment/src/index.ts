import { z } from "zod";
import { billingLimits, resourceLimits } from "@lib/shared/billing";

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
const allowance = (value: number) =>
  z.coerce.number().int().min(0).max(1000000000).default(value);
const serverSchema = z.object({
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
  // Public ownership proof, never an account credential. Empty values are omitted below.
  OPENAI_APPS_CHALLENGE: z
    .string()
    .min(1)
    .max(512)
    .refine(
      (value) => !/\s/.test(value),
      "Use the exact non-whitespace verification token",
    )
    .optional(),
  CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  CLERK_ISSUER: origin,
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1),
  GROVE_EDITION: z.enum(["self-hosted", "cloud"]).default("self-hosted"),
  BILLING_CONFIGURED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  FLAGS: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z
    .string()
    .regex(/^(sk|rk)_(test|live)_/)
    .optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_PRO_PRODUCT_ID: z.string().startsWith("prod_").optional(),
  STRIPE_PORTAL_CONFIGURATION_ID: z.string().startsWith("bpc_").optional(),
  STRIPE_PRO_MONTHLY_PRICE_ID: z.string().startsWith("price_").optional(),
  STRIPE_PRO_YEARLY_PRICE_ID: z.string().startsWith("price_").optional(),
  BILLING_FREE_GENERATION_DAILY: allowance(
    billingLimits.free.generation.daily!,
  ),
  BILLING_FREE_GENERATION_MONTHLY: allowance(
    billingLimits.free.generation.monthly,
  ),
  BILLING_PRO_GENERATION_DAILY: allowance(billingLimits.pro.generation.daily!),
  BILLING_PRO_GENERATION_MONTHLY: allowance(
    billingLimits.pro.generation.monthly,
  ),
  BILLING_FREE_RESEARCH_DAILY: allowance(billingLimits.free.research.daily!),
  BILLING_FREE_RESEARCH_MONTHLY: allowance(billingLimits.free.research.monthly),
  BILLING_PRO_RESEARCH_DAILY: allowance(billingLimits.pro.research.daily!),
  BILLING_PRO_RESEARCH_MONTHLY: allowance(billingLimits.pro.research.monthly),
  BILLING_FREE_TRANSCRIPTION_MONTHLY_MS: allowance(
    billingLimits.free.transcription.monthly,
  ),
  BILLING_PRO_TRANSCRIPTION_MONTHLY_MS: allowance(
    billingLimits.pro.transcription.monthly,
  ),
  BILLING_FREE_SYNTHESIS_MONTHLY_MS: allowance(
    billingLimits.free.synthesis.monthly,
  ),
  BILLING_PRO_SYNTHESIS_MONTHLY_MS: allowance(
    billingLimits.pro.synthesis.monthly,
  ),
  BILLING_FREE_NOTES: allowance(resourceLimits.free.notes),
  BILLING_FREE_NOTEBOOKS: allowance(resourceLimits.free.notebooks),
  BILLING_FREE_RECALL_MONTHLY: allowance(resourceLimits.free.recall),
  BILLING_FREE_ASK_MONTHLY: allowance(resourceLimits.free.ask),
  BILLING_FREE_ORGANIZATION_MONTHLY: allowance(
    resourceLimits.free.organization,
  ),
  BILLING_FREE_ASSISTANCE_MONTHLY: allowance(resourceLimits.free.assistance),
  BILLING_PRO_NOTES: allowance(resourceLimits.pro.notes),
  BILLING_PRO_NOTEBOOKS: allowance(resourceLimits.pro.notebooks),
  BILLING_PRO_RECALL_MONTHLY: allowance(resourceLimits.pro.recall),
  BILLING_PRO_ASK_MONTHLY: allowance(resourceLimits.pro.ask),
  BILLING_PRO_ORGANIZATION_MONTHLY: allowance(resourceLimits.pro.organization),
  BILLING_PRO_ASSISTANCE_MONTHLY: allowance(resourceLimits.pro.assistance),
  // Reject old deployment settings instead of silently treating characters as time.
  BILLING_FREE_SYNTHESIS_MONTHLY_CHARACTERS: z.string().optional(),
  BILLING_PRO_SYNTHESIS_MONTHLY_CHARACTERS: z.string().optional(),
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
  OPENAI_API_KEY: z.string().optional(),
  SPEECH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  TTS_VOICE: z
    .enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"])
    .default("alloy"),
  MINIMAX_TTS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SPEECH_PROVIDER_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(16)
    .default(2),
  EXA_API_KEY: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  RESEARCH_DAILY_CALL_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(20),
  RESEARCH_MONTHLY_BUDGET_USD: z.coerce
    .number()
    .min(0)
    .max(100000)
    .default(100),
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
export const serverEnvironmentSchema = serverSchema.superRefine((env, ctx) => {
  for (const tier of ["FREE", "PRO"] as const) {
    const path = `BILLING_${tier}_SYNTHESIS_MONTHLY_CHARACTERS` as const;
    if (env[path] !== undefined)
      ctx.addIssue({
        code: "custom",
        path: [path],
        message:
          "Replace SYNTHESIS_MONTHLY_CHARACTERS with SYNTHESIS_MONTHLY_MS; characters are not audio duration",
      });
  }
  if (
    env.BILLING_CONFIGURED &&
    (env.GROVE_EDITION !== "cloud" ||
      !env.FLAGS ||
      !env.STRIPE_SECRET_KEY ||
      !env.STRIPE_WEBHOOK_SECRET ||
      (!env.STRIPE_PRO_PRODUCT_ID &&
        !env.STRIPE_PRO_MONTHLY_PRICE_ID &&
        !env.STRIPE_PRO_YEARLY_PRICE_ID))
  )
    ctx.addIssue({
      code: "custom",
      message:
        "Billing requires cloud edition, FLAGS, Stripe credentials and at least one Pro price",
    });
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
