import { z } from "zod";

/** One pack today. UI messages and proofing data stay independent for future i18n. */
export const writingRules = [
  "brackets",
  "quotes",
  "articles",
  "repetition",
  "spacing",
  "capitalization",
  "redundancy",
  "agreement",
  "plurals",
  "confusion",
] as const;
export type WritingRule = (typeof writingRules)[number];
const ruleSchema = z
  .object({
    brackets: z.boolean().default(true),
    quotes: z.boolean().default(true),
    articles: z.boolean().default(true),
    repetition: z.boolean().default(true),
    spacing: z.boolean().default(true),
    capitalization: z.boolean().default(true),
    redundancy: z.boolean().default(true),
    agreement: z.boolean().default(true),
    plurals: z.boolean().default(true),
    confusion: z.boolean().default(true),
  })
  .strict();
export const writingSettingsSchema = z
  .object({
    language: z.literal("en").default("en"),
    enabled: z.boolean().default(true),
    spelling: z.boolean().default(true),
    grammar: z.boolean().default(true),
    aiRewrites: z.boolean().default(true),
    automatic: z.boolean().default(true),
    highlights: z.boolean().default(true),
    rules: ruleSchema.default(() => ruleSchema.parse({})),
    words: z
      .array(
        z
          .string()
          .min(1)
          .max(80)
          .regex(/^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u),
      )
      .max(1000)
      .default([]),
  })
  .strict();
export type WritingSettings = z.infer<typeof writingSettingsSchema>;
// Patches must not inherit defaults: omitted fields preserve prior explicit opt-outs.
export const writingPatchSchema = z
  .object({
    language: z.literal("en").optional(),
    enabled: z.boolean().optional(),
    spelling: z.boolean().optional(),
    grammar: z.boolean().optional(),
    aiRewrites: z.boolean().optional(),
    automatic: z.boolean().optional(),
    highlights: z.boolean().optional(),
    rules: z.partialRecord(z.enum(writingRules), z.boolean()).optional(),
    words: writingSettingsSchema.shape.words.removeDefault().optional(),
  })
  .strict();
export type WritingPatch = z.infer<typeof writingPatchSchema>;

export function effectiveWritingSettings(
  settings: WritingSettings,
  site: WritingPatch = {},
  groveEnabled = true,
): WritingSettings {
  const next = {
    ...settings,
    rules: { ...settings.rules },
    enabled: groveEnabled && settings.enabled && site.enabled !== false,
  };
  for (const key of [
    "spelling",
    "grammar",
    "aiRewrites",
    "automatic",
    "highlights",
  ] as const)
    next[key] = settings[key] && site[key] !== false;
  for (const rule of writingRules)
    next.rules[rule] = settings.rules[rule] && site.rules?.[rule] !== false;
  return next;
}

export type EditorMetadata = {
  tag: string;
  type?: string;
  visible: boolean;
  rows?: number;
  multiline?: boolean;
  editable?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  inert?: boolean;
  spellcheck?: boolean;
  code?: boolean;
  autocomplete?: string;
  label?: string;
  labelComplete?: boolean;
  name?: string;
};
/** Metadata only: never inspect value/text to decide whether a field is safe. */
export function eligibleEditor(meta: EditorMetadata): boolean {
  if (
    !meta.visible ||
    meta.disabled ||
    meta.readonly ||
    meta.inert ||
    meta.code ||
    meta.labelComplete === false ||
    meta.multiline === false ||
    meta.spellcheck === false
  )
    return false;
  const tag = meta.tag.toLowerCase();
  if (tag !== "textarea" && !(meta.editable && meta.multiline)) return false;
  if (
    tag === "input" ||
    (tag === "textarea" && (meta.rows ?? 2) < 2 && !meta.multiline)
  )
    return false;
  const autocomplete = (meta.autocomplete ?? "").toLowerCase().split(/\s+/);
  if (
    autocomplete.some((part) =>
      /^(?:username|current-password|new-password|one-time-code|cc-.+|name|given-name|family-name|email|tel.*|street-address|address-.+|postal-code|bday.*|organization.*)$/.test(
        part,
      ),
    )
  )
    return false;
  const purpose = `${meta.label ?? ""} ${meta.name ?? ""}`
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ");
  return !/\b(?:password|passcode|user\s*name|login|otp|verification\s*code|security\s*code|credit\s*card|card\s*number|cvv|social\s*security|email\s*address|phone|telephone|address|postal|zip|search|filter|subject|title|tags?|name|email)\b/i.test(
    purpose,
  );
}

export const englishMessages = {
  spelling: "Possible spelling mistake.",
  brackets: "Check the matching bracket.",
  quotes: "Check the matching quotation mark.",
  articles: "Use a or an according to the next word’s sound.",
  repetition: "This word appears twice.",
  spacing: "Check spacing around these words or punctuation.",
  capitalization: "Check capitalization.",
  redundancy: "This phrase can be shorter.",
  agreement: "Use the verb form that matches the subject.",
  plurals: "Plural acronyms don’t need an apostrophe.",
  confusion: "This wording is a common mix-up.",
} as const;
export type WritingIssue = {
  id: string;
  rule: WritingRule | "spelling";
  message: keyof typeof englishMessages;
  from: number;
  to: number;
  original: string;
  replacements: string[];
};
export type WritingResult = {
  language: "en";
  issues: WritingIssue[];
  complete: boolean;
  checkedTo: number;
};

/** Masks syntax without changing offsets. Not a Markdown serializer or content mutation. */
export function prose(text: string) {
  const hide = (value: string) => value.replace(/[^\r\n]/g, " ");
  return text
    .replace(
      /(^|\n)(?: {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\2[^\n]*(?=\n|$)|$)/g,
      hide,
    )
    .replace(/`+[^`\n]*`+/g, hide)
    .replace(/!?(\[[^\]\n]*\])\([^)\n]*\)/g, (all: string, label: string) =>
      ` ${label.slice(1, -1)}${" ".repeat(all.length - label.length + 1)}`.slice(
        0,
        all.length,
      ),
    )
    .replace(
      /https?:\/\/[^\s<>]+|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|<[^>\n]*>/gi,
      hide,
    )
    .replace(/(?:^|\n)(?: {4}|\t)[^\n]*/g, hide)
    .replace(/\b[\p{L}\d]+(?:[_/][\p{L}\d]+)+\b/gu, hide);
}

const soundAn = /^(?:hour|honest|honou?r|heir)/i;
const soundA =
  /^(?:uni(?:vers|form|on|que|t|corn|sex|fy|lateral)|us(?:e|er|ual)|useful|util|euro|one(?:\b|-)|once)/i;
export function articleFor(word: string): "a" | "an" | null {
  if (soundAn.test(word)) return "an";
  if (soundA.test(word)) return "a";
  if (/^[A-Z]{2,}$/.test(word)) {
    if (["NASA", "NATO", "UNESCO"].includes(word)) return "a";
    if (
      [
        "FBI",
        "MRI",
        "HTML",
        "HTTP",
        "URL",
        "USB",
        "EU",
        "UK",
        "US",
        "API",
        "AI",
      ].includes(word)
    )
      return /^[AEFHILMNORSX]/.test(word) ? "an" : "a";
    return null;
  }
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** Small, unambiguous wordy phrases only; ambiguous wording is left to the writer. */
export const wordyPhrases: [RegExp, string][] = [
  [/\ball of (the|these|those)\b/gi, "all $1"],
  [/\bin order to\b/gi, "to"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bin the event that\b/gi, "if"],
  [/\bin spite of the fact that\b/gi, "although"],
  [/\bon a (daily|weekly|monthly|yearly|regular) basis\b/gi, "$1"],
  [/\bclose proximity\b/gi, "proximity"],
  [/\babsolutely essential\b/gi, "essential"],
  [/\bcompletely finished\b/gi, "finished"],
  [/\bbasic fundamentals\b/gi, "fundamentals"],
  [/\brevert back\b/gi, "revert"],
  [/\breturn back\b/gi, "return"],
  [/\brepeat again\b/gi, "repeat"],
];
/** Fixed phrases whose wrong form is never the intended meaning. */
export const confusedPhrases: [RegExp, string][] = [
  [/\bweather or not\b/gi, "whether or not"],
  [/\bfor all intensive purposes\b/gi, "for all intents and purposes"],
  [/\bpiece of mind\b/gi, "peace of mind"],
  [/\bfree reign\b/gi, "free rein"],
  [/\bbaited breath\b/gi, "bated breath"],
  [/\bdeep-seeded\b/gi, "deep-seated"],
  [/\bescape goat\b/gi, "scapegoat"],
  [/\bpeaked my interest\b/gi, "piqued my interest"],
  [/\bwet your appetite\b/gi, "whet your appetite"],
  [/\bextract revenge\b/gi, "exact revenge"],
  [/\bby in large\b/gi, "by and large"],
];
/** Two-word fixes the single-word spelling suggester cannot offer. */
export const phraseSuggestions = new Map<string, string>([
  ["alot", "a lot"],
  ["noone", "no one"],
  ["eachother", "each other"],
  ["incase", "in case"],
  ["aswell", "as well"],
  ["inspite", "in spite"],
  ["ofcourse", "of course"],
  ["infact", "in fact"],
  ["atleast", "at least"],
  ["everytime", "every time"],
]);
export const determiners =
  /^(?:a|an|the|this|that|these|those|my|your|his|her|our|their|its|another)$/i;
export const objectPrepositions =
  /^(?:between|for|to|from|with|of|at|by|near|around|about|against|among|behind|beside|under|over|without|within|into|onto|upon|toward|towards|across|after|before|except|like)$/i;
/** Declarative pronoun + be/have forms; questions invert and are never matched. */
export const agreementForms: Record<string, Record<string, string>> = {
  i: { is: "am", are: "am", has: "have", "doesn't": "don't" },
  you: {
    is: "are",
    am: "are",
    was: "were",
    has: "have",
    "doesn't": "don't",
  },
  we: {
    is: "are",
    am: "are",
    was: "were",
    has: "have",
    "doesn't": "don't",
  },
  they: {
    is: "are",
    am: "are",
    was: "were",
    has: "have",
    "doesn't": "don't",
  },
  he: { are: "is", am: "is", were: "was", have: "has", "don't": "doesn't" },
  she: { are: "is", am: "is", were: "was", have: "has", "don't": "doesn't" },
  it: { are: "is", am: "is", were: "was", have: "has", "don't": "doesn't" },
};
export const matchCase = (sample: string, replacement: string) =>
  /^[\p{Lu}]/u.test(sample)
    ? replacement[0]!.toLocaleUpperCase("en") + replacement.slice(1)
    : replacement;


export function applyWritingEdit(
  source: string,
  issue: WritingIssue,
  replacement: string,
) {
  if (
    issue.from < 0 ||
    issue.to > source.length ||
    issue.to < issue.from ||
    source.slice(issue.from, issue.to) !== issue.original ||
    !issue.replacements.includes(replacement)
  )
    throw new Error(
      "Writing changed. Check it again before applying this suggestion.",
    );
  return source.slice(0, issue.from) + replacement + source.slice(issue.to);
}

/** Preserve one ignored occurrence through unrelated edits, never a global word ban. */
export function mapIgnoredIssues(
  before: string,
  after: string,
  issues: WritingIssue[],
): WritingIssue[] {
  before = before.slice(0, 6000);
  after = after.slice(0, 6000);
  let from = 0,
    oldEnd = before.length,
    newEnd = after.length;
  while (from < Math.min(oldEnd, newEnd) && before[from] === after[from])
    from++;
  while (
    oldEnd > from &&
    newEnd > from &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  const delta = newEnd - oldEnd;
  return issues.flatMap((issue) => {
    if (issue.to <= from) return [{ ...issue }];
    if (issue.from < oldEnd) return [];
    const moved = { ...issue, from: issue.from + delta, to: issue.to + delta };
    return after.slice(moved.from, moved.to) === issue.original ? [moved] : [];
  });
}
