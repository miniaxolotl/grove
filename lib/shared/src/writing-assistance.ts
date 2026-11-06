import { z } from "zod";

/** One registry drives menu labels, request validation and worker instructions. */
export const writingTools = [
  {
    id: "concise",
    label: "Shorten",
    description: "Fewer words, same meaning.",
    instruction:
      "Remove unnecessary wording while preserving every important detail.",
  },
  {
    id: "verbose",
    label: "Expand",
    description: "Express the same idea more fully.",
    instruction:
      "Express the same information more fully, without adding facts, examples, reasons or commitments.",
  },
  {
    id: "rewrite",
    label: "Rewrite",
    description: "Explore different ways to say it.",
    instruction:
      "Offer distinctly different ways of expressing the same sentence, keeping its tone and meaning.",
  },
  {
    id: "humanize",
    label: "Humanize",
    description: "Use more natural, conversational wording.",
    instruction:
      "Make the wording natural and conversational without inventing a speaker's experiences, changing certainty or making any AI-detection claim.",
  },
  {
    id: "synonyms",
    label: "Synonyms",
    description: "Find a word with a similar meaning.",
    instruction:
      "Suggest three English synonyms for the selected word, preserving its grammatical form. Return only short words or phrases, not definitions or commentary. Do not invent synonyms for names.",
  },
  {
    id: "antonyms",
    label: "Opposite words",
    description: "Explore the opposite meaning.",
    instruction:
      "Suggest three English antonyms for the selected word. These deliberately change its meaning. Return only short words or phrases, not definitions or commentary. Do not invent opposites for names or words with no clear opposite.",
  },
] as const;
export const writingToolSchema = z.enum([
  "concise",
  "verbose",
  "rewrite",
  "humanize",
  "synonyms",
  "antonyms",
]);
export type WritingTool = z.infer<typeof writingToolSchema>;
export const isWritingWord = (value: string) =>
  /^[\p{L}\p{M}][\p{L}\p{M}'’-]{0,79}$/u.test(value);
export const writingLimits = {
  sentence: 2000,
  alternative: 4000,
  alternatives: 3,
  lifetimeSeconds: 900,
  deadlineSeconds: 60,
} as const;
export const writingPolicy = "selection-tools-v2";
export type WritingSelection = {
  language: "en";
  from: number;
  to: number;
  original: string;
};
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

/** Call only after metadata eligibility. Never inspect excluded fields for selection. */
export function selectWritingSentence(
  source: string,
  from: number,
  to: number,
): WritingSelection | null {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to > source.length ||
    from >= to ||
    to - from > writingLimits.sentence
  )
    return null;
  const selected = source.slice(from, to);
  const original = selected.trim();
  if (
    !original ||
    !/\p{L}/u.test(original) ||
    /[`<>]|\n\s*\n/.test(original) ||
    [...segmenter.segment(original)].filter((part) => part.segment.trim())
      .length !== 1
  )
    return null;
  from += selected.length - selected.trimStart().length;
  return { language: "en", from, to: from + original.length, original };
}

export const writingRequestSchema = z
  .object({
    id: z.uuid(),
    sessionId: z.uuid(),
    language: z.literal("en"),
    tool: writingToolSchema,
    sentence: z
      .string()
      .min(1)
      .max(writingLimits.sentence)
      .refine(
        (text) =>
          selectWritingSentence(text, 0, text.length)?.original === text,
        "Select one English sentence.",
      ),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      ["synonyms", "antonyms"].includes(value.tool) &&
      !isWritingWord(value.sentence)
    )
      context.addIssue({
        code: "custom",
        path: ["sentence"],
        message: "Select one word.",
      });
  });
export type WritingRequest = z.infer<typeof writingRequestSchema>;
export const writingAlternativesSchema = z
  .object({
    alternatives: z
      .array(z.string().trim().min(1).max(writingLimits.alternative))
      .min(2)
      .max(writingLimits.alternatives),
  })
  .strict();
export type WritingAlternatives = {
  language: "en";
  tool: WritingTool;
  original: string;
  alternatives: string[];
};
/** Structural validity is not proof of meaning preservation; users review output. */
export function validateWritingAlternatives(
  request: WritingRequest,
  raw: unknown,
): WritingAlternatives {
  const result = writingAlternativesSchema.parse(raw);
  if (
    ["synonyms", "antonyms"].includes(request.tool) &&
    result.alternatives.some((value) => value.length > 80)
  )
    throw new Error("writing_word_alternative_too_long");
  const normalize = (value: string) =>
    value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en");
  const original = normalize(request.sentence);
  const alternatives = result.alternatives.filter(
    (value, index, all) =>
      normalize(value) !== original &&
      all.findIndex((other) => normalize(other) === normalize(value)) === index,
  );
  if (alternatives.length < 2)
    throw new Error("writing_alternatives_incomplete");
  return {
    language: "en",
    tool: request.tool,
    original: request.sentence,
    alternatives,
  };
}

export type WritingWork = {
  id: string;
  tool: WritingTool;
  status:
    | "queued"
    | "processing"
    | "backoff"
    | "recovering"
    | "uncertain"
    | "completed"
    | "failed"
    | "cancelled"
    | "expired";
  result: WritingAlternatives | null;
  expiresAt: string;
};
export type WritingAvailability = {
  available: boolean;
  authorized: boolean;
  consented: boolean;
  policy: string;
  provider: string | null;
};
export const writingAvailabilitySchema = z.object({
  available: z.boolean(),
  authorized: z.boolean(),
  consented: z.boolean(),
  policy: z.string().max(100),
  provider: z.string().max(1000).nullable(),
});
export const unavailableWriting: WritingAvailability = {
  available: false,
  authorized: false,
  consented: false,
  policy: writingPolicy,
  provider: null,
};
