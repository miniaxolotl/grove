"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { memoryTitle } from "@/lib/memory-display";
import { NoteDragHandle } from "./memory-drag";
import { useWorkspaceCache } from "./workspace-cache";

export function NotebookPages({ projectId }: { projectId: string }) {
  const cache = useWorkspaceCache();
  const query = useInfiniteQuery(cache.notes({ projectId, limit: 8 }));
  const current = { page: query.data?.pages[0], failed: query.isError };
  return (
    <ul className="notebook-pages">
      {current?.page?.items.map((note) => (
        <li key={note.id}>
          <NoteDragHandle memory={note} />
          <Link href={`/app/memories/${note.id}`} title={memoryTitle(note)}>
            <FileText size={13} />
            <span>{memoryTitle(note)}</span>
          </Link>
        </li>
      ))}
      {current?.failed && (
        <li>
          <button className="text-button" onClick={() => void query.refetch()}>
            Retry notes
          </button>
        </li>
      )}
      {current?.page?.nextCursor && (
        <li>
          <Link href={`/app/projects/${projectId}`}>All notes</Link>
        </li>
      )}
      <li>
        <Link href={`/app/notes/new?notebook=${projectId}`}>
          <Plus size={13} />
          New note
        </Link>
      </li>
    </ul>
  );
}
