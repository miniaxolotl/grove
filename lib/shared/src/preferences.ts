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
export type LegacyPreferences = {
  organizeEnabled?: boolean;
  summariesEnabled?: boolean;
};
export type PreferencesUpdate = Partial<AccountPreferences> & LegacyPreferences;

/** Legacy API clients can still read/write their original grouped switches. */
export function preferencesFor(input: PreferencesUpdate): AccountPreferences {
  return {
    titlesTagsEnabled: input.titlesTagsEnabled ?? input.organizeEnabled ?? true,
    classificationEnabled:
      input.classificationEnabled ?? input.organizeEnabled ?? true,
    noteConnectionsEnabled:
      input.noteConnectionsEnabled ?? input.organizeEnabled ?? true,
    notebookConnectionsEnabled:
      input.notebookConnectionsEnabled ?? input.organizeEnabled ?? true,
    notebookSummariesEnabled:
      input.notebookSummariesEnabled ?? input.summariesEnabled ?? true,
    personalSummaryEnabled:
      input.personalSummaryEnabled ?? input.summariesEnabled ?? true,
    progressSummariesEnabled:
      input.progressSummariesEnabled ?? input.summariesEnabled ?? true,
    askEnabled: input.askEnabled ?? input.summariesEnabled ?? true,
    recallEnabled: input.recallEnabled ?? true,
    captureEnabled: input.captureEnabled ?? true,
  };
}

export function preferencePatch(input: PreferencesUpdate) {
  const patch: Partial<AccountPreferences> = {};
  if (input.organizeEnabled !== undefined)
    for (const key of organizationPreferences)
      patch[key] = input.organizeEnabled;
  if (input.summariesEnabled !== undefined)
    for (const key of [...summaryPreferences, "askEnabled"] as const)
      patch[key] = input.summariesEnabled;
  for (const key of preferenceKeys)
    if (input[key] !== undefined) patch[key] = input[key];
  return patch;
}

export const legacyPreferences = (preferences: AccountPreferences) => ({
  organizeEnabled: organizationPreferences.some((key) => preferences[key]),
  summariesEnabled: [...summaryPreferences, "askEnabled" as const].some(
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
