import {
  preferenceKeys,
  preferencesFor,
  type AccountPreferences,
  type PreferencesUpdate,
} from "@lib/shared/preferences";
import {
  defaultSpeechVoice,
  type SpeechVoiceId,
} from "@lib/shared/speech-voices";

/** Keep value settings separate from the boolean feature/consent switches. */
export type AccountSettings = AccountPreferences & {
  readAloudVoiceId: SpeechVoiceId;
};
export type SettingsUpdate = PreferencesUpdate &
  Partial<Pick<AccountSettings, "readAloudVoiceId">>;
export const settingsKeys = [...preferenceKeys, "readAloudVoiceId"] as const;
export function settingsFor(input: SettingsUpdate): AccountSettings {
  return {
    ...preferencesFor(input),
    readAloudVoiceId: input.readAloudVoiceId ?? defaultSpeechVoice,
  };
}
