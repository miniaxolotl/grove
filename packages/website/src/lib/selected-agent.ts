"use client";

import { useSyncExternalStore } from "react";
import { clientOptions } from "@/content/install";

const choices = clientOptions.map((option) => option.value);
const key = "grove.selected-agent";
let transient: string | undefined;
function selected() {
  if (transient) return transient;
  try {
    const value = window.localStorage.getItem(key);
    return value && choices.includes(value) ? value : "opencode";
  } catch {
    return "opencode";
  }
}
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(key, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(key, notify);
  };
}
export function useSelectedAgent() {
  const value = useSyncExternalStore(subscribe, selected, () => "opencode");
  return [
    value,
    (next: string) => {
      if (!choices.includes(next)) return;
      try {
        window.localStorage.setItem(key, next);
        transient = undefined;
      } catch {
        /* Selection still works without storage. */
        transient = next;
      }
      window.dispatchEvent(new Event(key));
    },
  ] as const;
}
