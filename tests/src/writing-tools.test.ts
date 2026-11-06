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

test("explicit rewrite context is bounded to adjacent sentences and selection position", async () => {
  const writing = await import(path);
  assert.equal(typeof writing.writingContextFor, "function");
  const text =
    "An earlier paragraph.\n\nFirst sentence. Keep this idea. Next sentence.\n\nA later paragraph.";
  const selected = "Keep this idea.";
  const from = text.indexOf(selected);
  const selection = writing.selectWritingSentence(
    text,
    from,
    from + selected.length,
  );
  assert.deepEqual(writing.writingContextFor(text, selection), {
    previousSentence: "First sentence.",
    nextSentence: "Next sentence.",
    sentenceBefore: "",
    sentenceAfter: "",
    startsSentence: true,
    endsSentence: true,
    startsParagraph: false,
    endsParagraph: false,
  });
  const wordFrom = text.indexOf("idea");
  const word = writing.selectWritingSentence(text, wordFrom, wordFrom + 4);
  assert.deepEqual(writing.writingContextFor(text, word), {
    previousSentence: "First sentence.",
    nextSentence: "Next sentence.",
    sentenceBefore: "Keep this ",
    sentenceAfter: ".",
    startsSentence: false,
    endsSentence: false,
    startsParagraph: false,
    endsParagraph: false,
  });
  const first = writing.writingContextFor(
    text,
    writing.selectWritingSentence(text, 0, 21),
  );
  assert.equal(first.previousSentence, "");
  assert.equal(first.startsParagraph, true);
  assert.equal(first.endsParagraph, true);
  assert.equal(first.nextSentence, "First sentence.");
  const long =
    "x".repeat(20000) + ". Before. Target. After. " + "Y".repeat(20000);
  const start = long.indexOf("Target.");
  const context = writing.writingContextFor(
    long,
    writing.selectWritingSentence(long, start, start + 7),
  );
  assert.equal(context.previousSentence, "Before.");
  assert.equal(context.nextSentence, "After.");
  assert.ok(
    Object.values(context).every(
      (value) => typeof value !== "string" || value.length <= 500,
    ),
  );
  assert.equal(
    writing.writingContextFor("newer text", selection),
    null,
    "context never comes from a changed editor snapshot",
  );
  const edges = "First.\r\n\r\nLast.";
  const last = writing.writingContextFor(
    edges,
    writing.selectWritingSentence(edges, edges.indexOf("Last."), edges.length),
  );
  assert.equal(last.startsParagraph, true);
  assert.equal(last.endsParagraph, true);
  assert.equal(last.previousSentence, "First.");
  assert.equal(last.nextSentence, "");
});

test("context is strict, encrypted-request eligible, and never added to word-alternative tools", async () => {
  const writing = await import(path);
  const sentence = "Keep this idea.";
  const context = writing.writingContextFor(
    sentence,
    writing.selectWritingSentence(sentence, 0, sentence.length),
  );
  const input = {
    id: "00000000-0000-4000-a000-000000000003",
    sessionId: "00000000-0000-4000-a000-000000000004",
    language: "en",
    tool: "rewrite",
    sentence,
    context,
  };
  assert.equal(writing.writingRequestSchema.safeParse(input).success, true);
  for (const changed of [
    { ...context, previousSentence: "x".repeat(501) },
    { ...context, url: "https://private.example" },
    { ...context, startsParagraph: "yes" },
  ])
    assert.equal(
      writing.writingRequestSchema.safeParse({ ...input, context: changed })
        .success,
      false,
    );
  assert.equal(
    writing.writingRequestSchema.safeParse({
      ...input,
      tool: "synonyms",
      sentence: "bright",
    }).success,
    false,
  );
  assert.equal(
    writing.writingPolicy,
    "rewrite-context-v3",
    "selection-only consent must not silently authorize surrounding text",
  );
  assert.equal(typeof writing.hasCurrentWritingConsent, "function");
  const availability = {
    available: true,
    authorized: true,
    consented: true,
    policy: "selection-tools-v2:0000000000000000",
    provider: "Fixture",
  };
  assert.equal(writing.hasCurrentWritingConsent(availability), false);
  assert.equal(
    writing.hasCurrentWritingConsent({
      ...availability,
      policy: `${writing.writingPolicy}:0000000000000000`,
    }),
    true,
  );
});
