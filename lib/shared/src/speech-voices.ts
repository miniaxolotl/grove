/** Public voice identities. Provider IDs and credentials belong to the server. */
export const miniMaxTtsFlagKey = "minimax-tts-enabled";
export const speechVoiceIds = ["reed", "willow", "cedar", "brook"] as const;
export type SpeechVoiceId = (typeof speechVoiceIds)[number];
export const defaultSpeechVoice: SpeechVoiceId = "reed";
export const speechVoices = [
  { id: "reed", name: "Reed", description: "Clear and even", basic: true },
  {
    id: "willow",
    name: "Willow",
    description: "Gentle and calm",
    basic: false,
  },
  {
    id: "cedar",
    name: "Cedar",
    description: "Deep and grounded",
    basic: false,
  },
  {
    id: "brook",
    name: "Brook",
    description: "Bright and lively",
    basic: false,
  },
] as const;
export type SpeechVoice = {
  id: SpeechVoiceId;
  name: string;
  description: string;
  basic: boolean;
  available: boolean;
  sampleId?: string;
};
export function isSpeechVoice(value: unknown): value is SpeechVoiceId {
  return speechVoiceIds.some((id) => id === value);
}
