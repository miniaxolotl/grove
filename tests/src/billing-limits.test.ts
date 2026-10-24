import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { billingLimits } from "@lib/shared/billing";
import { readServerEnvironment } from "@lib/environment";

const expected = {
  free: {
    generation: { daily: 1000, monthly: 31000 },
    research: { daily: 20, monthly: 620 },
    transcription: { daily: null, monthly: 7200000 },
    synthesis: { daily: null, monthly: 7200000 },
  },
  pro: {
    generation: { daily: 5000, monthly: 155000 },
    research: { daily: 100, monthly: 3100 },
    transcription: { daily: null, monthly: 28800000 },
    synthesis: { daily: null, monthly: 28800000 },
  },
};
const environment = {
  DATABASE_URL: "postgresql://localhost/grove_test",
  API_ORIGIN: "https://api.example",
  SITE_URL: "https://site.example",
  CLERK_PUBLISHABLE_KEY: "pk_fixture",
  CLERK_SECRET_KEY: "sk_fixture",
  CLERK_ISSUER: "https://clerk.example",
  CLERK_WEBHOOK_SIGNING_SECRET: "fixture",
  CURSOR_SECRET: "billing-fixture-cursor-secret-32-characters",
};

test("tier defaults provide the agreed daily allowances and independent 2/8-hour speech budgets", () => {
  assert.deepEqual(billingLimits, expected);
});

test("environment, example and Compose defaults agree for every tier metric", async () => {
  const env = readServerEnvironment(environment);
  const example = await readFile(
    new URL("../../.env.example", import.meta.url),
    "utf8",
  );
  const compose = await readFile(
    new URL("../../docker-compose.yml", import.meta.url),
    "utf8",
  );
  for (const [tier, metrics] of Object.entries(expected)) {
    for (const [metric, limits] of Object.entries(metrics)) {
      for (const [period, value] of Object.entries(limits)) {
        if (value === null) continue;
        const suffix = ["transcription", "synthesis"].includes(metric)
          ? "_MS"
          : "";
        const key =
          `BILLING_${tier}_${metric}_${period}${suffix}`.toUpperCase();
        assert.equal(env[key as keyof typeof env], value, key);
        assert(example.includes(`${key}=${value}\n`), `${key} example`);
        assert(
          compose.includes(`${key}: \${${key}:-${value}}`),
          `${key} Compose`,
        );
      }
    }
  }
});

test("explicit zero/positive allowance overrides survive and legacy TTS character configuration cannot be mistaken for time", () => {
  const env = readServerEnvironment({
    ...environment,
    BILLING_FREE_GENERATION_DAILY: "0",
    BILLING_PRO_GENERATION_MONTHLY: "7",
    BILLING_FREE_SYNTHESIS_MONTHLY_MS: "0",
  });
  assert.equal(env.BILLING_FREE_GENERATION_DAILY, 0);
  assert.equal(env.BILLING_PRO_GENERATION_MONTHLY, 7);
  assert.equal(env.BILLING_FREE_SYNTHESIS_MONTHLY_MS, 0);
  assert.throws(
    () =>
      readServerEnvironment({
        ...environment,
        BILLING_FREE_SYNTHESIS_MONTHLY_CHARACTERS: "10000",
      }),
    /SYNTHESIS_MONTHLY_CHARACTERS|character/i,
  );
});
