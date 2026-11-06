import nspell from "nspell";
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
function prose(text: string) {
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
function articleFor(word: string): "a" | "an" | null {
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
const wordyPhrases: [RegExp, string][] = [
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
const confusedPhrases: [RegExp, string][] = [
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
const phraseSuggestions = new Map<string, string>([
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
const determiners =
  /^(?:a|an|the|this|that|these|those|my|your|his|her|our|their|its|another)$/i;
const objectPrepositions =
  /^(?:between|for|to|from|with|of|at|by|near|around|about|against|among|behind|beside|under|over|without|within|into|onto|upon|toward|towards|across|after|before|except|like)$/i;
/** Declarative pronoun + be/have forms; questions invert and are never matched. */
const agreementForms: Record<string, Record<string, string>> = {
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
const matchCase = (sample: string, replacement: string) =>
  /^[\p{Lu}]/u.test(sample)
    ? replacement[0]!.toLocaleUpperCase("en") + replacement.slice(1)
    : replacement;

export function createEnglishChecker(dictionary: { aff: string; dic: string }) {
  const spell = nspell(dictionary);
  const correct = (word: string) => spell.correct(word.replaceAll("’", "'"));
  const alternatives = new Map<string, string[]>();
  return {
    language: "en" as const,
    suggest(word: string) {
      if (!/^[\p{L}\p{M}'’-]{1,24}$/u.test(word)) return [];
      const phrase = phraseSuggestions.get(word.toLocaleLowerCase("en"));
      if (phrase) return [matchCase(word, phrase)];
      if (!alternatives.has(word)) {
        if (alternatives.size >= 64)
          alternatives.delete(alternatives.keys().next().value!);
        alternatives.set(
          word,
          spell
            .suggest(word)
            .filter(correct)
            .slice(0, 3)
            .map((candidate) => matchCase(word, candidate)),
        );
      }
      return [...alternatives.get(word)!];
    },
    check(source: string, settings: WritingSettings): WritingResult {
      settings = writingSettingsSchema.parse(settings);
      const checkedTo = Math.min(source.length, 6000);
      const result: WritingResult = {
        language: "en",
        issues: [],
        complete: source.length <= 6000,
        checkedTo,
      };
      if (!settings.enabled) return result;
      const text = prose(source.slice(0, checkedTo));
      const add = (
        rule: WritingIssue["rule"],
        from: number,
        to: number,
        replacements: string[] = [],
      ) => {
        if (result.issues.length >= 50 || to > checkedTo) return;
        result.issues.push({
          id: `${rule}:${from}:${to}`,
          rule,
          message: rule,
          from,
          to,
          original: source.slice(from, to),
          replacements: [...new Set(replacements)]
            .filter((r) => r !== source.slice(from, to))
            .slice(0, 3),
        });
      };
      const words = [
        ...text.matchAll(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu),
      ];
      const personal = new Set(
        settings.words.map((word) =>
          word.toLocaleLowerCase("en").replaceAll("’", "'"),
        ),
      );
      if (settings.spelling)
        for (const match of words) {
          const word = match[0];
          if (
            word.length > 48 ||
            /^[A-Z]{2,}$/.test(word) ||
            /^[A-Z]{2,}s$/.test(word) ||
            /[a-z][A-Z]/.test(word) ||
            personal.has(word.toLocaleLowerCase("en").replaceAll("’", "'")) ||
            correct(word)
          )
            continue;
          // Typing is lookup-only. Alternatives are requested when an issue is opened.
          add("spelling", match.index, match.index + word.length);
        }
      const enabled = (rule: WritingRule) =>
        settings.grammar && settings.rules[rule];
      if (enabled("articles"))
        for (let i = 0; i + 1 < words.length; i++) {
          const article = words[i],
            next = words[i + 1];
          if (
            !/^(?:a|an)$/i.test(article[0]) ||
            !/^\s+$/.test(
              text.slice(article.index + article[0].length, next.index),
            )
          )
            continue;
          const expected = articleFor(next[0]);
          // A plural-looking noun after the article points at the noun's number,
          // not the article; ambiguous cases abstain rather than guess.
          const pluralShaped =
            /^(?:children|people|men|women|feet|teeth|mice|geese)$/i.test(
              next[0],
            ) ||
            (/s$/i.test(next[0]) && !/(?:ss|us|is)$/i.test(next[0]));
          if (
            expected &&
            !pluralShaped &&
            article[0].toLowerCase() !== expected
          )
            add("articles", article.index, article.index + article[0].length, [
              /^[A-Z]/.test(article[0])
                ? expected[0].toUpperCase() + expected.slice(1)
                : expected,
            ]);
        }
      if (enabled("repetition"))
        for (let i = 1; i < words.length; i++) {
          const previous = words[i - 1],
            current = words[i];
          if (
            previous[0].toLowerCase() === current[0].toLowerCase() &&
            !/^(?:had|that|can|do|is)$/i.test(current[0]) &&
            /^ +$/.test(
              text.slice(previous.index + previous[0].length, current.index),
            )
          )
            add(
              "repetition",
              current.index,
              current.index + current[0].length,
              [""],
            );
        }
      if (enabled("spacing")) {
        for (const match of text.matchAll(/\S( {2,})(?=\S)/g)) {
          const from = match.index + 1;
          // Masked syntax isn't whitespace authored by the user.
          if (source.slice(from, from + match[1].length) === match[1])
            add("spacing", from, from + match[1].length, [" "]);
        }
        for (const match of text.matchAll(/\p{L}( +)(?=[,!?;:])/gu))
          add(
            "spacing",
            match.index + match[0].length - match[1].length,
            match.index + match[0].length,
            [""],
          );
        for (const match of text.matchAll(/[,!?;:](?=\p{L})/gu))
          add("spacing", match.index + 1, match.index + 1, [" "]);
      }
      if (enabled("capitalization")) {
        const capitalize = (at: number) => {
          const word = /^\p{L}+/u.exec(text.slice(at))?.[0] ?? "";
          if (
            !word ||
            /[a-z][A-Z]/.test(word) ||
            result.issues.some(
              (issue) => issue.rule === "capitalization" && issue.from === at,
            )
          )
            return;
          add("capitalization", at, at + 1, [text[at].toUpperCase()]);
        };
        for (const match of text.matchAll(/\bi\b/g)) capitalize(match.index);
        const first = /^\s*([a-z])/u.exec(text);
        if (first) capitalize(first[0].length - 1);
        for (const match of text.matchAll(
          /[.!?](?:[ \t]+|\n[ \t]*(?:[-*+] |\d+[.)] |>+ )?)([a-z])/g,
        )) {
          const previous =
            /[A-Za-z.]+$/.exec(text.slice(0, match.index))?.[0] ?? "";
          if (
            /^(?:mr|mrs|ms|dr|prof|st|vs|etc|[A-Za-z](?:\.[A-Za-z])+)$/.test(
              previous.toLowerCase(),
            )
          )
            continue;
          capitalize(match.index + match[0].length - 1);
        }
      }
      if (enabled("redundancy"))
        for (const [pattern, replacement] of wordyPhrases)
          for (const match of text.matchAll(pattern))
            add(
              "redundancy",
              match.index,
              match.index + match[0].length,
              // Rebuild the replacement so its article matches the words found.
              [matchCase(match[0], match[0].replace(pattern, replacement))],
            );
      if (enabled("agreement")) {
        const between = (
          a: { index: number; "0": string },
          b: RegExpMatchArray,
        ) => /^\s+$/.test(text.slice(a.index + a[0].length, b.index));
        for (let i = 0; i + 1 < words.length; i++) {
          const current = words[i],
            next = words[i + 1];
          if (!between(current, next)) continue;
          const verb =
            agreementForms[current[0].toLocaleLowerCase("en")]?.[
              next[0].toLocaleLowerCase("en")
            ];
          if (verb)
            add("agreement", next.index, next.index + next[0].length, [
              matchCase(next[0], verb),
            ]);
          else if (
            /^(?:should|could|would|must|might)$/i.test(current[0]) &&
            /^of$/i.test(next[0])
          )
            add("agreement", next.index, next.index + next[0].length, [
              matchCase(next[0], "have"),
            ]);
        }
      }
      if (enabled("plurals")) {
        for (const match of text.matchAll(/\b\d{4}['’]s\b/g))
          add("plurals", match.index, match.index + match[0].length, [
            `${match[0].slice(0, -2)}s`,
          ]);
        for (let i = 0; i + 1 < words.length; i++) {
          const acronym = words[i],
            next = words[i + 1];
          if (
            !/^([A-Z]{2,})['’]s$/.test(acronym[0]) ||
            !/^(?:are|were|have)$/i.test(next[0]) ||
            !/^\s+$/.test(
              text.slice(acronym.index + acronym[0].length, next.index),
            )
          )
            continue;
          add("plurals", acronym.index, acronym.index + acronym[0].length, [
            `${acronym[0].slice(0, -2)}s`,
          ]);
        }
      }
      if (enabled("confusion")) {
        for (const [pattern, replacement] of confusedPhrases)
          for (const match of text.matchAll(pattern))
            add("confusion", match.index, match.index + match[0].length, [
              matchCase(match[0], match[0].replace(pattern, replacement)),
            ]);
        for (const match of text.matchAll(/\b\d{1,4}(?:st|nd|rd|th)\b/gi)) {
          const digits = match[0].slice(0, -2),
            last = Number(digits.slice(-1)),
            suffix = match[0].slice(-2).toLowerCase();
          const expected =
            ["11", "12", "13"].includes(digits.slice(-2)) || !last || last > 3
              ? "th"
              : ["st", "nd", "rd"][last - 1];
          if (suffix !== expected)
            add("confusion", match.index, match.index + match[0].length, [
              digits + expected,
            ]);
        }
        const gap = (
          a: { index: number; "0": string },
          b: { index: number; "0": string },
        ) => /^\s+$/.test(text.slice(a.index + a[0].length, b.index));
        for (let i = 0; i < words.length; i++) {
          const word = words[i],
            next = words[i + 1],
            previous = words[i - 1];
          if (next && gap(word, next)) {
            if (/^its$/i.test(word[0]) && determiners.test(next[0]))
              // "its a/the/this…" is possessive before a determiner: it's.
              add("confusion", word.index, word.index + word[0].length, [
                matchCase(word[0], "it’s"),
              ]);
            if (
              /^their$/i.test(word[0]) &&
              /^(?:is|are|was|were)$/i.test(next[0])
            )
              add("confusion", word.index, word.index + word[0].length, [
                matchCase(word[0], "there"),
              ]);
            if (/^suppose$/i.test(word[0]) && /^to$/i.test(next[0]))
              add("confusion", word.index, next.index + next[0].length, [
                "supposed to",
              ]);
            if (
              /^use$/i.test(word[0]) &&
              /^to$/i.test(next[0]) &&
              !(
                previous &&
                (/^(?:do|does|did|don't|doesn't|didn't)$/i.test(previous[0]) ||
                  determiners.test(previous[0]) ||
                  (/^(?:i|you|we|they|he|she|it)$/i.test(previous[0]) &&
                    words[i - 2] &&
                    /^(?:do|does|did|don't|doesn't|didn't)$/i.test(
                      words[i - 2][0],
                    )))
              )
            )
              add("confusion", word.index, next.index + next[0].length, [
                "used to",
              ]);
          }
          // A preposition takes object case: "between you and I" → "and me".
          if (
            /^I$/.test(word[0]) &&
            previous &&
            /^and$/i.test(previous[0]) &&
            gap(previous, word)
          )
            for (let k = i - 2; k >= 0 && k >= i - 5; k--) {
              if (!gap(words[k], words[k + 1])) break;
              if (objectPrepositions.test(words[k][0])) {
                add("confusion", word.index, word.index + word[0].length, [
                  "me",
                ]);
                break;
              }
            }
        }
      }
      if (enabled("brackets")) {
        const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
        const stack: { char: string; at: number }[] = [];
        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          if (text[i - 1] === "\\") continue;
          if (pairs[char]) stack.push({ char, at: i });
          else if (")]}".includes(char)) {
            const opening = stack.pop();
            if (!opening || pairs[opening.char] !== char)
              add("brackets", i, i + 1);
          }
        }
        for (const opening of stack)
          add("brackets", opening.at, opening.at + 1);
      }
      if (enabled("quotes")) {
        const stack: { char: string; at: number }[] = [];
        const pairs: Record<string, string> = {
          "“": "”",
          "‘": "’",
          '"': '"',
          "'": "'",
        };
        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          if (!/[“”‘’"']/.test(char) || text[i - 1] === "\\") continue;
          const top = stack.at(-1);
          if (
            (char === "'" || char === "’") &&
            /[\p{L}\p{N}]/u.test(text[i - 1] ?? "") &&
            (/[\p{L}\p{N}]/u.test(text[i + 1] ?? "") ||
              (/s$/i.test(text.slice(0, i)) &&
                (!top || pairs[top.char] !== char)))
          )
            continue;
          if (
            /\d/.test(text[i - 1] ?? "") &&
            /["']/.test(char) &&
            (!top || pairs[top.char] !== char)
          )
            continue;
          if (top && pairs[top.char] === char) stack.pop();
          else if (pairs[char]) {
            // English multi-paragraph quotations may repeat the opening mark.
            if (top?.char === char && /\n\s*$/.test(text.slice(0, i))) continue;
            stack.push({ char, at: i });
          } else add("quotes", i, i + 1);
        }
        for (const opening of stack) add("quotes", opening.at, opening.at + 1);
      }
      result.issues.sort((a, b) => a.from - b.from || a.to - b.to);
      return result;
    },
  };
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
