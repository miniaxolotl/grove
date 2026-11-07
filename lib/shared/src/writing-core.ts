import nspell from "nspell";
import {
  agreementForms,
  articleFor,
  confusedPhrases,
  determiners,
  matchCase,
  objectPrepositions,
  phraseSuggestions,
  prose,
  wordyPhrases,
  writingSettingsSchema,
  type WritingIssue,
  type WritingResult,
  type WritingRule,
  type WritingSettings,
} from "./writing-settings.ts";

export * from "./writing-settings.ts";

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
        const ranked: string[] = [];
        const seen = new Set<string>();
        // Deterministic generators first: each only fires when its output is
        // a real dictionary word, so they cannot invent suggestions.
        const consider = (candidate: string) => {
          const key = candidate.toLocaleLowerCase("en");
          if (
            candidate !== word &&
            ranked.length < 3 &&
            !seen.has(key) &&
            correct(candidate)
          ) {
            seen.add(key);
            ranked.push(matchCase(word, candidate));
          }
        };
        // Missing apostrophes in contractions ("dont" → "don't") outrank
        // transpositions: a valid apostrophe form is almost always the intent.
        for (let index = 1; index < word.length; index++)
          consider(`${word.slice(0, index)}'${word.slice(index)}`);
        // Adjacent transpositions: nspell can bury the obvious keyboard swap
        // ("teh" → "the") below unrelated single-edits.
        for (let index = 0; index + 1 < word.length; index++)
          consider(
            word.slice(0, index) +
              word[index + 1] +
              word[index] +
              word.slice(index + 2),
          );
        // Dropped doubled letters ("refered" → "referred").
        for (let index = 0; index < word.length; index++)
          consider(
            word.slice(0, index + 1) + word[index] + word.slice(index + 1),
          );
        for (const candidate of spell.suggest(word)) {
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
        // Bare verb forms that can be correct after an operator or in a
        // mandative clause. Derived from the singular-subject table so the
        // two stay in sync: inflected forms ("goes") are never skipped.
        const bareForms = new Set(
          Object.keys(agreementForms.he).filter(
            (form) => !/^(?:are|am|were|don't)$/.test(form),
          ),
        );
        const operators =
          /^(?:do|does|did|will|would|shall|should|can|could|may|might|must)$/;
        const mandatives =
          /^(?:suggest|suggests|insist|insists|demand|demands|require|requires|recommend|recommends|propose|proposes|request|requests|ask|asks|prefer|prefers)$/;
        for (let i = 0; i + 1 < words.length; i++) {
          const current = words[i],
            next = words[i + 1];
          if (!between(current, next)) continue;
          const previous =
            i > 0 &&
            /^\s+$/.test(
              text.slice(words[i - 1].index + words[i - 1][0].length, current.index),
            )
              ? words[i - 1][0].toLowerCase()
              : "";
          const beforePrevious =
            i > 1 &&
            previous &&
            /^\s+$/.test(
              text.slice(
                words[i - 2].index + words[i - 2][0].length,
                words[i - 1].index,
              ),
            )
              ? words[i - 2][0].toLowerCase()
              : "";
          // Inverted questions put the operator before the pronoun, and only
          // bare forms can be correct there: "does he have", "will she come".
          if (
            operators.test(previous) &&
            bareForms.has(next[0].toLowerCase())
          )
            continue;
          // Mandative subjunctive takes the base form: "I suggest he go".
          const subject = current[0].toLowerCase();
          if (
            (subject === "he" || subject === "she" || subject === "it") &&
            (mandatives.test(previous) ||
              (previous === "that" && mandatives.test(beforePrevious)))
          )
            continue;
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
              /^(?:its|their|your)$/i.test(word[0]) &&
              /^(?:been|gone)$/i.test(next[0])
            )
              // Participles cannot follow a possessive: "its been" is it's,
              // "their gone" is they're, "your gone" is you're.
              add("confusion", word.index, word.index + word[0].length, [
                matchCase(
                  word[0],
                  /^their$/i.test(word[0])
                    ? "they’re"
                    : /^your$/i.test(word[0])
                      ? "you’re"
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
