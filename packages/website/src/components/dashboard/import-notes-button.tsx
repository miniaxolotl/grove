"use client";
import { useState } from "react";
import { Upload } from "lucide-react";
import { deferredFeature } from "./deferred-feature";
import { Dialog } from "./dialog";

export const ImportNotesPanel = deferredFeature(
  async () => ({
    default: (await import("./import-notes-panel")).ImportNotesPanel,
  }),
  "Opening import…",
  { failureTitle: "Import couldn’t open" },
);
export function ImportNotesButton({ projectId }: { projectId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="app-button secondary"
        onClick={() => setOpen(true)}
      >
        <Upload size={16} />
        Import notes
      </button>
      {open && (
        <Dialog title="Import notes" close={() => setOpen(false)}>
          <ImportNotesPanel projectId={projectId} />
        </Dialog>
      )}
    </>
  );
}
