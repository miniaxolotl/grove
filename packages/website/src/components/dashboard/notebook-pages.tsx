"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import type { Memory, Page } from "@lib/shared/contracts";
import { api } from "@/lib/dashboard-api";
import { memoryTitle } from "@/lib/memory-display";
import { NoteDragHandle, useWorkspaceDrag } from "./memory-drag";

export function NotebookPages({ projectId }: { projectId: string }) {
  const { revision } = useWorkspaceDrag();
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    page?: Page<Memory>;
    failed?: boolean;
  }>();
  const key = `${projectId}:${revision}:${refresh}`;
  useEffect(() => {
    const controller = new AbortController();
    void api<Page<Memory>>(
      "/memories/search",
      { projectId, status: "active", sort: "updated_desc", limit: 8 },
      undefined,
      controller.signal,
    )
      .then((page) => {
        if (!controller.signal.aborted) setResult({ key, page });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, failed: true });
      });
    return () => controller.abort();
  }, [projectId, key]);
  const current = result?.key === key ? result : undefined;
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
          <button
            className="text-button"
            onClick={() => setRefresh((n) => n + 1)}
          >
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
