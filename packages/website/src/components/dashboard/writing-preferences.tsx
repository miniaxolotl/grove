"use client";

import { useEffect, useState } from "react";
import { writingRules, type WritingRule } from "@lib/shared/writing-settings";
import {
  loadWritingSettings,
  saveWritingSettings,
  subscribeWritingSettings,
  type WritingSettings,
} from "@/lib/writing/settings";

const ruleLabels: Record<WritingRule, { label: string; description: string }> = {
  brackets: { label: "Matching brackets", description: "Flag unmatched or misnested brackets." },
  quotes: { label: "Matching quotes", description: "Flag unmatched quotation marks." },
  articles: { label: "A / an", description: "Suggest the article that matches the next word’s sound." },
  repetition: { label: "Repeated words", description: "Flag accidental duplicates like “the the”." },
  spacing: { label: "Spacing", description: "Flag extra spaces and missing spaces after punctuation." },
  capitalization: { label: "Sentence capitalization", description: "Suggest capitals at sentence starts and for standalone “I”." },
  redundancy: { label: "Wordy phrases", description: "Suggest shorter forms of unambiguous wordy phrases." },
  agreement: { label: "Verb agreement", description: "Flag verb forms that don’t match their subject." },
  plurals: { label: "Acronym plurals", description: "Plural acronyms don’t need an apostrophe." },
  confusion: { label: "Common mix-ups", description: "Flag wording that is a common mix-up." },
};

function Row({
  id,
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="ai-preference" key={id}>
      <span className="ai-preference-copy">
        <span className="ai-preference-label">
          <span id={`${id}-label`}>{label}</span>
        </span>
        <span id={`${id}-description`} className="ai-preference-description">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        name={id}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

/**
 * Settings → Preferences → Writing. Device-local v1: the same checks as the
 * browser extension, independent word list until a shared dictionary lands.
 */
export function WritingPreferences() {
  const [settings, setSettings] = useState<WritingSettings>(() =>
    loadWritingSettings(),
  );
  const [advanced, setAdvanced] = useState(false);
  const [newWord, setNewWord] = useState("");
  const [wordError, setWordError] = useState("");

  useEffect(
    () => subscribeWritingSettings(() => setSettings(loadWritingSettings())),
    [],
  );

  const update = (
    patch: Parameters<typeof saveWritingSettings>[0],
  ) => setSettings(saveWritingSettings(patch));

  const addWord = () => {
    const clean = newWord.trim();
    if (!clean) return;
    if (
      settings.words.some(
        (entry) => entry.toLocaleLowerCase("en") === clean.toLocaleLowerCase("en"),
      )
    ) {
      setWordError("That word is already in your dictionary.");
      return;
    }
    try {
      update({ words: [...settings.words, clean] });
      setNewWord("");
      setWordError("");
    } catch {
      setWordError("Use letters with optional apostrophes, up to 80 characters.");
    }
  };

  return (
    <section className="app-panel ai-preferences-panel" aria-labelledby="writing-heading">
      <div className="settings-panel-heading">
        <h2 id="writing-heading">Writing</h2>
      </div>
      <p className="settings-panel-description">
        Spelling and basic grammar checks run on your device as you write. No
        typing-time network calls. Changes apply immediately and stay on this
        device.
      </p>
      <fieldset className="ai-preference-group">
        <legend>
          <h3>Checks</h3>
        </legend>
        <Row
          id="writing-enabled"
          label="Writing assistance"
          description="Master switch for webapp checks. Off stops everything here."
          checked={settings.enabled}
          onChange={(enabled) => update({ enabled })}
        />
        <Row
          id="writing-spelling"
          label="Spelling"
          description="Dictionary lookup, spelling underlines and suggestions."
          checked={settings.spelling}
          onChange={(spelling) => update({ spelling })}
        />
        <Row
          id="writing-grammar"
          label="Basic grammar"
          description="Deterministic local rules. Each rule can be switched below."
          checked={settings.grammar}
          onChange={(grammar) => update({ grammar })}
        />
        <Row
          id="writing-automatic"
          label="Check as I type"
          description="Check after a typing pause. Off keeps explicit checks only."
          checked={settings.automatic}
          onChange={(automatic) => update({ automatic })}
        />
        <Row
          id="writing-highlights"
          label="Inline highlights"
          description="Underline issues in the note. Off keeps the accessible issue list."
          checked={settings.highlights}
          onChange={(highlights) => update({ highlights })}
        />
      </fieldset>
      <div className="ai-preference-group">
        <button
          type="button"
          className="text-button"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? "Hide advanced rules" : "Show advanced rules"}
        </button>
        {advanced && (
          <fieldset className="ai-preference-group">
            <legend>
              <h3>Grammar rules</h3>
            </legend>
            {writingRules.map((rule) => (
              <Row
                key={rule}
                id={`writing-rule-${rule}`}
                label={ruleLabels[rule].label}
                description={ruleLabels[rule].description}
                checked={settings.grammar && settings.rules[rule]}
                disabled={!settings.grammar}
                onChange={(checked) =>
                  update({ rules: { [rule]: checked } })
                }
              />
            ))}
          </fieldset>
        )}
      </div>
      <fieldset className="ai-preference-group">
        <legend>
          <h3>Personal dictionary</h3>
        </legend>
        <p className="ai-preference-description">
          Names, brands and terms this device won’t flag. This list is separate
          from the browser extension’s dictionary.
        </p>
        {settings.words.length > 0 ? (
          <ul className="grove-writing-words">
            {settings.words.map((word) => (
              <li key={word}>
                <span>{word}</span>
                <button
                  type="button"
                  className="text-button"
                  aria-label={`Remove ${word} from dictionary`}
                  onClick={() =>
                    update({
                      words: settings.words.filter((entry) => entry !== word),
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ai-preference-description">No added words yet.</p>
        )}
        <div className="grove-writing-add-word">
          <input
            type="text"
            aria-label="Add a word to the dictionary"
            placeholder="Add a word"
            value={newWord}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setNewWord(event.target.value);
              setWordError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addWord();
              }
            }}
          />
          <button type="button" onClick={addWord}>
            Add word
          </button>
        </div>
        {wordError ? (
          <p className="app-error" role="alert">
            {wordError}
          </p>
        ) : null}
        {settings.words.length > 0 && (
          <button
            type="button"
            className="text-button"
            onClick={() => update({ words: [] })}
          >
            Clear dictionary
          </button>
        )}
      </fieldset>
      <p className="ai-preference-description">
        Sentence rewrites with AI alternatives live in the browser extension,
        which asks for your consent before sending anything. The webapp never
        sends what you type for checking.
      </p>
    </section>
  );
}
