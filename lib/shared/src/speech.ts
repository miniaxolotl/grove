import { z } from "zod";

export const speechRequestSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    mediaId: z.uuid().optional(),
  })
  .strict();
export type SpeechRequest = z.infer<typeof speechRequestSchema>;
export interface SpeechTask {
  id: string;
  kind: "transcription" | "readAloud";
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  transcript?: string;
  playable: boolean;
  error: string | null;
}
export const speechLimits = {
  text: 3000,
  audioBytes: 3 * 1024 * 1024,
  dailyRequests: 20,
  dailyAudioMs: 600000,
  dailyCharacters: 60000,
} as const;

/** A bounded narration, not a network/Markdown renderer. Code and media are silent. */
export function speechText(content: string) {
  return content
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "")
    .replace(
      /!?\[([^\]\n]*)\]\(([^)\n]*)\)/g,
      (_match, label: string, target: string) =>
        target.startsWith("grove-media:") ? "" : label,
    )
    .replace(
      /^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/gm,
      "",
    )
    .replace(/[*_`~]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
    .trim();
}
