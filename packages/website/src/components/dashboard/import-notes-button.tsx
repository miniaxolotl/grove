"use client";
import { useState } from "react";
import { Upload } from "lucide-react";
import { deferredFeature } from "./deferred-feature";
import { Dialog } from "./dialog";
import { Button } from "./ui/button";

export const ImportNotesPanel = deferredFeature(
  async () => ({
    default: (await import("./import-notes-panel")).ImportNotesPanel,
  }),
  "Opening import…",
  { failureTitle: "Import couldn’t open" },
);
export function ImportNotesButton({
  projectId,
  primary = false,
}: {
  projectId?: string;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={primary ? "primary" : "secondary"}
        onClick={() => setOpen(true)}
      >
        <Upload size={16} aria-hidden="true" />
        Import notes
      </Button>
      {open && (
        <Dialog title="Import notes" close={() => setOpen(false)}>
          <ImportNotesPanel projectId={projectId} />
        </Dialog>
      )}
    </>
  );
}
