import nspell from "nspell";

// Common count nouns in reading lists and project notes. Use the pinned
// dictionary's `checklist` model for plurals and possessives; unrelated
// compounds and verb forms remain subject to the ordinary dictionary.
const noteNouns = [
  "audiobook",
  "backlink",
  "handoff",
  "livestream",
  "permalink",
  "roadmap",
  "screenshot", // upstream has the plural, but omits the possessive
  "subtask",
  "walkthrough",
  "watchlist",
  "wishlist",
];

export function createNoteDictionary(dictionary: { aff: string; dic: string }) {
  const spell = nspell(dictionary);
  for (const noun of noteNouns) spell.add(noun, "checklist");
  return spell;
}
