"use client";

import Link from "next/link";
import { FilePlus2, Plus, Pencil, FolderInput } from "lucide-react";
import type { Project } from "@/lib/dashboard-api";
import type { NotebookAction } from "./notebook-dialog";
import { IconButton } from "./ui/button";

/** Common creation/organization order across notebook menus and Manage. */
export function NotebookActions({
  project,
  onAction,
  compact = false,
}: {
  project: Project;
  onAction: (action: NotebookAction) => void;
  compact?: boolean;
}) {
  const actions = [
    {
      label: "New sub-notebook",
      compactLabel: `Add sub-notebook to ${project.name}`,
      icon: Plus,
      action: { mode: "create", parentId: project.id } as const,
    },
    {
      label: "Rename notebook",
      compactLabel: `Rename ${project.name}`,
      icon: Pencil,
      action: { mode: "rename", project } as const,
    },
    {
      label: "Move notebook",
      compactLabel: `Move ${project.name}`,
      icon: FolderInput,
      action: { mode: "move", project } as const,
    },
  ];
  return (
    <>
      {!compact && (
        <Link href={`/app/notes/new?notebook=${project.id}`}>
          <FilePlus2 size={15} />
          New note
        </Link>
      )}
      {actions.map(({ label, compactLabel, icon: Icon, action }, index) =>
        compact ? (
          <IconButton
            key={label}
            label={compactLabel}
            onClick={() => onAction(action)}
          >
            <Icon size={16} />
          </IconButton>
        ) : (
          <button
            key={label}
            type="button"
            className={index === 1 ? "action-group-start" : undefined}
            onClick={() => onAction(action)}
          >
            <Icon size={15} />
            {label}
          </button>
        ),
      )}
    </>
  );
}
