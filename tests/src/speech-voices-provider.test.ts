import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import * as speech from "../../lib/ai/src/speech.ts";
import { speechRequestSchema } from "@lib/shared/speech";
import { settingsUpdateSchema } from "@lib/shared/settings";

const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200)]);
let origin: string,
  mode = "normal",
  code = 0,
  http = 200;
let entered: (() => void) | undefined;
const requests: {
  path: string;
  body: Record<string, unknown>;
  auth?: string;
}[] = [];
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  requests.push({
    path: req.url!,
    body: JSON.parse(Buffer.concat(chunks).toString()),
    auth: req.headers.authorization,
  });
  entered?.();
  entered = undefined;
  if (mode === "stall") return;
  if (http !== 200)
    return res
      .writeHead(http, { location: `${origin}/redirected` })
      .end("SECRET_DIAGNOSTIC");
  res.writeHead(200, {
    "content-type": mode === "mime" ? "text/html" : "application/json",
  });
  if (mode === "oversized") return res.end("x".repeat(6 * 1024 * 1024 + 65537));
  res.end(
    JSON.stringify({
      base_resp: { status_code: code, status_msg: "SECRET_DIAGNOSTIC" },
      data:
        mode === "null"
          ? null
          : {
              status: mode === "partial" ? 1 : 2,
              audio:
                mode === "odd"
                  ? "abc"
                  : mode === "nonhex"
                    ? "xx".repeat(203)
                    : mode === "audio"
                      ? "00".repeat(203)
                      : mp3.toString("hex"),
            },
    }),
  );
});
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});
const provider = (voice = "English_CalmWoman") => {
  assert.equal(
    typeof speech.createMiniMaxSpeech,
    "function",
    "MiniMax must have a dedicated speech adapter",
  );
  return speech.createMiniMaxSpeech({
    apiKey: "fixture-key",
    baseUrl: origin,
    voice,
    timeoutMs: 100,
  });
};

test("voice selection accepts Grove IDs and rejects provider IDs or transcription combinations", () => {
  const request = { id: "abc7d786-ccca-4ff8-937a-6d89fb56bcd3", version: 1 };
  assert.equal(
    speechRequestSchema.parse({ ...request, voiceId: "willow" }).voiceId,
    "willow",
  );
  assert.equal(
    settingsUpdateSchema.parse({ readAloudVoiceId: "cedar" }).readAloudVoiceId,
    "cedar",
  );
  assert.equal(
    speechRequestSchema.safeParse({ ...request, voiceId: "English_CalmWoman" })
      .success,
    false,
  );
  assert.equal(
    speechRequestSchema.safeParse({
      ...request,
      voiceId: "reed",
      mediaId: request.id,
    }).success,
    false,
  );
  assert.equal(
    settingsUpdateSchema.safeParse({ readAloudVoiceId: "unknown" }).success,
    false,
  );
});

test("MiniMax speech sends selected voice and bounded MP3 settings to its dedicated endpoint", async () => {
  const voice = provider();
  assert.deepEqual(
    await voice.synthesize("Meet beside the river.", AbortSignal.timeout(1000)),
    mp3,
  );
  assert.deepEqual(requests.at(-1), {
    path: "/t2a_v2",
    auth: "Bearer fixture-key",
    body: {
      model: "speech-2.8-turbo",
      text: "Meet beside the river.",
      stream: false,
      output_format: "hex",
      language_boost: "auto",
      voice_setting: {
        voice_id: "English_CalmWoman",
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        format: "mp3",
        sample_rate: 32000,
        bitrate: 64000,
        channel: 1,
      },
    },
  });
  assert.notEqual(voice.profile, provider("English_Upbeat_Woman").profile);
  assert.notEqual(
    voice.profile,
    speech.createMiniMaxSpeech({
      apiKey: "rotated",
      baseUrl: origin,
      voice: "English_CalmWoman",
    }).profile,
  );
  const before = requests.length;
  await assert.rejects(
    voice.synthesize("x".repeat(3001), AbortSignal.timeout(1000)),
  );
  assert.equal(requests.length, before);
});

test("MiniMax HTTP-success errors are sanitized and only transient failures retry", async () => {
  const voice = provider();
  for (const [status, retryable] of [
    [1001, true],
    [1002, true],
    [1039, true],
    [1004, false],
    [1008, false],
    [20132, false],
    [2043, false],
    [2054, false],
  ] as const) {
    code = status;
    await assert.rejects(
      voice.synthesize("Text", AbortSignal.timeout(1000)),
      (error: unknown) => {
        assert(!String(error).includes("SECRET_DIAGNOSTIC"));
        assert.equal((error as { retryable: boolean }).retryable, retryable);
        return true;
      },
    );
  }
  code = 0;
  for (const status of [401, 429, 503, 302]) {
    http = status;
    await assert.rejects(voice.synthesize("Text", AbortSignal.timeout(1000)));
  }
  http = 200;
  assert(!requests.some((request) => request.path === "/redirected"));
});

test("MiniMax reads provider control notation as prose instead of performing pauses or interjections", async () => {
  await provider().synthesize(
    "Read (laughs), (laɪv) and <#99.99#> literally.",
    AbortSignal.timeout(1000),
  );
  assert.equal(
    requests.at(-1)?.body.text,
    "Read [laughs], [laɪv] and [99.99] literally.",
  );
  assert.equal(
    requests.at(-1)?.body.text_normalization_mode,
    undefined,
    "never opt into LLM rewriting",
  );
});

test("MiniMax rejects malformed, incomplete and oversized successful audio responses", async () => {
  const voice = provider();
  for (const invalid of [
    "mime",
    "null",
    "partial",
    "odd",
    "nonhex",
    "audio",
    "oversized",
  ]) {
    mode = invalid;
    await assert.rejects(
      voice.synthesize("Text", AbortSignal.timeout(2000)),
      (error: unknown) => {
        assert.equal(
          (error as { retryable: boolean }).retryable,
          false,
          invalid,
        );
        return true;
      },
    );
  }
  mode = "normal";
});

test("MiniMax speech preserves caller cancellation and bounds stalled responses", async () => {
  const voice = provider();
  mode = "stall";
  await assert.rejects(
    voice.synthesize("Text", AbortSignal.timeout(1000)),
    (error: unknown) => (error as { code: string }).code === "provider_timeout",
  );
  const controller = new AbortController();
  const seen = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = voice.synthesize("Text", controller.signal);
  await seen;
  const reason = new Error("fixture cancellation");
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  const count = requests.length;
  await assert.rejects(
    voice.synthesize("Text", controller.signal),
    (error) => error === reason,
  );
  assert.equal(requests.length, count);
  mode = "normal";
});
