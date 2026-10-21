import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import {
  createRemoteEmbedder,
  createDecisionProvider,
  createGenerationProvider,
  InferenceError,
} from "@lib/ai";
import { modelConfigSchema, organizationSchema } from "@lib/shared/models";
import { withTelemetry, type TelemetrySink } from "@lib/telemetry/context";

type FixtureRequest = {
  model: string;
  dimensions: number;
  input: string[];
  questions: Record<string, { type: string }>;
  state: { candidates: unknown[] };
  reasoning_effort: string;
  max_completion_tokens: number;
  tools: { function: { name: string } }[];
  messages: { content: string }[];
};
let respond: (
  body: FixtureRequest,
  response: ServerResponse,
  headers: Record<string, unknown>,
  path: string,
) => void;
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  respond(
    JSON.parse(Buffer.concat(chunks).toString()),
    response,
    request.headers,
    request.url!,
  );
});
let origin: string;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const config = () =>
  modelConfigSchema.parse({
    embedding: {
      provider: "openai-compatible",
      baseUrl: origin,
      model: "Qwen/Qwen3-Embedding-8B",
      apiKey: "secret-fixture-key",
      dimensions: 4096,
      queryPrefix: "Instruct: Find memories\nQuery: ",
    },
    decision: {
      provider: "system-one",
      baseUrl: origin,
      model: "Cloudflare/clef-flash",
    },
    generation: {
      provider: "minimax",
      baseUrl: origin,
      model: "MiniMax-M3.1-Flash",
    },
  });
const source = {
  id: "00000000-0000-4000-8000-000000000001",
  version: 2,
  kind: "fact",
  content: "I prefer concise explanations.",
};
const json = (response: ServerResponse, data: unknown) => {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(data));
};

test("remote embeddings retain all 4096 coordinates, normalize, format queries separately and isolate profiles", async () => {
  const seen: string[] = [];
  respond = (body, response, headers, path) => {
    assert.equal(path, "/embeddings");
    assert.equal(headers.authorization, "Bearer secret-fixture-key");
    assert.equal(body.dimensions, 4096);
    seen.push(body.input[0]);
    json(response, {
      data: [{ index: 0, embedding: [3, 4, ...Array(4094).fill(0)] }],
      usage: { prompt_tokens: 12 },
    });
  };
  const settings = config().embedding,
    provider = createRemoteEmbedder(settings);
  let tokens = 0;
  const result = await provider.embed("concise", "query", {
    onUsage: (usage) => {
      tokens += usage.inputTokens;
    },
  });
  await provider.embed("concise", "document");
  assert.equal(result.length, 4096);
  assert.deepEqual(result.slice(0, 2), [0.6, 0.8]);
  assert.equal(tokens, 12);
  assert.deepEqual(seen, [
    "Instruct: Find memories\nQuery: concise",
    "concise",
  ]);
  assert.equal(
    provider.profile,
    createRemoteEmbedder({ ...settings, apiKey: "rotated" }).profile,
  );
  assert.notEqual(
    provider.profile,
    createRemoteEmbedder({ ...settings, dimensions: 384 }).profile,
  );
  assert.notEqual(
    provider.profile,
    createRemoteEmbedder({ ...settings, documentPrefix: "Document: " }).profile,
  );
  respond = (_body, response) =>
    json(response, { data: [{ index: 0, embedding: Array(384).fill(1) }] });
  await assert.rejects(provider.embed("wrong dimensions"), {
    code: "embedding_profile_mismatch",
    retryable: false,
  });
  respond = (_body, response) =>
    json(response, { data: [{ index: 0, embedding: Array(4096).fill(0) }] });
  await assert.rejects(provider.embed("zero vector"), {
    code: "invalid_embedding",
  });
});

test("System One accepts fixed choices and rejects invented classifications", async () => {
  let invalid = false;
  respond = (body, response, _headers, path) => {
    assert.equal(path, "/decisions");
    assert.equal(body.model, "Cloudflare/clef-flash");
    assert.equal(body.questions.salience.type, "choice");
    assert.equal(body.state.candidates.length, 1);
    json(response, {
      model: body.model,
      answers: {
        kind: {
          type: "choice",
          choice: invalid ? "handoff" : "preference",
          probabilities: { preference: 1 },
          confidence: 1,
        },
        topic: { choice: "preferences" },
        salience: { choice: "durable" },
        relationship_0: { choice: "duplicate" },
      },
      usage: { input_tokens: 80, output_tokens: 4 },
    });
  };
  const provider = createDecisionProvider(config().decision);
  const candidate = { ...source, id: "00000000-0000-4000-8000-000000000002" };
  assert.deepEqual(await provider.classify(source, [candidate]), {
    kind: "preference",
    topics: ["preferences"],
    salience: 1,
    relationships: [{ id: candidate.id, relationship: "duplicate" }],
  });
  invalid = true;
  await assert.rejects(provider.classify(source, [candidate]), {
    code: "decision_invalid_response",
  });
});

test("MiniMax validates one structured call, rejects incomplete outputs and keeps evidence separate from instructions", async () => {
  let finish = "tool_calls",
    output = JSON.stringify({
      title: "Concise replies",
      tags: ["preferences"],
    });
  respond = (body, response, _headers, path) => {
    assert.equal(path, "/chat/completions");
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.max_completion_tokens, 4096);
    assert.equal(body.tools[0].function.name, "record_result");
    assert.deepEqual(JSON.parse(body.messages[1].content), {
      sources: [source],
    });
    json(response, {
      choices: [
        {
          finish_reason: finish,
          message: {
            content: null,
            tool_calls: [
              { function: { name: "record_result", arguments: output } },
            ],
          },
        },
      ],
    });
  };
  const provider = createGenerationProvider(config().generation);
  assert.equal(
    (await provider.generate(organizationSchema, "Organize", [source])).title,
    "Concise replies",
  );
  finish = "length";
  await assert.rejects(
    provider.generate(organizationSchema, "Organize", [source]),
    { code: "generation_incomplete" },
  );
  finish = "tool_calls";
  output = '{"title":"x","tags":[],"unexpected":"value"}';
  await assert.rejects(
    provider.generate(organizationSchema, "Organize", [source]),
    { code: "generation_invalid_response" },
  );
});

test("transport redacts provider errors, bounds response bodies, refuses redirects and cancels stalled requests", async () => {
  const settings = config().embedding,
    provider = createRemoteEmbedder(settings);
  respond = (_body, response) => {
    response.statusCode = 429;
    response.end("secret-fixture-key sensitive upstream body");
  };
  await assert.rejects(
    provider.embed("hello"),
    (error: unknown) =>
      error instanceof InferenceError &&
      error.code === "provider_rate_limited" &&
      !error.message.includes("secret"),
  );
  respond = (_body, response) => {
    response.statusCode = 302;
    response.setHeader("location", `${origin}/credential-leak`);
    response.end();
  };
  await assert.rejects(provider.embed("hello"), {
    code: "provider_invalid_response",
  });
  respond = (_body, response) => response.end("x".repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(provider.embed("hello"), {
    code: "provider_response_too_large",
  });
  respond = () => {};
  const started = Date.now();
  await assert.rejects(
    createRemoteEmbedder({ ...settings, timeoutMs: 100 }).embed("hello"),
    { code: "provider_timeout" },
  );
  assert(Date.now() - started < 1500);
});

test("real model requests expose only usage and outcome metadata while preserving caller accounting", async () => {
  const records: unknown[] = [];
  const sink: TelemetrySink = {
    capture(event, properties) {
      records.push({ event, properties });
    },
    operation(operation, _started, result, properties) {
      records.push({ operation, result, properties });
    },
  };
  let callbacks = 0;
  const settings = {
    ...config().generation,
    model: "PRIVATE_MODEL",
    apiKey: "PRIVATE_KEY",
  };
  const provider = createGenerationProvider(settings);
  respond = (_body, response) =>
    json(response, {
      usage: { prompt_tokens: 75, completion_tokens: 12 },
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            tool_calls: [
              {
                function: {
                  name: "record_result",
                  arguments: JSON.stringify({
                    title: "PRIVATE_RESULT",
                    tags: [],
                  }),
                },
              },
            ],
          },
        },
      ],
    });
  await withTelemetry(sink, async () => {
    const value = await provider.generate(
      organizationSchema,
      "PRIVATE_PROMPT",
      [{ ...source, content: "PRIVATE_NOTE" }],
      {
        onUsage(usage) {
          callbacks++;
          assert.deepEqual(usage, { inputTokens: 75, outputTokens: 12 });
        },
      },
    );
    assert.equal(value.title, "PRIVATE_RESULT");
    respond = (_body, response) => {
      response.statusCode = 503;
      response.end("PRIVATE_UPSTREAM");
    };
    await assert.rejects(
      provider.generate(organizationSchema, "PRIVATE_RETRY", []),
    );
  });
  assert.equal(callbacks, 1);
  assert.equal(records.length, 4);
  assert.ok(!JSON.stringify(records).includes("PRIVATE"));
  const events = records as {
    event?: string;
    properties: { outcome: string; provider: string; input_tokens: number };
  }[];
  assert.deepEqual(
    events
      .filter((record) => record.event === "$ai_generation")
      .map((record) => [
        record.properties.provider,
        record.properties.outcome,
        record.properties.input_tokens,
      ]),
    [
      ["custom", "success", 75],
      ["custom", "unavailable", 0],
    ],
  );
});
