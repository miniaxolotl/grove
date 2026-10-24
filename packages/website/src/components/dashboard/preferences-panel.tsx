"use client";

import Link from "next/link";
import { AiPreferences } from "./ai-preferences";
import { LoadError } from "./load-error";
import { usePreferenceEditor } from "./preference-editor";
import { SettingsSaveRow } from "./settings-save-row";

export function PreferencesPanel() {
  const editor = usePreferenceEditor();
  const unavailable =
    editor.availability &&
    Object.values(editor.availability).some((available) => !available);
  return (
    <div className="settings-content">
      <section className="app-panel ai-preferences-panel">
        <div className="settings-panel-heading">
          <h2>AI preferences</h2>
          <Link className="text-button" href="/app/settings/models">
            AI availability
          </Link>
        </div>
        <p className="settings-panel-description">
          Choose how Grove helps with your notes.
        </p>
        {unavailable && (
          <p className="settings-note">
            You can save choices for unavailable features, too.
          </p>
        )}
        {editor.value ? (
          <form
            className="app-form ai-preferences-form"
            onSubmit={(event) => {
              event.preventDefault();
              void editor.save();
            }}
          >
            <AiPreferences
              value={editor.value}
              availability={editor.availability}
              voices={editor.voices}
              rememberedVoice={editor.rememberedVoice}
              onChange={editor.edit}
            />
            <p className="text-xs leading-6 text-muted">
              Connected agents only use the notebooks and permissions you’ve
              approved. Changes take effect when you save.
            </p>
            <SettingsSaveRow
              label="Save preferences"
              dirty={editor.dirty}
              busy={editor.busy}
              error={editor.error}
              onDiscard={editor.discard}
            />
          </form>
        ) : editor.loadError ? (
          <LoadError
            title="Your preferences couldn’t load"
            message={editor.loadError}
            retry={editor.retry}
          />
        ) : (
          <p className="settings-loading mt-4" role="status">
            Loading preferences…
          </p>
        )}
        {editor.value && editor.loadError && (
          <p className="settings-refresh-error" role="status">
            Couldn’t refresh preferences. Your edits are kept.{" "}
            <button
              type="button"
              className="text-button"
              onClick={editor.retry}
            >
              Retry
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
