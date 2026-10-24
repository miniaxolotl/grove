"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { type AiAvailability } from "@lib/shared/preferences";
import {
  settingsKeys,
  settingsFor,
  type AccountSettings,
  type SettingsUpdate,
} from "@lib/shared/account-settings";
import type { SpeechVoice } from "@lib/shared/speech-voices";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { useToast } from "./toasts";

type Settings = SettingsUpdate & {
  aiAvailability?: AiAvailability;
  speechAvailable?: { transcription: boolean; synthesis: boolean };
  speechVoices?: SpeechVoice[];
};
type Draft = { base: AccountSettings; value: AccountSettings };

function useEditor() {
  const cache = useWorkspaceCache();
  const path = usePathname();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const query = useQuery({
    ...cache.resource<Settings>("/me"),
    enabled: path === "/app/settings" || !!draft || busy,
  });
  const loaded = query.data ? settingsFor(query.data) : null;
  const value = draft?.value ?? loaded;
  const dirty =
    !!draft && settingsKeys.some((key) => draft.value[key] !== draft.base[key]);

  return {
    value,
    voices: query.data?.speechVoices,
    rememberedVoice: loaded?.readAloudVoiceId,
    availability: query.data?.aiAvailability
      ? {
          ...query.data.aiAvailability,
          transcription: query.data.speechAvailable?.transcription ?? false,
          synthesis: query.data.speechAvailable?.synthesis ?? false,
        }
      : undefined,
    busy,
    dirty,
    error,
    loadError: query.error ? errorMessage(query.error) : "",
    retry: () => void query.refetch(),
    edit(next: AccountSettings) {
      setError("");
      if (value)
        setDraft((current) => ({ base: current?.base ?? value, value: next }));
    },
    discard() {
      if (busy) return;
      setDraft(null);
      setError("");
    },
    async save() {
      if (!draft || busy || !dirty) return;
      const submitted = draft.value;
      const changed = Object.fromEntries(
        settingsKeys
          .filter((key) => submitted[key] !== draft.base[key])
          .map((key) => [key, submitted[key]]),
      );
      setBusy(true);
      setError("");
      try {
        const result = await cache.api<SettingsUpdate>(
          "/account/settings",
          changed,
          "PATCH",
        );
        const saved = settingsFor({ ...loaded, ...changed, ...result });
        setDraft((current) => {
          if (!current) return null;
          const newer = settingsKeys.filter(
            (key) =>
              current.value[key] !== submitted[key] &&
              current.value[key] !== saved[key],
          );
          return newer.length
            ? {
                base: saved,
                value: {
                  ...saved,
                  ...Object.fromEntries(
                    newer.map((key) => [key, current.value[key]]),
                  ),
                },
              }
            : null;
        });
        toast("Preferences saved.");
      } catch (cause) {
        setError(errorMessage(cause));
        toast(errorMessage(cause), true);
      } finally {
        setBusy(false);
      }
    },
  };
}

const Context = createContext<ReturnType<typeof useEditor> | null>(null);

/** The settings layout retains drafts and in-flight saves while switching tabs. */
export function PreferenceEditor({ children }: { children: ReactNode }) {
  const editor = useEditor();
  return <Context.Provider value={editor}>{children}</Context.Provider>;
}

export function usePreferenceEditor() {
  const editor = useContext(Context);
  if (!editor) throw new Error("Preferences need the settings layout");
  return editor;
}
