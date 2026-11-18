import { fieldVocabulary } from "./writing-field-vocabulary.ts";

/** Supplement Harper's dictionary with the inflected forms used in notes. */
export function noteWords() {
  const nouns =
    "artboard audiobook backlink booklist café changelog codebase cutscene daypack ebook endnote ereader façade fiancé fiancée filmography frittata handoff hostname jalapeño linter mixtape mockup permalink playdate résumé roadmap screenshot showrunner staycation stovetop stylesheet subtask timesheet toolchain tooltip viewport voiceover walkthrough watchlist webcomic webhook wishlist zester livestream rewatch timebox wireframe".split(
      " ",
    );
  const mass =
    "autopay docuseries fanfiction farro gochujang grayscale kerning kimchi middleware miso tahini tempeh worldbuilding".split(
      " ",
    );
  const words =
    "livestreamed livestreaming rewatched rewatching timeboxed timeboxing wireframed wireframing declutter declutters decluttered decluttering naïve naïver naïvest naïvely draggable geotagged geotagging monospaced scrollable weeklong".split(
      " ",
    );
  for (const field of Object.values(fieldVocabulary)) {
    nouns.push(...field.nouns.split(" "));
    words.push(...field.exact.split(" "));
  }
  for (const word of nouns)
    words.push(
      /[^aeiou]y$/.test(word)
        ? word.slice(0, -1) + "ies"
        : word + (/(?:s|ch|sh|x|z)$/.test(word) ? "es" : "s"),
    );
  for (const word of [...mass, ...nouns]) words.push(word, word + "'s");
  return [...new Set(words)];
}
