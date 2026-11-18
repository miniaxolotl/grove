import nspell from "nspell";
import { fieldVocabulary } from "./writing-field-vocabulary.ts";

// nspell copies the flags from a model word in the shipped en.dic. Keep
// mass nouns, adjectives and verbs out of the default count-noun pattern.
type AffixModel = "checklist" | "hardware" | "film" | "ignore" | undefined;
const noteVocabulary: ReadonlyArray<{
  model: AffixModel;
  words: readonly string[];
}> = [
  {
    model: "checklist", // MS: regular plurals and singular possessives
    words: [
      "artboard",
      "audiobook",
      "backlink",
      "booklist",
      "changelog",
      "codebase",
      "cutscene",
      "daypack",
      "ebook",
      "endnote",
      "ereader",
      "filmography",
      "frittata",
      "handoff",
      "hostname",
      "linter",
      "mixtape",
      "mockup",
      "permalink",
      "playdate",
      "roadmap",
      "screenshot", // upstream has the plural, but omits the possessive
      "showrunner",
      "staycation",
      "stovetop",
      "stylesheet",
      "subtask",
      "timesheet",
      "toolchain",
      "tooltip",
      "viewport",
      "voiceover",
      "walkthrough",
      "watchlist",
      "webcomic",
      "webhook",
      "wishlist",
      "zester",
    ],
  },
  {
    model: "hardware", // M: possessive only; docuseries is its own plural
    words: [
      "autopay",
      "docuseries",
      "fanfiction",
      "farro",
      "gochujang",
      "grayscale",
      "kerning",
      "kimchi",
      "middleware",
      "miso",
      "tahini",
      "tempeh",
      "worldbuilding",
    ],
  },
  {
    model: "film", // MDGS: used both as count nouns and regular verbs
    words: ["livestream", "rewatch", "timebox", "wireframe"],
  },
  {
    model: "ignore", // GDS: present, past and -ing without a possessive
    words: ["declutter"],
  },
  {
    model: undefined, // exact forms; no inherited suffixes
    words: ["draggable", "monospaced", "scrollable", "weeklong"],
  },
];

export function createNoteDictionary(dictionary: { aff: string; dic: string }) {
  const spell = nspell(dictionary);
  for (const { words, model } of noteVocabulary) {
    for (const word of words) spell.add(word, model);
  }
  for (const { nouns, exact } of Object.values(fieldVocabulary)) {
    for (const word of nouns.split(" ")) spell.add(word, "checklist");
    for (const word of exact.split(" ")) spell.add(word);
  }
  return spell;
}
