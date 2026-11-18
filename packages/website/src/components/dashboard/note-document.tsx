"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { localDateSchema, type DailyNote } from "@lib/shared/contracts";
import { errorMessage } from "@/lib/dashboard-api";
import { RecoveryState } from "@/components/recovery-state";
import { MemoryInspector } from "./memory-inspector";
import { useNotebooks } from "./notebooks-provider";
import { LoadError } from "./load-error";
import { DocumentSkeleton } from "./workspace-opening";
import { useWorkspaceApi } from "./workspace-cache";

function localCalendarDate() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, i) => String(part).padStart(i === 0 ? 4 : 2, "0"))
    .join("-");
}

function dailyHeading(date: string) {
  return `# ${new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })}\n\n`;
}

/** The shared route layout keeps one document alive through its first save. */
export function NoteDocument({ children }: { children: ReactNode }) {
  const path = usePathname();
  const query = useSearchParams();
  const router = useRouter();
  const api = useWorkspaceApi();
  const { projects, loading, error, reload } = useNotebooks();
  const creating = path === "/app/notes/new";
  const notebook = query.get("notebook") || undefined;
  const journal = query.get("from") === "journal";
  const daily = creating && journal;
  const requestedDate = daily ? query.get("date") : null;
  const day =
    requestedDate && localDateSchema.safeParse(requestedDate).success
      ? requestedDate
      : undefined;
  const id = creating ? undefined : path.split("/")[3];
  const route = creating
    ? `new:${daily ? `daily:${day ?? "opening"}` : notebook || "personal"}`
    : `note:${id}`;
  const [session, setSession] = useState({ route, key: 0, adopted: "" });
  if (session.route !== route) {
    setSession({
      route,
      key: session.adopted === route ? session.key : session.key + 1,
      adopted: "",
    });
  }
  // Snapshot the browser's local day at entry. Even a reload of an open draft
  // after midnight keeps that draft on its original day.
  useEffect(() => {
    if (!daily || day) return;
    const params = new URLSearchParams({ from: "journal" });
    if (notebook) params.set("notebook", notebook);
    params.set("date", localCalendarDate());
    router.replace(`/app/notes/new?${params}`, { scroll: false });
  }, [daily, day, notebook, router]);
  const lookup = useQuery({
    queryKey: ["daily-note-opening", day, session.key],
    queryFn: ({ signal }) =>
      api<DailyNote>(`/memories/daily/${day}`, undefined, undefined, signal),
    enabled: !!day,
    gcTime: 0,
    // The result is a snapshot for this opening. Never replace a mounted draft
    // with another tab's save; its create operation will report the conflict.
    staleTime: Infinity,
    retry: false,
  });
  const savedId = lookup.data?.state === "saved" ? lookup.data.id : undefined;
  useEffect(() => {
    if (day && savedId)
      router.replace(
        `/app/memories/${encodeURIComponent(savedId)}?mode=edit&from=journal`,
        { scroll: false },
      );
  }, [day, savedId, router]);
  const revision = Number(query.get("revision"));
  if (Number.isInteger(revision) && revision > 0 && revision <= 2147483647)
    return children;
  if (creating) {
    if (daily) {
      if (lookup.error)
        return (
          <LoadError
            title="Couldn’t open the daily note"
            message={errorMessage(lookup.error)}
            retry={() => void lookup.refetch()}
          />
        );
      if (lookup.data?.state === "deleted")
        return (
          <div className="note-document">
            <RecoveryState
              compact
              title="This daily note was deleted"
              description="The date stays reserved, so a second daily note won’t replace it."
              actions={
                <Link className="app-button secondary" href="/app">
                  Back to notes
                </Link>
              }
            />
          </div>
        );
      if (!day || lookup.data?.state !== "empty")
        return (
          <div className="note-document">
            <DocumentSkeleton label="Opening the daily note…" />
          </div>
        );
    }
    const unavailable =
      !loading && notebook && !projects.some((item) => item.id === notebook);
    if (error || unavailable)
      return (
        <LoadError
          message={
            error ||
            "This notebook is no longer available. Return to Notes to choose another."
          }
          retry={reload}
        />
      );
    if (loading)
      return (
        <div className="note-document">
          <DocumentSkeleton label="Opening your writing space…" />
        </div>
      );
  }
  return (
    <MemoryInspector
      key={session.key}
      fullPage
      id={id}
      journal={journal}
      initialPreview={
        !creating && !path.endsWith("/edit") && query.get("mode") !== "edit"
      }
      creation={
        creating
          ? {
              draftKey: route,
              projectId: notebook,
              initialContent: day ? dailyHeading(day) : "",
              dailyDate: day,
            }
          : undefined
      }
      onCreated={(memory, view) => {
        setSession((current) => ({ ...current, adopted: `note:${memory.id}` }));
        router.replace(
          `/app/memories/${memory.id}?mode=${view?.preview ? "preview" : "edit"}${journal ? "&from=journal" : ""}`,
          { scroll: false },
        );
      }}
    />
  );
}
