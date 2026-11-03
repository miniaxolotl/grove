"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  FolderSearch,
  ListTodo,
  History,
  ScanSearch,
  CalendarCheck,
} from "lucide-react";
import type { AssistanceRequest } from "@lib/shared/assistance";
import { deferredFeature } from "./deferred-feature";

const AssistancePanel = deferredFeature(
  async () => ({
    default: (await import("./assistance-panel")).AssistancePanel,
  }),
  "Opening preview…",
);
export type AssistanceInput = AssistanceRequest extends infer T
  ? T extends AssistanceRequest
    ? "scope" extends keyof T
      ? never
      : Omit<T, "id">
    : never
  : never;
const icons = {
  filing: FolderSearch,
  actions: ListTodo,
  digest: History,
  cleanup: ScanSearch,
  meeting: CalendarCheck,
};
const labels = {
  filing: "Suggest a notebook",
  actions: "Extract action list",
  digest: "Since your last visit",
  cleanup: "Review notebook",
  meeting: "Prepare for a meeting",
};
export function AssistanceAction({
  input,
  disabled,
  compact = false,
}: {
  input: AssistanceInput;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [request, setRequest] = useState<AssistanceRequest | null>(null);
  const Icon = icons[input.kind],
    label = labels[input.kind];
  return (
    <>
      <button
        type="button"
        className={compact ? "app-icon" : undefined}
        disabled={disabled}
        aria-label={label}
        title={label}
        onClick={() => setRequest({ ...input, id: crypto.randomUUID() })}
      >
        <Icon size={16} />
        {!compact && label}
      </button>
      {request &&
        createPortal(
          <AssistancePanel initial={request} close={() => setRequest(null)} />,
          document.querySelector(".grove-app") ?? document.body,
        )}
    </>
  );
}
