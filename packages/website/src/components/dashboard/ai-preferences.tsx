import type { AiAvailability, PreferenceKey } from "@lib/shared/preferences";
import type { AccountSettings } from "@lib/shared/account-settings";
import type { SpeechVoice, SpeechVoiceId } from "@lib/shared/speech-voices";
import { VoiceSelector } from "./voice-selector";

const groups: {
  title: string;
  features: {
    key: PreferenceKey;
    label: string;
    description: string;
    provider?: keyof AiAvailability;
  }[];
}[] = [
  {
    title: "Organization",
    features: [
      {
        key: "titlesTagsEnabled",
        label: "Titles and tags",
        description: "Create short titles and topic tags for your notes.",
        provider: "generation",
      },
      {
        key: "classificationEnabled",
        label: "Note classification",
        description:
          "Suggest a note type. Apply it only when you let Grove choose the note type.",
        provider: "classification",
      },
      {
        key: "filingEnabled",
        label: "Suggested filing",
        description: "Suggest a notebook when you ask where a note belongs.",
        provider: "generation",
      },
    ],
  },
  {
    title: "Connections",
    features: [
      {
        key: "noteConnectionsEnabled",
        label: "Linked notes",
        description: "Find related, overlapping, or conflicting notes.",
        provider: "generation",
      },
      {
        key: "notebookConnectionsEnabled",
        label: "Connected notebooks",
        description: "Find shared themes across notebooks.",
        provider: "generation",
      },
      {
        key: "cleanupEnabled",
        label: "Guided cleanup",
        description:
          "Review duplicate or conflicting notes and choose what to keep.",
        provider: "generation",
      },
    ],
  },
  {
    title: "Summaries",
    features: [
      {
        key: "notebookSummariesEnabled",
        label: "Notebook summaries",
        description: "Summarize the notes in each notebook.",
        provider: "generation",
      },
      {
        key: "personalSummaryEnabled",
        label: "Personal summary",
        description: "Summarize your saved preferences and facts in About you.",
        provider: "generation",
      },
      {
        key: "progressSummariesEnabled",
        label: "Progress summaries",
        description:
          "Summarize task handoffs so connected agents can pick up where you left off.",
        provider: "generation",
      },
      {
        key: "digestsEnabled",
        label: "Change digests",
        description:
          "Summarize what changed since your last notebook visit, on request.",
        provider: "generation",
      },
    ],
  },
  {
    title: "Ask Grove",
    features: [
      {
        key: "askEnabled",
        label: "Answers and writing",
        description:
          "Answer questions and draft changes using your notes. Review changes before applying.",
        provider: "generation",
      },
      {
        key: "actionListsEnabled",
        label: "Action lists",
        description: "Find action items in selected notes when you ask.",
        provider: "generation",
      },
    ],
  },
  {
    title: "Connected agents",
    features: [
      {
        key: "recallEnabled",
        label: "Automatic recall",
        description:
          "Let connected agents find useful notes when starting work.",
      },
      {
        key: "captureEnabled",
        label: "Automatic capture",
        description:
          "Let connected agents save confirmed details as they work.",
      },
    ],
  },
  {
    title: "Speech",
    features: [
      {
        key: "transcriptionEnabled",
        label: "Recording transcription",
        description:
          "Process a recording only when you choose Transcribe. Review the suggested text before saving.",
        provider: "transcription",
      },
      {
        key: "readAloudEnabled",
        label: "Read aloud",
        description:
          "Use saved note text to create spoken audio when you ask. Audio expires within a day.",
        provider: "synthesis",
      },
    ],
  },
];

export function AiPreferences({
  value,
  availability,
  onChange,
  voices,
  rememberedVoice,
}: {
  value: AccountSettings;
  availability?: AiAvailability;
  onChange: (value: AccountSettings) => void;
  voices?: SpeechVoice[];
  rememberedVoice?: SpeechVoiceId;
}) {
  return groups.map(({ title, features }) => (
    <fieldset className="ai-preference-group" key={title}>
      <legend>
        <h3>{title}</h3>
      </legend>
      {features.map(({ key, label, description, provider }) => (
        <label className="ai-preference" key={key}>
          <span className="ai-preference-copy">
            <span className="ai-preference-label">
              <span id={`${key}-label`}>{label}</span>
              {provider && availability?.[provider] === false && (
                <span className="settings-badge" aria-hidden="true">
                  Unavailable
                </span>
              )}
            </span>
            <span
              id={`${key}-description`}
              className="ai-preference-description"
            >
              {description}
              {provider && availability?.[provider] === false && (
                <span className="sr-only">
                  {" "}
                  Currently unavailable. Your choice will be saved.
                </span>
              )}
            </span>
          </span>
          <input
            type="checkbox"
            name={key}
            aria-labelledby={`${key}-label`}
            aria-describedby={`${key}-description`}
            checked={value[key]}
            onChange={(event) =>
              onChange({ ...value, [key]: event.target.checked })
            }
          />
        </label>
      ))}
      {title === "Speech" && (
        <VoiceSelector
          value={value.readAloudVoiceId}
          voices={voices}
          remembered={rememberedVoice}
          onChange={(readAloudVoiceId) =>
            onChange({ ...value, readAloudVoiceId })
          }
        />
      )}
    </fieldset>
  ));
}
