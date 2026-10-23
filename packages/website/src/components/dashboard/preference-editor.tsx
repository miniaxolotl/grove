"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  preferenceKeys,
  preferencesFor,
  type AccountPreferences,
  type AiAvailability,
  type PreferencesUpdate,
} from "@lib/shared/preferences";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { useToast } from "./toasts";

type Settings = PreferencesUpdate & {
  aiAvailability?: AiAvailability;
  speechAvailable?: { transcription: boolean; synthesis: boolean };
};
type Draft = { base: AccountPreferences; value: AccountPreferences };

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
  const loaded = query.data ? preferencesFor(query.data) : null;
  const value = draft?.value ?? loaded;
  const dirty =
    !!draft &&
    preferenceKeys.some((key) => draft.value[key] !== draft.base[key]);

  return {
    value,
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
    edit(next: AccountPreferences) {
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
        preferenceKeys
          .filter((key) => submitted[key] !== draft.base[key])
          .map((key) => [key, submitted[key]]),
      );
      setBusy(true);
      setError("");
      try {
        const result = await cache.api<PreferencesUpdate>(
          "/account/settings",
          changed,
          "PATCH",
        );
        const saved = preferencesFor({ ...loaded, ...changed, ...result });
        setDraft((current) => {
          if (!current) return null;
          const newer = preferenceKeys.filter(
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
