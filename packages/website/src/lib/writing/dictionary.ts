/**
 * Lazily fetched English dictionary for local proofing.
 *
 * Same pinned `dictionary-en` data the browser extension bundles, served from
 * this origin as static assets. Fetched once on the first eligible edit —
 * never during sign-in, search or boot — then cached in memory. Local checks
 * never transmit prose anywhere; this fetch carries no user content.
 */
export type EnglishDictionary = { aff: string; dic: string };

let pending: Promise<EnglishDictionary> | null = null;

async function fetchText(path: string): Promise<string> {
  const response = await fetch(path, { cache: "force-cache" });
  if (!response.ok)
    throw new Error("The spelling dictionary isn’t available. Try again.");
  return response.text();
}

function loadEnglishDictionary(): Promise<EnglishDictionary> {
  if (!pending) {
    pending = Promise.all([
      fetchText("/dictionaries/en.aff"),
      fetchText("/dictionaries/en.dic"),
    ])
      .then(([aff, dic]) => ({ aff, dic }))
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}

// Share the static assets, not a caller's cancellation or the checker's
// suggestion cache, which can contain words from the current editor.
export async function loadWritingChecker() {
  const [{ createEnglishChecker }, dictionary] = await Promise.all([
    import("@lib/shared/writing-core"),
    loadEnglishDictionary(),
  ]);
  return createEnglishChecker(dictionary);
}
