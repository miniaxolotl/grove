"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Wrench } from "lucide-react";
import type { WorkflowScope } from "@lib/shared/notebook-workflows";
import { deferredFeature } from "./deferred-feature";

const Tools = deferredFeature(
  async () => ({ default: (await import("./notebook-tools")).NotebookTools }),
  "Opening tools…",
);
export function ToolsAction({
  scope,
  compact = false,
  disabled = false,
}: {
  scope: WorkflowScope;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={compact ? "app-icon" : undefined}
        aria-label="Tools for these notes"
        title="Tools for these notes"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Wrench size={16} />
        {!compact && "Tools for these notes"}
      </button>
      {open &&
        createPortal(
          <Tools initialScope={scope} close={() => setOpen(false)} />,
          document.querySelector(".grove-app") ?? document.body,
        )}
    </>
  );
}
