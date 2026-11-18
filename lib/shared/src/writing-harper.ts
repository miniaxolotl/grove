import {
  LocalLinter,
  SuggestionKind,
  type BinaryModule,
  type Lint,
} from "harper.js";
import {
  dictionaryWordKey,
  type WritingIssue,
  type WritingResult,
  type WritingSettings,
} from "./writing-settings.ts";
import {
  profilePack,
  profileFamilies,
  abstain,
} from "./writing-harper-profile.ts";
import { harperInput } from "./writing-harper-input.ts";
import { noteWords } from "./writing-vocabulary.ts";

// Harper's built-in rule categories don't coincide with Grove's persisted
// switches (e.g. AnA is Miscellaneous and ModalOf is WordChoice).
function family(name: string, kind: string): WritingIssue["rule"] {
  const custom = profileFamilies.get(name);
  if (custom) return custom;
  if (name === "AnA" || name.includes("Article")) return "articles";
  if (name.includes("Quote")) return "quotes";
  if (/Bracket|Parenthes/.test(name)) return "brackets";
  if (name === "PluralDecades") return "plurals";
  if (name === "SimplePastToPastParticiple" || name === "ModalOf")
    return "agreement";
  if (kind === "Spelling" || kind === "Typo") return "spelling";
  if (kind === "Agreement") return "agreement";
  if (kind === "Formatting" || kind === "Punctuation") return "spacing";
  if (kind === "Capitalization") return "capitalization";
  if (kind === "Repetition") return "repetition";
  if (kind === "Redundancy" || kind === "Readability") return "redundancy";
  return "confusion";
}

function candidates(lint: Lint, original: string) {
  const suggestions = lint.suggestions();
  try {
    return [
      ...new Set(
        suggestions.map((s) => {
          const text = s.get_replacement_text();
          return s.kind() === SuggestionKind.InsertAfter
            ? original + text
            : text;
        }),
      ),
    ].filter((r) => r !== original && r.length <= 256);
  } finally {
    for (const suggestion of suggestions) suggestion.free();
  }
}

export async function createHarperChecker(binary: BinaryModule) {
  const linter = new LocalLinter({ binary });
  await linter.setup();
  await linter.importWords(noteWords());
  if (await linter.loadWeirpackFromBytes(profilePack()))
    throw new Error("Invalid local writing profile");
  await linter.setLintConfig({
    ...Object.fromEntries([...profileFamilies.keys()].map((k) => [k, true])),
    UseTitleCase: false,
  });
  const vocabulary = new Set(noteWords());
  return {
    async check(
      source: string,
      settings: WritingSettings,
    ): Promise<WritingResult> {
      const checkedTo = Math.min(source.length, 6000);
      const result: WritingResult = {
        language: "en",
        issues: [],
        complete: checkedTo === source.length,
        checkedTo,
      };
      if (!settings.enabled || (!settings.spelling && !settings.grammar))
        return result;
      const projection = harperInput(source.slice(0, checkedTo));
      const personal = new Set(settings.words.map(dictionaryWordKey));
      // Don't persist personal words in the worker's mutable dictionary;
      // removing one or switching sites/accounts takes effect on this request.
      const savedRanges = [
        ...source
          .slice(0, checkedTo)
          .matchAll(/[\p{L}\p{M}]+(?:['’‐‑-][\p{L}\p{M}]+)*/gu),
      ]
        .filter((m) => {
          const key = dictionaryWordKey(m[0]);
          return (
            personal.has(key) ||
            (key.endsWith("'s") && personal.has(key.slice(0, -2)))
          );
        })
        .map((m) => ({ from: m.index, to: m.index + m[0].length }));
      const groups = await linter.organizedLints(projection.text, {
        language: "markdown",
        dedup: false,
      });
      for (const [name, lints] of Object.entries(groups))
        for (const lint of lints) {
          const span = lint.span();
          try {
            let from = projection.offset(span.start);
            const to = projection.offset(span.end);
            if (
              from < 0 ||
              to <= from ||
              to > checkedTo ||
              (!result.complete && to === checkedTo)
            )
              continue;
            if (
              projection.protectedSpans.some((s) => from < s.to && to > s.from)
            )
              continue;
            if (
              projection.text.slice(span.start, span.end) !==
              lint.get_problem_text()
            )
              continue;
            // Outside a prepositional phrase Harper 3.2 tokenizes the plural
            // in “the 1990’s were” as an isolated misspelled s. Use its lint,
            // but offer only the apostrophe edit, never a word like “so”.
            const decade =
              name === "SpellCheck" &&
              source.slice(from, to) === "s" &&
              /\b\d{3}0['’]$/.test(source.slice(0, from)) &&
              /^\s+(?:are|were)\b/i.test(source.slice(to));
            if (decade) from--;
            const original = source.slice(from, to);
            const rule = decade ? "plurals" : family(name, lint.lint_kind());
            if (
              rule === "spelling"
                ? !settings.spelling
                : !settings.grammar || !settings.rules[rule]
            )
              continue;
            if (
              personal.has(dictionaryWordKey(original)) ||
              savedRanges.some((s) => from < s.to && to > s.from)
            )
              continue;
            if (name === "RepeatedWords" && /^(had|that)\s+\1$/i.test(original))
              continue;
            if (
              abstain(name, original, source.slice(0, from), source.slice(to))
            )
              continue;
            const replacements = decade
              ? ["s"]
              : candidates(lint, original).map((r) =>
                  original.includes("’") ||
                  /^(Their|Your|their|your)$/.test(original)
                    ? r.replaceAll("'", "’")
                    : r,
                );
            if (rule === "spelling") {
              const word = dictionaryWordKey(original);
              for (let k = 0; k + 1 < word.length; k++) {
                const swap =
                  word.slice(0, k) + word[k + 1] + word[k] + word.slice(k + 2);
                if (vocabulary.has(swap) && swap !== word)
                  replacements.unshift(
                    /^[A-Z]/.test(original)
                      ? swap[0].toUpperCase() + swap.slice(1)
                      : swap,
                  );
              }
            }
            // Preserve the correct first choice and Harper's split-word alternative.
            if (name === "SplitWords" && original.toLowerCase() === "befor")
              replacements.unshift(original[0] + "efore");
            result.issues.push({
              id: `${rule}:${from}:${to}`,
              rule,
              message: rule,
              from,
              to,
              original,
              replacements: [...new Set(replacements)]
                .filter((r) => !/\b(?:shit|fuck|cunt)\b/i.test(r))
                .slice(0, 3),
            });
          } finally {
            span.free();
            lint.free();
          }
        }
      result.issues.sort((a, b) => a.from - b.from || b.to - a.to);
      const distinct: WritingIssue[] = [];
      for (const issue of result.issues) {
        const prev = distinct.at(-1);
        if (prev && prev.to > issue.from) {
          if (
            prev.from === issue.from &&
            prev.to === issue.to &&
            prev.rule === issue.rule
          )
            prev.replacements = [
              ...new Set([...prev.replacements, ...issue.replacements]),
            ].slice(0, 3);
          continue;
        }
        if (distinct.length === 50) break;
        distinct.push(issue);
      }
      result.issues = distinct;
      return result;
    },
  };
}
