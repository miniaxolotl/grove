import { z } from "zod";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { speechVoiceIds, type SpeechVoiceId } from "@lib/shared/speech-voices";

export const speechRequestSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    mediaId: z.uuid().optional(),
    voiceId: z.enum(speechVoiceIds).optional(),
  })
  .strict()
  .refine((input) => !(input.mediaId && input.voiceId), {
    message: "Voice selection applies only to read aloud",
  });
export type SpeechRequest = z.infer<typeof speechRequestSchema>;
export interface SpeechTask {
  id: string;
  kind: "transcription" | "readAloud";
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  transcript?: string;
  playable: boolean;
  error: string | null;
  voiceId?: SpeechVoiceId;
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
  const tree = fromMarkdown(content);
  const definitions = new Map<string, string>();
  function collect(node: Nodes) {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
    if ("children" in node) node.children.forEach(collect);
  }
  collect(tree);
  function text(node: Nodes): string {
    switch (node.type) {
      case "code":
      case "inlineCode":
      case "html":
      case "definition":
      case "image":
      case "imageReference":
        return "";
      case "text":
        return node.value;
      case "break":
        return "\n";
      case "link":
        return /^grove-media:/i.test(node.url)
          ? ""
          : node.children.map(text).join("");
      case "linkReference":
        return /^grove-media:/i.test(definitions.get(node.identifier) ?? "")
          ? ""
          : node.children.map(text).join("");
      default:
        if (!("children" in node)) return "";
        return node.children
          .map(text)
          .join(
            ["root", "blockquote", "list", "listItem"].includes(node.type)
              ? "\n\n"
              : "",
          );
    }
  }
  return text(tree)
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
    .trim();
}
