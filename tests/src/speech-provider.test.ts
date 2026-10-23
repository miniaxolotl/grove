import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createOpenAiSpeech } from "../../lib/ai/src/speech.ts";

let origin: string;
let status = 200;
let mode = "normal";
let received: (() => void) | undefined;
const requests: { path: string; body: Buffer; type: string; auth?: string }[] =
  [];
const server = createServer(async (req, res) => {
  const body: Buffer[] = [];
  for await (const chunk of req) body.push(chunk);
  requests.push({
    path: req.url!,
    body: Buffer.concat(body),
    type: req.headers["content-type"]!,
    auth: req.headers.authorization,
  });
  received?.();
  received = undefined;
  if (status !== 200)
    return res.writeHead(status).end("SECRET_PROVIDER_DIAGNOSTIC");
  if (mode === "stall") return;
  if (req.url === "/audio/transcriptions") {
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ text: "A thought beside the river." }));
  } else {
    res.writeHead(200, {
      "content-type": mode === "invalid" ? "text/html" : "audio/mpeg",
    });
    res.end(
      mode === "oversized"
        ? Buffer.alloc(3 * 1024 * 1024 + 1)
        : Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200)]),
    );
  }
});
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

test("narration profile cutover invalidates audio from the old Markdown filter", () => {
  const legacy = createHash("sha256")
    .update(
      JSON.stringify([
        "https://api.openai.com/v1",
        "tts-1",
        "alloy:mp3",
        "fixture-key",
        "speech-v1",
      ]),
    )
    .digest("hex");
  assert.notEqual(
    createOpenAiSpeech({ apiKey: "fixture-key" }).synthesis.profile,
    legacy,
  );
});

test("speech adapters send only explicit WAV/text inputs to the selected OpenAI models", async () => {
  const providers = createOpenAiSpeech({
    apiKey: "fixture-key",
    baseUrl: origin,
  });
  const wav = Buffer.from("RIFF-original-audio-WAVE");
  assert.equal(
    await providers.transcription.transcribe(wav, AbortSignal.timeout(1000)),
    "A thought beside the river.",
  );
  const request = requests.at(-1)!;
  assert.equal(request.path, "/audio/transcriptions");
  assert.match(request.type, /^multipart\/form-data/);
  assert(request.body.includes(wav));
  assert(request.body.includes(Buffer.from("whisper-1")));
  assert.equal(request.auth, "Bearer fixture-key");
  const audio = await providers.synthesis.synthesize(
    "A thought beside the river.",
    AbortSignal.timeout(1000),
  );
  assert.equal(audio.subarray(0, 3).toString(), "ID3");
  assert.deepEqual(JSON.parse(requests.at(-1)!.body.toString()), {
    model: "tts-1",
    input: "A thought beside the river.",
    voice: "alloy",
    response_format: "mp3",
  });
  assert.notEqual(
    providers.synthesis.profile,
    createOpenAiSpeech({
      apiKey: "fixture-key",
      baseUrl: origin,
      voice: "nova",
    }).synthesis.profile,
  );
});

test("speech adapter errors are bounded, sanitized and classify retryable failures", async () => {
  const providers = createOpenAiSpeech({
    apiKey: "fixture-key",
    baseUrl: origin,
    timeoutMs: 100,
  });
  for (const [code, retryable] of [
    [401, false],
    [429, true],
    [503, true],
  ] as const) {
    status = code;
    await assert.rejects(
      providers.transcription.transcribe(
        Buffer.from("audio"),
        AbortSignal.timeout(1000),
      ),
      (error: unknown) => {
        assert(!String(error).includes("SECRET_PROVIDER_DIAGNOSTIC"));
        assert.equal((error as { retryable: boolean }).retryable, retryable);
        return true;
      },
    );
  }
  status = 200;
  for (const invalid of ["invalid", "oversized"]) {
    mode = invalid;
    await assert.rejects(
      providers.synthesis.synthesize("Text", AbortSignal.timeout(1000)),
    );
  }
  mode = "stall";
  await assert.rejects(
    providers.transcription.transcribe(
      Buffer.from("audio"),
      AbortSignal.timeout(1000),
    ),
    (error: unknown) => (error as { code: string }).code === "provider_timeout",
  );
  const controller = new AbortController();
  const entered = new Promise<void>((resolve) => {
    received = resolve;
  });
  const pending = providers.transcription.transcribe(
    Buffer.from("audio"),
    controller.signal,
  );
  await entered;
  controller.abort();
  await assert.rejects(pending);
  const stopped = new AbortController();
  stopped.abort();
  const before = requests.length;
  await assert.rejects(
    providers.transcription.transcribe(Buffer.from("audio"), stopped.signal),
  );
  assert.equal(
    requests.length,
    before,
    "pre-aborted requests do not send audio",
  );
  mode = "normal";
});
