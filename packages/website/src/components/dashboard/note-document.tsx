"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MemoryInspector } from "./memory-inspector";
import { useNotebooks } from "./notebooks-provider";
import { LoadError } from "./load-error";

/** The shared route layout keeps one document alive through its first save. */
export function NoteDocument({ children }: { children: ReactNode }) {
  const path = usePathname();
  const query = useSearchParams();
  const router = useRouter();
  const { projects, loading, error, reload } = useNotebooks();
  const creating = path === "/app/notes/new";
  const notebook = query.get("notebook") || undefined;
  const journal = query.get("from") === "journal";
  const id = creating ? undefined : path.split("/")[3];
  const route = creating
    ? `new:${journal ? `journal${notebook ? `:${notebook}` : ""}` : notebook || "personal"}`
    : `note:${id}`;
  const [session, setSession] = useState({ route, key: 0, adopted: "" });
  if (session.route !== route) {
    setSession({
      route,
      key: session.adopted === route ? session.key : session.key + 1,
      adopted: "",
    });
  }
  const revision = Number(query.get("revision"));
  if (Number.isInteger(revision) && revision > 0 && revision <= 2147483647)
    return children;
  if (creating) {
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
        <p className="library-loading" role="status">
          Opening your writing space…
        </p>
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
              initialContent: journal
                ? `# ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}\n\n`
                : "",
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
