"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ModelSettings } from "@lib/shared/models";
import { AiPreferences } from "./ai-preferences";
import { LoadError } from "./load-error";
import { usePreferenceEditor } from "./preference-editor";
import { SettingsSaveRow } from "./settings-save-row";
import { WritingPreferences } from "./writing-preferences";
import { useWorkspaceCache } from "./workspace-cache";

export function PreferencesPanel() {
  return (
    <div className="settings-content settings-writing">
      <WritingPreferences />
    </div>
  );
}

export function AiPreferencesPanel() {
  const editor = usePreferenceEditor();
  const cache = useWorkspaceCache();
  const models = useQuery(cache.resource<ModelSettings>("/models"));
  const unavailable =
    editor.availability &&
    Object.values(editor.availability).some((available) => !available);
  return (
    <div className="settings-content settings-ai">
      <div>
        <h2 className="settings-section-heading">AI &amp; search</h2>
        <p className="settings-section-description">
          Choose how Grove uses AI for your account.
        </p>
      </div>
      <section
        className="ai-preferences-panel"
        aria-label="Account AI preferences"
      >
        {unavailable && (
          <p className="settings-note mb-3">
            You can still save choices for unavailable features.
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
              onChange={editor.edit}
            />
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
      <section
        className="settings-search-status"
        aria-labelledby="settings-search-heading"
      >
        <h3 id="settings-search-heading">Note search</h3>
        <p className="text-sm text-muted">
          {models.error
            ? "Search availability couldn’t load."
            : models.data?.config
              ? models.data.config.embedding.provider === "disabled"
                ? "Keyword search is available."
                : "Meaning search is configured. Each search reports whether it used meaning or keyword fallback."
              : "Checking search availability…"}
        </p>
        {models.error && (
          <button
            type="button"
            className="text-button"
            onClick={() => void models.refetch()}
          >
            Retry search availability
          </button>
        )}
        {models.data?.editable && (
          <Link className="text-button" href="/app/settings/models/providers">
            Manage model providers
          </Link>
        )}
      </section>
    </div>
  );
}
