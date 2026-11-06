import { test } from "node:test";
import assert from "node:assert/strict";
import { readServerEnvironment } from "@lib/environment";

const path = new URL(
  "../../lib/shared/src/writing-assistance.ts",
  import.meta.url,
).href;
test("selection tools have explicit identities and return multiple reviewed alternatives", async () => {
  const writing = await import(path).catch(() => ({}));
  assert.equal(
    typeof writing.selectWritingSentence,
    "function",
    "sentence selection must be validated before showing AI tools",
  );
  assert.deepEqual(
    writing.writingTools.map((tool: { id: string }) => tool.id),
    ["concise", "verbose", "rewrite", "humanize", "synonyms", "antonyms"],
  );
  const text = "Hello world! My name is Elias.";
  const selection = writing.selectWritingSentence(text, 13, text.length);
  assert.deepEqual(selection, {
    from: 13,
    to: text.length,
    original: "My name is Elias.",
    language: "en",
  });
  for (const [from, to] of [
    [0, 0],
    [0, text.length],
    [-1, 5],
    [0, 3000],
  ])
    assert.equal(writing.selectWritingSentence(text, from, to), null);
  assert.equal(writing.selectWritingSentence("x".repeat(2001), 0, 2001), null);
  assert.equal(writing.selectWritingSentence("`const x = 1;`", 0, 14), null);
  const input = {
    id: "00000000-0000-4000-a000-000000000003",
    sessionId: "00000000-0000-4000-a000-000000000004",
    language: "en",
    tool: "concise",
    sentence: selection.original,
  };
  assert.deepEqual(writing.writingRequestSchema.parse(input), input);
  for (const change of [
    { tool: undefined },
    { tool: "translate" },
    { language: "fr" },
    { url: "https://private.example" },
    { sentence: "First sentence. Second sentence." },
  ])
    assert.equal(
      writing.writingRequestSchema.safeParse({ ...input, ...change }).success,
      false,
    );
  const alternatives = ["I'm Elias.", "My name's Elias.", "I am Elias."];
  const result = writing.validateWritingAlternatives(input, { alternatives });
  assert.deepEqual(result, {
    language: "en",
    tool: "concise",
    original: input.sentence,
    alternatives,
  });
  for (const values of [
    [alternatives[0]],
    [alternatives[0], alternatives[0]],
    [input.sentence, " "],
    ["x".repeat(4001), "Hello."],
  ])
    assert.throws(() =>
      writing.validateWritingAlternatives(input, { alternatives: values }),
    );
  assert.equal(
    writing.writingTools.find((tool: { id: string }) => tool.id === "humanize")
      .label,
    "Humanize",
  );
  for (const tool of ["synonyms", "antonyms"]) {
    const word = { ...input, tool, sentence: "bright" };
    assert.equal(writing.writingRequestSchema.safeParse(word).success, true);
    assert.equal(
      writing.writingRequestSchema.safeParse({
        ...word,
        sentence: "The room is bright.",
      }).success,
      false,
    );
    assert.throws(() =>
      writing.validateWritingAlternatives(word, {
        alternatives: ["x".repeat(81), "clear", "radiant"],
      }),
    );
  }
});

test("writing configuration is optional, paired and isolated from other service keys", () => {
  const base = {
    DATABASE_URL: "postgresql://test:test@127.0.0.1/writing_test",
    CURSOR_SECRET: "writing-configuration-fixture-32-characters",
    API_ORIGIN: "http://localhost:8787",
    SITE_URL: "http://localhost:3000",
    CLERK_PUBLISHABLE_KEY: "pk_test_fixture",
    CLERK_SECRET_KEY: "sk_test_fixture",
    CLERK_ISSUER: "https://clerk.example.test",
    CLERK_WEBHOOK_SIGNING_SECRET: "fixture",
  };
  assert.equal(readServerEnvironment(base).WRITING_STAGING_KEY, undefined);
  const notice =
    "Synthetic provider retention disclosure; no live transmission.";
  assert.throws(
    () =>
      readServerEnvironment({ ...base, WRITING_STAGING_KEY: "32".repeat(32) }),
    /WRITING_PROVIDER_NOTICE/,
  );
  assert.throws(
    () => readServerEnvironment({ ...base, WRITING_PROVIDER_NOTICE: notice }),
    /WRITING_STAGING_KEY/,
  );
  assert.throws(
    () =>
      readServerEnvironment({
        ...base,
        WRITING_PROVIDER_NOTICE: notice,
        WRITING_STAGING_KEY: "32".repeat(32),
        SHARE_LINK_KEY: "32".repeat(32),
      }),
    /dedicated/i,
  );
  assert.equal(
    readServerEnvironment({
      ...base,
      WRITING_STAGING_KEY: "32".repeat(32),
      WRITING_PROVIDER_NOTICE: notice,
    }).WRITING_PROVIDER_NOTICE,
    notice,
  );
});
