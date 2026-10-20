"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Memory } from "@lib/shared/contracts";
import { api, errorMessage } from "@/lib/dashboard-api";
import { MemoryEditor } from "./memory-editor";
import { LoadError } from "./load-error";
import { useNotebooks } from "./notebooks-provider";

export function NoteEditorPage({
  id,
  notebook,
  journal = false,
}: {
  id?: string;
  notebook?: string;
  journal?: boolean;
}) {
  const router = useRouter();
  const { projects, loading, error, reload } = useNotebooks();
  const key = id
    ? `note:${id}`
    : `new:${journal ? "journal" : notebook || "personal"}`;
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    memory?: Memory;
    error?: string;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    (id
      ? api<Memory>(`/memories/${id}`, undefined, undefined, controller.signal)
      : Promise.resolve(undefined)
    )
      .then((memory) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            memory,
          });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ key, error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [id, notebook, key, refresh]);
  const current = result?.key === key ? result : undefined;
  const unavailable =
    !loading && notebook && !projects.some((project) => project.id === notebook)
      ? "This notebook is no longer available. Return to Notes to choose another."
      : "";
  if (current?.error || error || unavailable)
    return (
      <LoadError
        message={current?.error || error || unavailable}
        retry={() => {
          reload();
          setRefresh((value) => value + 1);
        }}
      />
    );
  if (!current || loading)
    return (
      <p className="library-loading" role="status">
        Opening your writing space…
      </p>
    );
  return (
    <MemoryEditor
      key={key}
      fullPage
      draftKey={key}
      memory={current.memory}
      projects={projects}
      projectId={notebook ?? null}
      personal={journal}
      initialContent={
        journal
          ? `# ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}\n\n`
          : ""
      }
      cancel={() =>
        router.push(
          journal
            ? "/app/journal"
            : current.memory?.projectId || notebook
              ? `/app/projects/${current.memory?.projectId || notebook}`
              : "/app",
        )
      }
      done={(memory) => {
        if (!id)
          router.replace(
            `/app/memories/${memory.id}/edit${journal ? "?from=journal" : ""}`,
          );
        else
          setResult((result) =>
            result?.key === key ? { ...result, memory } : result,
          );
      }}
    />
  );
}
