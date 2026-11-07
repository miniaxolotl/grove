import {
  writingPatchSchema,
  writingSettingsSchema,
  type WritingPatch,
  type WritingSettings,
} from "@lib/shared/writing-settings";

export type { WritingPatch, WritingSettings };

/**
 * Device-local writing preferences for the webapp note editor (v1).
 *
 * The engine, rule IDs and defaults are the single shared source in
 * `@lib/shared/writing-core` — the same code the browser extension runs —
 * so both surfaces describe identical checks. Persistence is intentionally
 * local: the personal dictionary has no account store yet, so the extension
 * and the webapp keep independent word lists until a shared dictionary
 * lands. The settings UI says so plainly.
 */
export const NATIVE_WRITING_ATTRIBUTE = "data-grove-native-writing";

const STORAGE_KEY = "grove.writing.settings.v1";
export const WRITING_SETTINGS_EVENT = "grove:writing-settings";

export function defaultWritingSettings(): WritingSettings {
  return writingSettingsSchema.parse({});
}

/** Patch semantics without default inheritance: omitted fields keep saved opt-outs. */
function applyPatch(
  base: WritingSettings,
  patch: WritingPatch,
): WritingSettings {
  const next: WritingSettings = {
    ...base,
    rules: { ...base.rules },
    words: [...base.words],
  };
  if (patch.language !== undefined) next.language = patch.language;
  for (const key of [
    "enabled",
    "spelling",
    "grammar",
    "aiRewrites",
    "automatic",
    "highlights",
  ] as const)
    if (patch[key] !== undefined) next[key] = patch[key]!;
  if (patch.rules)
    for (const [rule, value] of Object.entries(patch.rules))
      if (value !== undefined)
        next.rules[rule as keyof typeof next.rules] = value;
  if (patch.words !== undefined) next.words = [...patch.words];
  return writingSettingsSchema.parse(next);
}

export function loadWritingSettings(): WritingSettings {
  const fallback = defaultWritingSettings();
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const patch = writingPatchSchema.parse(JSON.parse(raw));
    return applyPatch(fallback, patch);
  } catch {
    return fallback;
  }
}

export function saveWritingSettings(patch: WritingPatch): WritingSettings {
  const next = applyPatch(loadWritingSettings(), patch);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private browsing or quota: keep the in-memory result, stay usable.
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(WRITING_SETTINGS_EVENT));
  return next;
}

export function subscribeWritingSettings(
  listener: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(WRITING_SETTINGS_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(WRITING_SETTINGS_EVENT, listener);
  };
}
