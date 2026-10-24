import { createHash } from "node:crypto";
import { speechLimits } from "@lib/shared/speech";
import { InferenceError } from "./index.ts";
import type { SpeechVoiceId } from "@lib/shared/speech-voices";

export interface SpeechSynthesis {
  profile: string;
  sampleId?: string;
  synthesize(text: string, signal: AbortSignal): Promise<Buffer>;
}
export interface SpeechProviders {
  transcription?: {
    profile: string;
    transcribe(audio: Buffer, signal: AbortSignal): Promise<string>;
  };
  synthesis?: Partial<Record<SpeechVoiceId, SpeechSynthesis>>;
}

type Transport = { apiKey: string; timeoutMs?: number };
async function requestSpeech(
  config: Transport,
  url: string,
  body: Uint8Array<ArrayBuffer> | string,
  parent: AbortSignal,
  maximum: number,
  contentType = "application/json",
) {
  const signal = AbortSignal.any([
    parent,
    AbortSignal.timeout(config.timeoutMs ?? 45000),
  ]);
  try {
    signal.throwIfAborted();
    const response = await fetch(url, {
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
}
function validateMp3(bytes: Buffer) {
  if (
    bytes.length < 128 ||
    bytes.length > speechLimits.audioBytes ||
    !(
      bytes.subarray(0, 3).toString() === "ID3" ||
      (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    )
  )
    throw new InferenceError("provider_invalid_audio", false);
  return bytes;
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
        JSON.stringify([base, model, settings, config.apiKey, "speech-v2"]),
      )
      .digest("hex");
  const request = async (
    path: string,
    body: Uint8Array<ArrayBuffer> | string,
    parent: AbortSignal,
    maximum: number,
    contentType = "application/json",
  ) =>
    requestSpeech(
      config,
      `${base}/audio/${path}`,
      body,
      parent,
      maximum,
      contentType,
    );
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
        if (mime !== "audio/mpeg")
          throw new InferenceError("provider_invalid_audio", false);
        return validateMp3(bytes);
      },
    },
  } satisfies {
    transcription: SpeechProviders["transcription"];
    synthesis: SpeechSynthesis;
  };
}

export const miniMaxSpeechVoices = {
  willow: "English_CalmWoman",
  cedar: "English_ManWithDeepVoice",
  brook: "English_Upbeat_Woman",
} as const;

export function createMiniMaxSpeech(
  config: Transport & { voice: string; baseUrl?: string },
): SpeechSynthesis {
  const base = (config.baseUrl ?? "https://api.minimax.io/v1").replace(
    /\/+$/,
    "",
  );
  const settings = {
    model: "speech-2.8-turbo",
    stream: false,
    output_format: "hex",
    language_boost: "auto",
    voice_setting: { voice_id: config.voice, speed: 1, vol: 1, pitch: 0 },
    audio_setting: {
      format: "mp3",
      sample_rate: 32000,
      bitrate: 64000,
      channel: 1,
    },
  };
  return {
    profile: createHash("sha256")
      .update(
        JSON.stringify([
          base,
          settings,
          config.apiKey,
          "speech-v2-literal-notation-v1",
        ]),
      )
      .digest("hex"),
    async synthesize(text, signal) {
      signal.throwIfAborted();
      if (!text.trim() || text.length > speechLimits.text)
        throw new InferenceError("speech_text_limit", false);
      const { bytes, mime } = await requestSpeech(
        config,
        `${base}/t2a_v2`,
        // Half-width parentheses enable MiniMax pronunciation/interjection tags;
        // pause markup can introduce long silence. Retain their words as prose.
        // Omit text_normalization_mode: no optional LLM normalization is used.
        JSON.stringify({
          ...settings,
          text: text
            .replaceAll("(", "[")
            .replaceAll(")", "]")
            .replace(/<#([\d.]+)#>/g, "[$1]"),
        }),
        signal,
        speechLimits.audioBytes * 2 + 65536,
      );
      try {
        if (mime !== "application/json") throw new Error();
        const result = JSON.parse(bytes.toString("utf8"));
        const code = result.base_resp?.status_code;
        if (typeof code !== "number") throw new Error();
        if (code !== 0) {
          const retryable = [
            1000, 1001, 1002, 1013, 1024, 1033, 1039, 1041, 1045, 2045, 2046,
            2047, 2064, 2066,
          ].includes(code);
          throw new InferenceError(
            [1004, 2049].includes(code)
              ? "provider_authentication"
              : [1002, 1039, 1041, 1045, 2045, 2046, 2047].includes(code)
                ? "provider_rate_limited"
                : code === 1001 || code === 2066
                  ? "provider_timeout"
                  : "provider_unavailable",
            retryable,
          );
        }
        const hex = result.data?.audio;
        if (
          result.data?.status !== 2 ||
          typeof hex !== "string" ||
          !hex.length ||
          hex.length % 2 ||
          hex.length > speechLimits.audioBytes * 2 ||
          !/^[a-f0-9]+$/i.test(hex)
        )
          throw new Error();
        signal.throwIfAborted();
        return validateMp3(Buffer.from(hex, "hex"));
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (error instanceof InferenceError) throw error;
        throw new InferenceError("provider_invalid_response", false);
      }
    },
  };
}
