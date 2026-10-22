/** Dependency-free account preferences shared by the API, worker and website. */
export const organizationPreferences = [
  "titlesTagsEnabled",
  "classificationEnabled",
  "noteConnectionsEnabled",
  "notebookConnectionsEnabled",
] as const;
export const summaryPreferences = [
  "notebookSummariesEnabled",
  "personalSummaryEnabled",
  "progressSummariesEnabled",
] as const;
export const preferenceKeys = [
  ...organizationPreferences,
  ...summaryPreferences,
  "askEnabled",
  "recallEnabled",
  "captureEnabled",
] as const;
export type PreferenceKey = (typeof preferenceKeys)[number];
export type AccountPreferences = Record<PreferenceKey, boolean>;
export type AiAvailability = { classification: boolean; generation: boolean };
const legacyGroups = {
  organizeEnabled: organizationPreferences,
  summariesEnabled: [...summaryPreferences, "askEnabled"],
} as const;
export type LegacyPreferences = Partial<
  Record<keyof typeof legacyGroups, boolean>
>;
export type PreferencesUpdate = Partial<AccountPreferences> & LegacyPreferences;
const defaults = Object.fromEntries(
  preferenceKeys.map((key) => [key, true]),
) as AccountPreferences;

/** Legacy API clients can still read/write their original grouped switches. */
export function preferencesFor(input: PreferencesUpdate): AccountPreferences {
  return { ...defaults, ...preferencePatch(input) };
}

export function preferencePatch(input: PreferencesUpdate) {
  const patch: Partial<AccountPreferences> = {};
  for (const group of ["organizeEnabled", "summariesEnabled"] as const) {
    const value = input[group];
    if (value !== undefined)
      for (const key of legacyGroups[group]) patch[key] = value;
  }
  for (const key of preferenceKeys)
    if (input[key] !== undefined) patch[key] = input[key];
  return patch;
}

export const legacyPreferences = (preferences: AccountPreferences) => ({
  organizeEnabled: legacyGroups.organizeEnabled.some((key) => preferences[key]),
  summariesEnabled: legacyGroups.summariesEnabled.some(
    (key) => preferences[key],
  ),
});

export const briefPreference = (scope: {
  projectId?: string | null;
  taskId?: string;
}): PreferenceKey =>
  scope.taskId
    ? "progressSummariesEnabled"
    : scope.projectId
      ? "notebookSummariesEnabled"
      : "personalSummaryEnabled";

export const connectionPreference = (level: "note" | "notebook") =>
  level === "note" ? "noteConnectionsEnabled" : "notebookConnectionsEnabled";

export const jobPreferences = {
  decision: "classificationEnabled",
  organization: "titlesTagsEnabled",
  relationship_scan: "noteConnectionsEnabled",
  note_relationship: "noteConnectionsEnabled",
  notebook_profile: "notebookConnectionsEnabled",
  notebook_relationship: "notebookConnectionsEnabled",
} as const satisfies Record<string, PreferenceKey>;

export function processingEnabled(
  preferences: AccountPreferences,
  kind: "embedding" | "brief" | keyof typeof jobPreferences,
  scope?: { projectId?: string | null; taskId?: string } | null,
) {
  return kind === "embedding"
    ? true
    : preferences[
        kind === "brief" ? briefPreference(scope ?? {}) : jobPreferences[kind]
      ];
}
