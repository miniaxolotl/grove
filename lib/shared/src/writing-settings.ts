import { z } from "zod";
import { maskMarkdownCode } from "./writing-markdown.ts";

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
/** Compare personal entries without changing the spelling the writer saved. */
export const dictionaryWordKey = (word: string) =>
  word
    .normalize("NFC")
    .toLocaleLowerCase("en")
    .replaceAll("’", "'")
    .replace(/[‐‑]/gu, "-");
export const personalWordLimit = 1000;
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
          .regex(/^[\p{L}\p{M}]+(?:['’‐‑-][\p{L}\p{M}]+)*$/u),
      )
      .max(personalWordLimit)
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
  return maskMarkdownCode(text, hide)
    .replace(
      /(!?\[)([^\]\n]*)(\]\([^)\n]*\))/g,
      (_, open: string, label: string, close: string) =>
        hide(open) + label + hide(close),
    )
    .replace(
      /https?:\/\/[^\s<>]+|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|<[^>\n]*>/gi,
      hide,
    )
    .replace(/\b[\p{L}\d]+(?:[_/][\p{L}\d]+)+\b/gu, hide);
}

const soundAn = /^(?:hour|honest|honou?r|heir)/i;
const soundA =
  /^(?:uni(?:vers|form|on|que|t|corn|sex|fy|fi|lateral)|us(?:e|ual)|ubiquit|util|utensil|euro|eulog|ewe|one(?:$|sie|ness)|once)/i;
const variableSound = /^(?:herb|histori|homage|unioni[sz]ed|(?:sql|url|faq)$)/i;
const spokenAcronyms = /^(?:NASA|NATO|UNESCO)$/;
const spokenInitials = /^(?:AI|API|EU|FBI|MBA|MRI|SMS|UFO|UI|UK|US|USB)$/;

export function articleFor(word: string): "a" | "an" | null {
  // The first component carries the sound in "MRI-guided" and "one-off".
  const first = word.split(/[-‐‑'’]/, 1)[0];
  if (spokenAcronyms.test(first)) return "a";
  if (spokenInitials.test(first) || /^[a-z]$/i.test(first)) {
    if (/^h$/i.test(first)) return null; // aitch / haitch
    return /^[aefilmnorsx]/i.test(first) ? "an" : "a";
  }
  // Don't pronounce unknown abbreviations (SQL, URL) or mixed-case names
  // (SQLite) by applying ordinary spelling rules to their first letter.
  if (!/^[A-Za-z][a-z]+$/.test(first) || variableSound.test(first)) return null;
  if (soundAn.test(first)) return "an";
  if (soundA.test(first)) return "a";
  return /^[aeiou]/i.test(first) ? "an" : "a";
}

/** Keep the quantifiers in “more smaller boxes” and “most best practices”.
 * Lookarounds supply evidence without including the context in the edit. */
export const wordyPhrases: [RegExp, string][] = [
  [/\ball of (the|these|those)\b/gi, "all $1"],
  [/\bin order to\b/gi, "to"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bin the event that\b/gi, "if"],
  [/\bin spite of the fact that\b/gi, "although"],
  [/\bon a (daily|weekly|monthly|yearly) basis\b/gi, "$1"],
  [/\bon a regular basis\b/gi, "regularly"],
  [/\bclose proximity\b/gi, "proximity"],
  [/\babsolutely essential\b/gi, "essential"],
  [/\bcompletely finished\b/gi, "finished"],
  [/\bbasic fundamentals\b/gi, "fundamentals"],
  [/\brevert back\b/gi, "revert"],
  [/\breturn back\b/gi, "return"],
  [/\brepeat again\b/gi, "repeat"],
  [
    /(?<=\b(?:am|is|are|was|were|be) )more (better|worse|bigger|smaller|greater|larger|higher|lower|faster|slower|easier|harder|smarter|older|younger|newer|stronger|weaker|sooner|later|earlier)(?= than\b|[.!?]|$)/gi,
    "$1",
  ],
  [
    /(?<=\b(?:am|is|are|was|were|be) the )most (best|worst|biggest|smallest|greatest|largest|highest|lowest|fastest|slowest|easiest|hardest|earliest|latest|smartest|oldest|youngest|newest|strongest|weakest)\b/gi,
    "$1",
  ],
];
/** Common mix-ups. Limit ambiguous fragments to likely idiomatic contexts. */
export const confusedPhrases: [RegExp, string][] = [
  [/\bweather or not(?= (?:i|you|he|she|it|we|they)\b)/gi, "whether or not"],
  [/\bfor all intensive purposes\b/gi, "for all intents and purposes"],
  [/\bpiece of mind\b/gi, "peace of mind"],
  [/\bfree reign\b/gi, "free rein"],
  [/\bbaited breath\b/gi, "bated breath"],
  [/\bdeep-seeded\b/gi, "deep-seated"],
  [/\ban escape goat\b/gi, "a scapegoat"],
  [/(?<!\ban )\bescape goat\b/gi, "scapegoat"],
  [/\bpeaked my interest\b/gi, "piqued my interest"],
  [/\bwet your appetite\b/gi, "whet your appetite"],
  [/\bextract revenge\b/gi, "exact revenge"],
  [/\bby in large(?=,)/gi, "by and large"],
  [
    /\b(more|less|fewer|greater|smaller|bigger|larger|higher|lower|faster|slower|easier|harder|stronger|weaker|sooner|later|earlier|better|worse|rather|other) then(?= (?:this|that|these|those|me|him|her|us|them)(?:[.,;:!?]|$))/gi,
    "$1 than",
  ],
];
/** Single-token fixes the affix suggester cannot rank: either it returns
 * nothing useful or buries the overwhelmingly intended word. American
 * spellings only; ambiguous cases stay out. */
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
  ["maintainance", "maintenance"],
  ["questionairre", "questionnaire"],
  ["lisence", "license"],
  ["speach", "speech"],
  ["tendancy", "tendency"],
  ["wich", "which"],
]);
export const determiners =
  /^(?:a|an|the|this|that|these|those|my|your|his|her|our|their|its|another)$/i;
export const objectPrepositions =
  /^(?:between|for|to|from|with|of|at|by|near|around|about|against|among|behind|beside|under|over|without|within|into|onto|upon|toward|towards|across|after|before|except|like)$/i;
/** English question operators that invert pronoun + verb ("does he have").
 * Language-pack data: the agreement check abstains after these rather than
 * "fixing" a correct bare verb. */
export const questionOperators =
  /^(?:do|does|did|will|would|shall|should|can|could|may|might|must)$/;
/** English verbs whose mandative complement takes the base form
 * ("I suggest he go"). Language-pack data for the same abstention. */
export const mandativeTriggers =
  /^(?:suggest|suggests|insist|insists|demand|demands|require|requires|recommend|recommends|propose|proposes|request|requests|ask|asks|prefer|prefers)$/;
/** Declarative pronoun + be/have forms; questions invert and are never matched. */
const beHaveAgreement: Record<string, Record<string, string>> = {
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
/**
 * Common verbs with regular 3rd-person singular agreement. Singular subjects
 * take the inflected form ("he goes"), plural subjects the base ("they go").
 * Only pronouns trigger; nouns, names and clause subjects never match, and
 * inverted questions and mandative subjunctives are guarded at the call site.
 */
const verbAgreement: [base: string, third: string][] = [
  ["go", "goes"],
  ["do", "does"],
  ["say", "says"],
  ["get", "gets"],
  ["make", "makes"],
  ["take", "takes"],
  ["come", "comes"],
  ["see", "sees"],
  ["know", "knows"],
  ["want", "wants"],
  ["need", "needs"],
  ["like", "likes"],
  ["think", "thinks"],
  ["work", "works"],
  ["look", "looks"],
  ["use", "uses"],
  ["find", "finds"],
  ["give", "gives"],
  ["tell", "tells"],
  ["call", "calls"],
  ["try", "tries"],
  ["carry", "carries"],
  ["leave", "leaves"],
  ["fly", "flies"],
  ["watch", "watches"],
  ["teach", "teaches"],
  ["finish", "finishes"],
  ["miss", "misses"],
  ["fix", "fixes"],
  ["pass", "passes"],
];
const pluralSubjects = ["i", "you", "we", "they"];
const singularSubjects = ["he", "she", "it"];
const singularWrong: Record<string, string> = Object.fromEntries(
  verbAgreement.map(([base, third]) => [third, base]),
);
const pluralWrong: Record<string, string> = Object.fromEntries(
  verbAgreement.map(([base, third]) => [base, third]),
);
export const agreementForms: Record<string, Record<string, string>> = {
  ...Object.fromEntries(
    pluralSubjects.map((subject) => [
      subject,
      { ...beHaveAgreement[subject], ...singularWrong },
    ]),
  ),
  ...Object.fromEntries(
    singularSubjects.map((subject) => [
      subject,
      { ...beHaveAgreement[subject], ...pluralWrong },
    ]),
  ),
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
