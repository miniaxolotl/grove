"use client";

import Link from "next/link";
import {
  FilePlus2,
  Plus,
  Pencil,
  FolderInput,
  Share2,
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import type { Project } from "@/lib/dashboard-api";
import type { NotebookAction } from "./notebook-dialog";
import { IconButton } from "./ui/button";
import { ActionMenu } from "./ui/action-menu";
import { useNotebooks } from "./notebooks-provider";

/** Common creation/organization order across notebook menus and Manage. */
export function NotebookActions({
  project,
  onAction,
  onShare,
  compact = false,
}: {
  project: Project;
  onAction: (action: NotebookAction) => void;
  onShare?: () => void;
  compact?: boolean;
}) {
  const notebooks = useNotebooks();
  const lifecycle = (
    <>
      <Link href={`/app/settings/files?projectId=${project.id}`}>
        <FolderInput size={15} /> Files &amp; storage
      </Link>
      <button
        type="button"
        className="action-group-start"
        onClick={() =>
          onAction({
            mode: project.status === "archived" ? "restore" : "archive",
            project,
          })
        }
      >
        {project.status === "archived" ? (
          <ArchiveRestore size={15} />
        ) : (
          <Archive size={15} />
        )}
        {project.status === "archived"
          ? "Restore notebook"
          : "Archive notebook"}
      </button>
      <button
        type="button"
        className="danger action-group-start"
        onClick={() => onAction({ mode: "delete", project })}
      >
        <Trash2 size={15} /> Delete notebook…
      </button>
    </>
  );
  if (project.status === "archived") return lifecycle;
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
      {onShare &&
        (compact ? (
          <IconButton label={`Share ${project.name}`} onClick={onShare}>
            <Share2 size={16} />
          </IconButton>
        ) : (
          <button type="button" onClick={onShare}>
            <Share2 size={15} /> Share notebook
          </button>
        ))}
      {!compact && (
        <button
          type="button"
          onClick={() => notebooks.openOrganizer(project.id)}
        >
          <FolderInput size={15} />
          Rearrange notebook
        </button>
      )}
      {compact ? (
        <ActionMenu label={`More actions for ${project.name}`}>
          {lifecycle}
        </ActionMenu>
      ) : (
        lifecycle
      )}
    </>
  );
}
