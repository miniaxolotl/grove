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
  contextExcerpt: 500,
  alternative: 4000,
  alternatives: 3,
  lifetimeSeconds: 900,
  deadlineSeconds: 60,
} as const;
export const writingPolicy = "rewrite-context-v3";
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

export const writingContextSchema = z
  .object({
    previousSentence: z.string().max(writingLimits.contextExcerpt),
    nextSentence: z.string().max(writingLimits.contextExcerpt),
    sentenceBefore: z.string().max(writingLimits.contextExcerpt),
    sentenceAfter: z.string().max(writingLimits.contextExcerpt),
    startsSentence: z.boolean(),
    endsSentence: z.boolean(),
    startsParagraph: z.boolean(),
    endsParagraph: z.boolean(),
  })
  .strict();
export type WritingContext = z.infer<typeof writingContextSchema>;

/** Derive only for an explicit rewrite, from the same eligible editor snapshot. */
export function writingContextFor(
  source: string,
  selection: WritingSelection | null,
): WritingContext | null {
  if (
    !selection ||
    selectWritingSentence(source, selection.from, selection.to)?.original !==
      selection.original
  )
    return null;
  const left = Math.max(0, selection.from - writingLimits.sentence);
  const right = Math.min(source.length, selection.to + writingLimits.sentence);
  const window = source.slice(left, right);
  const from = selection.from - left,
    to = selection.to - left;
  const sentences: {
    start: number;
    end: number;
    paragraphStart: number;
    paragraphEnd: number;
  }[] = [];
  const addParagraph = (start: number, end: number) => {
    const raw = window.slice(start, end);
    start += raw.length - raw.trimStart().length;
    end -= raw.length - raw.trimEnd().length;
    for (const part of segmenter.segment(window.slice(start, end))) {
      const text = part.segment.trim();
      if (!text) continue;
      const sentenceStart =
        start +
        part.index +
        part.segment.length -
        part.segment.trimStart().length;
      sentences.push({
        start: sentenceStart,
        end: sentenceStart + text.length,
        paragraphStart: start,
        paragraphEnd: end,
      });
    }
  };
  let start = 0;
  for (const boundary of window.matchAll(/\r?\n[\t ]*\r?\n/g)) {
    addParagraph(start, boundary.index);
    start = boundary.index + boundary[0].length;
  }
  addParagraph(start, window.length);
  const index = sentences.findIndex(
    (sentence) => from >= sentence.start && to <= sentence.end,
  );
  if (index < 0) return null;
  const current = sentences[index];
  const previous = sentences[index - 1],
    next = sentences[index + 1];
  const beforeKnown = left === 0 || current.start > 0;
  const afterKnown = right === source.length || current.end < window.length;
  return writingContextSchema.parse({
    previousSentence: previous
      ? window
          .slice(previous.start, previous.end)
          .slice(-writingLimits.contextExcerpt)
      : "",
    nextSentence: next
      ? window
          .slice(next.start, next.end)
          .slice(0, writingLimits.contextExcerpt)
      : "",
    sentenceBefore: window
      .slice(current.start, from)
      .slice(-writingLimits.contextExcerpt),
    sentenceAfter: window
      .slice(to, current.end)
      .slice(0, writingLimits.contextExcerpt),
    startsSentence: from === current.start && beforeKnown,
    endsSentence: to === current.end && afterKnown,
    startsParagraph:
      from === current.paragraphStart &&
      (left === 0 || current.paragraphStart > 0),
    endsParagraph:
      to === current.paragraphEnd &&
      (right === source.length || current.paragraphEnd < window.length),
  });
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
    context: writingContextSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (["synonyms", "antonyms"].includes(value.tool) && value.context)
      context.addIssue({
        code: "custom",
        path: ["context"],
        message: "Word alternatives send only the selected word.",
      });
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
/** Cached selection-only consent never authorizes sending neighboring text. */
export function hasCurrentWritingConsent(
  availability: WritingAvailability | undefined,
): boolean {
  return (
    !!availability?.available &&
    availability.authorized &&
    availability.consented &&
    new RegExp(`^${writingPolicy}:[a-f\\d]{16}$`, "i").test(availability.policy)
  );
}
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
