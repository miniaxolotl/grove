import { test } from "node:test";
import assert from "node:assert/strict";
import { readServerEnvironment } from "@lib/environment";
import * as runtime from "../../packages/api/src/runtime.ts";

const env = (overrides: Record<string, string> = {}) =>
  readServerEnvironment({
    DATABASE_URL: "postgresql://test:test@127.0.0.1/test",
    CURSOR_SECRET: "speech-flags-test-cursor-secret-32-characters",
    API_ORIGIN: "http://localhost:8787",
    SITE_URL: "http://localhost:3000",
    CLERK_PUBLISHABLE_KEY: "pk_test_fixture",
    CLERK_SECRET_KEY: "sk_test_fixture",
    CLERK_ISSUER: "https://clerk.example.test",
    CLERK_WEBHOOK_SIGNING_SECRET: "fixture",
    SPEECH_ENABLED: "true",
    OPENAI_API_KEY: "test-openai",
    MINIMAX_API_KEY: "test-minimax",
    ...overrides,
  });
test("Vercel-backed speech ignores the legacy opt-in while unconfigured self-hosting retains it", async () => {
  assert.equal(typeof runtime.createSpeechProviders, "function");
  const evaluate = async () => true;
  const flagged = runtime.createSpeechProviders(
    env({ FLAGS: "fixture" }),
    true,
    true,
    evaluate,
  );
  assert(flagged.synthesis?.willow?.available);
  assert.equal(await flagged.synthesis.willow.available(), true);
  assert(flagged.synthesis.reed);
  assert(flagged.transcription);
  const local = runtime.createSpeechProviders(env(), true, true);
  assert.equal(local.synthesis?.willow, undefined);
  assert(
    runtime.createSpeechProviders(
      env({ MINIMAX_TTS_ENABLED: "true" }),
      true,
      true,
    ).synthesis?.willow,
  );
  assert.equal(
    runtime.createSpeechProviders(env({ FLAGS: "fixture" }), true, true)
      .synthesis?.willow,
    undefined,
  );
  assert.equal(
    runtime.createSpeechProviders(
      env({ FLAGS: "fixture", MINIMAX_API_KEY: "" }),
      true,
      true,
      evaluate,
    ).synthesis?.willow,
    undefined,
  );
  assert.equal(
    runtime.createSpeechProviders(
      env({ FLAGS: "fixture" }),
      true,
      false,
      evaluate,
    ).synthesis,
    undefined,
  );
  assert.deepEqual(
    runtime.createSpeechProviders(
      env({ SPEECH_ENABLED: "false", FLAGS: "fixture" }),
      true,
      true,
      evaluate,
    ),
    {},
  );
});
