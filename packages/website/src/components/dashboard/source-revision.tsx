"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { SourceRevision as Revision } from "@lib/shared/models";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { Markdown } from "./markdown";
import { LoadError } from "./load-error";

export function SourceRevision({
  id,
  version,
}: {
  id: string;
  version: number;
}) {
  const cache = useWorkspaceCache();
  const query = useQuery({
    ...cache.resource<Revision | null>(`/memories/${id}/revisions/${version}`),
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (state) =>
      state.state.data?.expiresAt
        ? Math.max(
            1000,
            Math.min(
              60000,
              Date.parse(state.state.data.expiresAt) - Date.now(),
            ),
          )
        : false,
  });
  const revision = query.data;
  return (
    <article className="note-document">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-editorial text-2xl">Source · revision {version}</h1>
        <Link href={`/app/memories/${id}`} className="text-button">
          Open current note
        </Link>
      </header>
      {query.error ? (
        <LoadError
          message={errorMessage(query.error)}
          retry={() => void query.refetch()}
        />
      ) : revision === null ? (
        <p role="status">This source is no longer available.</p>
      ) : !revision ? (
        <p role="status">Opening source…</p>
      ) : (
        <>
          {revision.currentVersion !== version && (
            <p className="mt-4 text-sm text-muted">
              Current note: revision {revision.currentVersion}
            </p>
          )}
          <div className="mt-6">
            <Markdown>{revision.content}</Markdown>
          </div>
        </>
      )}
    </article>
  );
}
