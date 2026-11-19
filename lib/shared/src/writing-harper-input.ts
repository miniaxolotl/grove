import { projectWritingText } from "./writing-settings.ts";

/** Harper tokenizes NFC. Keep a boundary map back to the writer's (possibly
 * decomposed) source. A combining sequence must never be partially edited. */
export function harperInput(source: string) {
  const projected = projectWritingText(source);
  const units = projected.text.split("");
  for (const { from, to } of projected.protectedSpans) {
    // A placeholder separates the grammatical contexts on either side. Spaces
    // alone would turn "a `Retry` action" into "a action".
    units.fill("\uFFFC", from, to);
  }
  const masked = units
    .join("")
    .replace(/(?<=[\p{L}\d])’(?=[\p{L}])/gu, "'")
    .replace(/[‐‑]/g, "-");
  if (!/\p{M}|\b(?:[A-Z]\.){2}/u.test(masked))
    return { ...projected, text: masked, offset: (n: number) => n };
  let text = "";
  const boundaries = new Map<number, number>([[0, 0]]);
  for (const m of masked.matchAll(/\b(?:[A-Z]\.){2,}|\P{M}\p{M}*|\p{M}+/gu)) {
    if (m[0].length > 1 && m[0].endsWith(".")) {
      // Make the spoken abbreviation available to AnA without offering edits
      // that would remove the author's punctuation from the abbreviation.
      projected.protectedSpans.push({
        from: m.index,
        to: m.index + m[0].length,
      });
      text += m[0].replaceAll(".", "");
    } else text += m[0].normalize("NFC");
    boundaries.set(text.length, m.index + m[0].length);
  }
  return { ...projected, text, offset: (n: number) => boundaries.get(n) ?? -1 };
}
