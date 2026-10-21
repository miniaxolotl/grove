"use client";

import { useRouter } from "next/navigation";
import { MemoryEditor } from "./memory-editor";
import { LoadError } from "./load-error";
import { useNotebooks } from "./notebooks-provider";

export function NoteEditorPage({
  notebook,
  journal = false,
}: {
  notebook?: string;
  journal?: boolean;
}) {
  const router = useRouter();
  const { projects, loading, error, reload } = useNotebooks();
  const key = `new:${journal ? `journal${notebook ? `:${notebook}` : ""}` : notebook || "personal"}`;
  const unavailable =
    !loading && notebook && !projects.some((project) => project.id === notebook)
      ? "This notebook is no longer available. Return to Notes to choose another."
      : "";
  if (error || unavailable)
    return <LoadError message={error || unavailable} retry={reload} />;
  if (loading)
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
      projects={projects}
      projectId={notebook ?? null}
      initialContent={
        journal
          ? `# ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}\n\n`
          : ""
      }
      cancel={() =>
        router.push(
          notebook
            ? `/app/projects/${notebook}`
            : journal
              ? "/app?sort=created_desc"
              : "/app",
        )
      }
      done={(memory) => {
        router.replace(
          `/app/memories/${memory.id}?mode=edit${journal ? "&from=journal" : ""}`,
          { scroll: false },
        );
      }}
    />
  );
}
