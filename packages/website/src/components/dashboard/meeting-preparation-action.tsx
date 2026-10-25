"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { CalendarCheck } from "lucide-react";
import type { SourceRef } from "@lib/shared/models";
import { deferredFeature } from "./deferred-feature";

export type MeetingScope =
  | { projectId: string; sources?: never }
  | { projectId: null; sources: SourceRef[] };
const MeetingPreparation = deferredFeature(
  async () => ({
    default: (await import("./meeting-preparation")).MeetingPreparation,
  }),
  "Opening meeting preparation…",
);

export function MeetingPreparationAction({
  scope,
  disabled,
  compact = false,
}: {
  scope: MeetingScope;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={compact ? "app-icon" : undefined}
        aria-label="Prepare for a meeting"
        title="Prepare for a meeting"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <CalendarCheck size={16} />
        {!compact && "Prepare for a meeting"}
      </button>
      {open &&
        createPortal(
          <MeetingPreparation scope={scope} close={() => setOpen(false)} />,
          document.querySelector(".grove-app") ?? document.body,
        )}
    </>
  );
}
