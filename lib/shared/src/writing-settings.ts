import { z } from "zod";
import { projectWritingText } from "./writing-markdown.ts";
export { projectWritingText };

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
  inputmode?: string;
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
export function eligibleEditor(
  meta: EditorMetadata,
  options: { proseFields?: boolean } = {},
): boolean {
  if (
    !meta.visible ||
    meta.disabled ||
    meta.readonly ||
    meta.inert ||
    meta.code ||
    meta.labelComplete === false ||
    (!options.proseFields && meta.multiline === false) ||
    meta.spellcheck === false
  )
    return false;
  const tag = meta.tag.toLowerCase();
  if (options.proseFields) {
    if (tag === "body" || tag === "html") return false;
    if (
      ["numeric", "decimal", "tel", "email", "url", "search"].includes(
        (meta.inputmode ?? "").toLowerCase(),
      )
    )
      return false;
    if (tag !== "textarea" && tag !== "input" && !meta.editable) return false;
    if (
      tag === "input" &&
      !["", "text"].includes((meta.type ?? "").toLowerCase())
    )
      return false;
  } else {
    if (tag !== "textarea" && !(meta.editable && meta.multiline)) return false;
    if (
      tag === "input" ||
      (tag === "textarea" && (meta.rows ?? 2) < 2 && !meta.multiline)
    )
      return false;
  }
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
  if (options.proseFields) {
    const prosePurpose =
      /\b(?:message|comment|subject|article\s*title|post\s*title|description|feedback|caption|reply|summary|headline)\b/i.test(
        purpose,
      );
    if (
      /\bemail\b/i.test(purpose) &&
      (!prosePurpose ||
        /email(?:address)?$/i.test((meta.name ?? "").replace(/[\W_]/g, "")))
    )
      return false;
    if (
      /\b(?:password|passcode|user\s*name|login|otp|verification\s*code|security\s*code|credit\s*card|card\s*number|cvv|social\s*security|email\s*(?:address|id)|phone|telephone|address|postal|zip|search|filter|query|tags?|name|job\s*title|api\s*key|token|secret|bank|account\s*number|tax|passport|ssn)\b/i.test(
        purpose,
      )
    )
      return false;
    return tag !== "input" || prosePurpose;
  }
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
  return projectWritingText(text).text;
}

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
