import { z } from "zod";
import { rememberSchema } from "./contracts";

const trackingParameters = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "dclid",
  "fbclid",
  "msclkid",
]);

function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code < 32 || code === 127 || code === 0x2028 || code === 0x2029;
  });
}

/** No network access. Preserve ambiguous fragments and functional query ordering. */
export function normalizeWebUrl(input: string): string {
  if (
    typeof input !== "string" ||
    input.length > 4096 ||
    !/^https?:\/\//i.test(input) ||
    /\s/u.test(input) ||
    containsControlCharacters(input)
  )
    throw new Error("Invalid source URL");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid source URL");
  }
  if (!url.hostname || url.username || url.password)
    throw new Error("Invalid source URL: credentials are not allowed");
  const parts = url.search.slice(1).split("&");
  const retained = parts.filter((part) => {
    const name = new URLSearchParams(part).keys().next().value;
    return !name || !trackingParameters.has(name);
  });
  // URLSearchParams serializes functional bytes too (%20 → +, bare → bare=).
  // Filter raw segments instead; only rewrite when a known tracker was removed.
  if (retained.length !== parts.length) url.search = retained.join("&");
  const normalized = url.href;
  if (normalized.length > 4096) throw new Error("Invalid source URL: too long");
  return normalized;
}

// Browser-specific provenance, atomically committed by the authorized capture API.
// It does not widen the general rememberSchema or claim the source is verified.
export const webCaptureSchema = z
  .object({
    url: z
      .string()
      .max(4096)
      .transform((value, ctx) => {
        try {
          return normalizeWebUrl(value);
        } catch {
          ctx.addIssue({ code: "custom", message: "Invalid source URL" });
          return z.NEVER;
        }
      }),
    title: z
      .string()
      .max(300)
      .refine((value) => !containsControlCharacters(value), {
        message: "Source title must be a single line",
      }),
    capturedAt: z.iso.datetime(),
  })
  .strict();
export type WebCapture = z.infer<typeof webCaptureSchema>;

export const browserCaptureRequestSchema = z
  .object({
    operationId: z.uuid(),
    content: rememberSchema.shape.content,
    projectId: z.uuid().nullable(),
    capture: z.literal("explicit"),
    provenance: webCaptureSchema.optional(),
  })
  .strict();
export const browserPageRequestSchema = z
  .object({
    url: webCaptureSchema.shape.url,
    projectId: z.uuid().nullable(),
    cursor: z.string().max(2048).optional(),
  })
  .strict();
export type BrowserCaptureRequest = z.infer<typeof browserCaptureRequestSchema>;
export type BrowserPageRequest = z.input<typeof browserPageRequestSchema>;

function escapeMarkdown(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\\`*_[\]{}()!#|]/g, "\\$&");
}

/** Format a reviewed capture; never silently truncate text to fit the note limit. */
export function formatWebCapture(input: {
  text: string;
  source?: WebCapture;
  quoteText?: boolean;
}): string {
  const text = input.text.trim();
  let content = text;
  if (input.source) {
    const source = webCaptureSchema.parse(input.source);
    const quote =
      input.quoteText === false
        ? text
        : text
          ? text
              .replace(/\r\n?/g, "\n")
              .split("\n")
              .map((line) => (line ? `> ${escapeMarkdown(line)}` : ">"))
              .join("\n")
          : "";
    const link = source.url.replaceAll("(", "%28").replaceAll(")", "%29");
    const title = escapeMarkdown(source.title || new URL(source.url).hostname);
    content = [
      quote,
      `Source: [${title}](<${link}>)\nCaptured: ${source.capturedAt}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (!content) throw new Error("Capture is empty");
  if (!rememberSchema.shape.content.safeParse(content).success)
    throw new Error("Capture exceeds the 6000-character note limit");
  return content;
}
