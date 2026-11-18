import { createNoteDictionary } from "./writing-dictionary.ts";
import {
  agreementForms,
  articleFor,
  confusedPhrases,
  determiners,
  dictionaryWordKey,
  matchCase,
  mandativeTriggers,
  objectPrepositions,
  phraseSuggestions,
  prose,
  questionOperators,
  wordyPhrases,
  writingRules,
  writingSettingsSchema,
  type WritingIssue,
  type WritingResult,
  type WritingRule,
  type WritingSettings,
} from "./writing-settings.ts";

export * from "./writing-settings.ts";

/**
 * Ordered suggestion transforms. Each maps a misspelling to candidate
 * variants; only dictionary words survive filtering, so transforms cannot
 * invent suggestions. To teach the engine a new typo shape once for both
 * surfaces, add a transform here — no call-site changes needed.
 */
const candidateTransforms: ((word: string) => string[])[] = [
  // Missing apostrophes in contractions ("dont" → "don't").
  (word) => {
    const variants: string[] = [];
    for (let index = 1; index < word.length; index++)
      variants.push(`${word.slice(0, index)}'${word.slice(index)}`);
    return variants;
  },
  // Adjacent transpositions ("teh" → "the").
  (word) => {
    const variants: string[] = [];
    for (let index = 0; index + 1 < word.length; index++)
      variants.push(
        word.slice(0, index) +
          word[index + 1] +
          word[index] +
          word.slice(index + 2),
      );
    return variants;
  },
  // Dropped doubled letters ("refered" → "referred").
  (word) => {
    const variants: string[] = [];
    for (let index = 0; index < word.length; index++)
      variants.push(
        word.slice(0, index + 1) + word[index] + word.slice(index + 1),
      );
    return variants;
  },
];

export function createEnglishChecker(dictionary: { aff: string; dic: string }) {
  const spell = createNoteDictionary(dictionary);
  const correct = (word: string) => spell.correct(word.replaceAll("’", "'"));
  const alternatives = new Map<string, string[]>();
  return {
    language: "en" as const,
    suggest(word: string) {
      if (!/^[\p{L}\p{M}'’-]{1,24}$/u.test(word)) return [];
      const phrase = phraseSuggestions.get(word.toLocaleLowerCase("en"));
      if (phrase) return [matchCase(word, phrase)];
      if (!alternatives.has(word)) {
        const lookup = word.replaceAll("’", "'");
        if (alternatives.size >= 64)
          alternatives.delete(alternatives.keys().next().value!);
        const ranked: string[] = [];
        const seen = new Set<string>();
        const consider = (candidate: string) => {
          const key = candidate.toLocaleLowerCase("en");
          if (
            candidate !== lookup &&
            ranked.length < 3 &&
            !seen.has(key) &&
            correct(candidate)
          ) {
            seen.add(key);
            const styled = word.includes("’")
              ? candidate.replaceAll("'", "’")
              : candidate;
            ranked.push(matchCase(word, styled));
          }
        };
        // Deterministic generators run first: each only fires when its output is
        // a real dictionary word, so they cannot invent suggestions.
        for (const transform of candidateTransforms)
          for (const candidate of transform(lookup)) consider(candidate);
        for (const candidate of spell.suggest(lookup)) {
          if (ranked.length >= 3) break;
          consider(candidate);
        }
        alternatives.set(word, ranked);
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
        // Rules scan masked prose; a replacement may only touch literal source text.
        const original = source.slice(from, to);
        if (original !== text.slice(from, to)) return;
        result.issues.push({
          id: `${rule}:${from}:${to}`,
          rule,
          message: rule,
          from,
          to,
          original,
          replacements: [...new Set(replacements)]
            .filter((r) => r !== original)
            .slice(0, 3),
        });
      };
      const words = [
        ...text.matchAll(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu),
      ];
      const personal = new Set(settings.words.map(dictionaryWordKey));
      if (settings.spelling)
        for (const match of words) {
          const word = match[0];
          const key = dictionaryWordKey(word);
          if (
            word.length > 48 ||
            /^[A-Z]{2,}(?:['’]?s)?$/.test(word) ||
            /[a-z][A-Z]/.test(word) ||
            personal.has(key) ||
            (key.endsWith("'s") && personal.has(key.slice(0, -2))) ||
            correct(word)
          )
            continue;
          // Typing is lookup-only. Alternatives are requested when an issue is opened.
          add("spelling", match.index, match.index + word.length);
        }
      // Masked code and link destinations look like spaces in `text`. Use the
      // literal gap as evidence of adjacency; allow a soft wrap, not a new paragraph.
      const adjacent = (a: (typeof words)[number], b: (typeof words)[number]) =>
        /^(?:[^\S\r\n]+|[^\S\r\n]*\r?\n[^\S\r\n]*)$/u.test(
          source.slice(a.index + a[0].length, b.index),
        );
      // One registry drives every rule: adding a rule means adding its
      // check here plus its ID in writingRules, its messages and its
      // settings entry. Execution follows writingRules order.
      const ruleChecks: Record<WritingRule, () => void> = {
        articles: () => {
          for (let i = 0; i + 1 < words.length; i++) {
            const article = words[i],
              next = words[i + 1];
            if (!/^(?:a|an)$/i.test(article[0]) || !adjacent(article, next))
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
              add(
                "articles",
                article.index,
                article.index + article[0].length,
                [
                  /^[A-Z]/.test(article[0])
                    ? expected[0].toUpperCase() + expected.slice(1)
                    : expected,
                ],
              );
          }
        },
        repetition: () => {
          for (let i = 1; i < words.length; i++) {
            const previous = words[i - 1],
              current = words[i];
            if (
              previous[0].toLowerCase() === current[0].toLowerCase() &&
              !/^(?:had|that|can|do|is)$/i.test(current[0]) &&
              /^ +$/.test(
                source.slice(
                  previous.index + previous[0].length,
                  current.index,
                ),
              )
            )
              add(
                "repetition",
                previous.index + previous[0].length,
                current.index + current[0].length,
                [""],
              );
          }
        },
        spacing: () => {
          for (const match of text.matchAll(/\S( {2,})(?=\S)/g)) {
            const from = match.index + 1;
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
        },
        capitalization: () => {
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
        },
        redundancy: () => {
          for (const [pattern, replacement] of wordyPhrases)
            for (const match of text.matchAll(pattern))
              add(
                "redundancy",
                match.index,
                match.index + match[0].length,
                // Rebuild the replacement so its article matches the words found.
                [matchCase(match[0], match[0].replace(pattern, replacement))],
              );
        },
        agreement: () => {
          // Bare verb forms that can be correct after an operator or in a
          // mandative clause. Derived from the singular-subject table so the
          // two stay in sync: inflected forms ("goes") are never skipped.
          const bareForms = new Set(
            Object.keys(agreementForms.he).filter(
              (form) => !/^(?:are|am|were|don't)$/.test(form),
            ),
          );
          for (let i = 0; i + 1 < words.length; i++) {
            const current = words[i],
              next = words[i + 1];
            if (!adjacent(current, next)) continue;
            const previous =
              i > 0 && adjacent(words[i - 1], current)
                ? words[i - 1][0].toLowerCase().replaceAll("’", "'")
                : "";
            const beforePrevious =
              i > 1 && previous && adjacent(words[i - 2], words[i - 1])
                ? words[i - 2][0].toLowerCase()
                : "";
            // Inverted questions put the operator before the pronoun, and only
            // bare forms can be correct there: "does he have", "will she come".
            const subject = current[0].toLowerCase();
            const nextForm = next[0].toLowerCase().replaceAll("’", "'");
            if (
              bareForms.has(nextForm) &&
              (questionOperators.test(previous) ||
                /^(?:do|does|did|wo|would|sha|should|ca|could|might|must)n't$/.test(
                  previous,
                ) ||
                // In "let it go" and "make it work", it is the object.
                (subject === "it" &&
                  /^(?:let|lets|letting|make|makes|made|making)$/.test(
                    previous,
                  )))
            )
              continue;
            if (
              nextForm === "were" &&
              /^(?:if|wish|wishes|wished|though)$/.test(previous)
            )
              continue;
            // Mandative subjunctive takes the base form: "I suggest he go".
            if (
              (subject === "he" || subject === "she" || subject === "it") &&
              (mandativeTriggers.test(previous) ||
                (previous === "that" && mandativeTriggers.test(beforePrevious)))
            )
              continue;
            const verb = agreementForms[subject]?.[nextForm];
            if (typeof verb === "string")
              add("agreement", next.index, next.index + next[0].length, [
                matchCase(
                  next[0],
                  next[0].includes("’") ? verb.replaceAll("'", "’") : verb,
                ),
              ]);
            else if (
              /^(?:should|could|would|must|might)$/i.test(current[0]) &&
              /^of$/i.test(next[0]) &&
              // Require evidence of a participle, not an aside like "of course".
              words[i + 2] &&
              adjacent(next, words[i + 2]) &&
              /^(?:[a-z]+ed|been|seen|gone|done|had|got|gotten|made|read|said|sent|left|lost|won|run|known|shown|written|given|taken|come|become|kept|felt|found|bought|brought|thought|told|heard|put)$/i.test(
                words[i + 2][0],
              )
            )
              add("agreement", next.index, next.index + next[0].length, [
                matchCase(next[0], "have"),
              ]);
          }
        },
        plurals: () => {
          for (const match of text.matchAll(/\b\d{3}0['’]s\b/g)) {
            const after = source.slice(
              match.index + match[0].length,
              checkedTo,
            );
            // A decade may be plural; a year's budget may be possessive.
            if (
              !/^[ \t]+(?:are|were|have)\b/i.test(after) &&
              !(
                /\bthe[ \t]+$/i.test(source.slice(0, match.index)) &&
                /^(?:[.,;:!?]|$)/.test(after)
              )
            )
              continue;
            add("plurals", match.index, match.index + match[0].length, [
              `${match[0].slice(0, -2)}s`,
            ]);
          }
          for (let i = 0; i + 1 < words.length; i++) {
            const acronym = words[i],
              next = words[i + 1];
            if (
              !/^([A-Z]{2,})['’]s$/.test(acronym[0]) ||
              !/^(?:are|were|have)$/i.test(next[0]) ||
              !adjacent(acronym, next)
            )
              continue;
            add("plurals", acronym.index, acronym.index + acronym[0].length, [
              `${acronym[0].slice(0, -2)}s`,
            ]);
          }
        },
        confusion: () => {
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
          for (let i = 0; i < words.length; i++) {
            const word = words[i],
              next = words[i + 1],
              previous = words[i - 1];
            if (next && adjacent(word, next)) {
              if (/^its$/i.test(word[0]) && determiners.test(next[0]))
                // "its a/the/this…" is possessive before a determiner: it's.
                add("confusion", word.index, word.index + word[0].length, [
                  matchCase(word[0], "it’s"),
                ]);
              if (
                /^(?:its|their|your)$/i.test(word[0]) &&
                /^(?:been|gone)$/i.test(next[0])
              )
                // "Been" requires have/has, while "gone" also allows be.
                add("confusion", word.index, word.index + word[0].length, [
                  matchCase(
                    word[0],
                    /^their$/i.test(word[0])
                      ? /^been$/i.test(next[0])
                        ? "they’ve"
                        : "they’re"
                      : /^your$/i.test(word[0])
                        ? /^been$/i.test(next[0])
                          ? "you’ve"
                          : "you’re"
                        : "it’s",
                  ),
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
                  (/^(?:do|does|did|don't|doesn't|didn't)$/i.test(
                    previous[0],
                  ) ||
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
              adjacent(previous, word)
            )
              for (let k = i - 2; k >= 0 && k >= i - 5; k--) {
                if (!adjacent(words[k], words[k + 1])) break;
                if (objectPrepositions.test(words[k][0])) {
                  add("confusion", word.index, word.index + word[0].length, [
                    "me",
                  ]);
                  break;
                }
              }
          }
        },
        brackets: () => {
          const pairs: Record<string, string> = {
            "(": ")",
            "[": "]",
            "{": "}",
          };
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
        },
        quotes: () => {
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
              if (top?.char === char && /\n\s*$/.test(text.slice(0, i)))
                continue;
              stack.push({ char, at: i });
            } else add("quotes", i, i + 1);
          }
          for (const opening of stack)
            add("quotes", opening.at, opening.at + 1);
        },
      };
      for (const rule of writingRules) {
        if (settings.grammar && settings.rules[rule]) ruleChecks[rule]();
      }
      result.issues.sort((a, b) => a.from - b.from || a.to - b.to);
      return result;
    },
  };
}
