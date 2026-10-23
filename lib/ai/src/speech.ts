import { createHash } from "node:crypto";
import { speechLimits } from "@lib/shared/speech";
import { InferenceError } from "./index.ts";

export interface SpeechProviders {
  transcription?: {
    profile: string;
    transcribe(audio: Buffer, signal: AbortSignal): Promise<string>;
  };
  synthesis?: {
    profile: string;
    synthesize(text: string, signal: AbortSignal): Promise<Buffer>;
  };
}
export function createOpenAiSpeech(config: {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
}) {
  const base = (config.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    ),
    voice = config.voice ?? "alloy";
  const profile = (model: string, settings: string) =>
    createHash("sha256")
      .update(
        JSON.stringify([base, model, settings, config.apiKey, "speech-v1"]),
      )
      .digest("hex");
  const request = async (
    path: string,
    body: Uint8Array<ArrayBuffer> | string,
    parent: AbortSignal,
    maximum: number,
    contentType = "application/json",
  ) => {
    const signal = AbortSignal.any([
      parent,
      AbortSignal.timeout(config.timeoutMs ?? 45000),
    ]);
    try {
      signal.throwIfAborted();
      const response = await fetch(`${base}/audio/${path}`, {
        method: "POST",
        redirect: "error",
        signal,
        body,
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": contentType,
        },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new InferenceError(
          response.status === 429
            ? "provider_rate_limited"
            : response.status === 401 || response.status === 403
              ? "provider_authentication"
              : "provider_unavailable",
          response.status === 429 || response.status >= 500,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new InferenceError("provider_empty_response");
      const bytes = Buffer.allocUnsafe(maximum);
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.length > maximum - size)
            throw new InferenceError("provider_response_too_large", false);
          bytes.set(value, size);
          size += value.length;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      signal.throwIfAborted();
      return {
        bytes: Buffer.from(bytes.subarray(0, size)),
        mime: response.headers.get("content-type")?.split(";")[0],
      };
    } catch (error) {
      if (parent.aborted) throw parent.reason;
      if (error instanceof InferenceError) throw error;
      throw new InferenceError(
        signal.aborted ? "provider_timeout" : "provider_invalid_response",
      );
    }
  };
  return {
    transcription: {
      profile: profile("whisper-1", "auto-language"),
      async transcribe(audio: Buffer, signal: AbortSignal) {
        signal.throwIfAborted();
        if (audio.length > 10 * 1024 * 1024)
          throw new InferenceError("speech_audio_limit", false);
        const body = new FormData();
        body.set("model", "whisper-1");
        body.set("response_format", "json");
        body.set(
          "file",
          new Blob([new Uint8Array(audio)], { type: "audio/wav" }),
          "recording.wav",
        );
        // Materialize the bounded multipart body before fetch: Node 24's streamed
        // FormData encoder can enqueue into a closed stream during cancellation.
        const multipart = new Response(body);
        const encoded = new Uint8Array(await multipart.arrayBuffer());
        const { bytes, mime } = await request(
          "transcriptions",
          encoded,
          signal,
          32768,
          multipart.headers.get("content-type")!,
        );
        try {
          const result = JSON.parse(bytes.toString("utf8"));
          if (
            mime !== "application/json" ||
            typeof result.text !== "string" ||
            result.text.length > 6000
          )
            throw new Error();
          return result.text.trim();
        } catch {
          throw new InferenceError("provider_invalid_response", false);
        }
      },
    },
    synthesis: {
      profile: profile("tts-1", `${voice}:mp3`),
      async synthesize(text: string, signal: AbortSignal) {
        if (!text.trim() || text.length > speechLimits.text)
          throw new InferenceError("speech_text_limit", false);
        const { bytes, mime } = await request(
          "speech",
          JSON.stringify({
            model: "tts-1",
            input: text,
            voice,
            response_format: "mp3",
          }),
          signal,
          speechLimits.audioBytes,
        );
        if (
          mime !== "audio/mpeg" ||
          bytes.length < 128 ||
          !(
            bytes.subarray(0, 3).toString() === "ID3" ||
            (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
          )
        )
          throw new InferenceError("provider_invalid_audio", false);
        return bytes;
      },
    },
  } satisfies SpeechProviders;
}
