"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import type { Brief } from "@lib/shared/models";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { LoadError } from "./load-error";
import { dateLabel } from "@/lib/memory-display";
import { IconButton } from "./ui/button";

export function BriefPanel({
  projectId = null,
  taskId,
}: {
  projectId?: string | null;
  taskId?: string;
}) {
  const cache = useWorkspaceCache();
  const api = cache.api;
  const [saveError, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(0);
  const options = cache.resource<Brief>("/briefs", { projectId, taskId });
  const query = useQuery({
    ...options,
    refetchInterval: (query) => {
      if (query.state.data?.status !== "pending") {
        started.current = 0;
        return false;
      }
      started.current ||= Date.now();
      return Date.now() - started.current < 30_000 ? 3000 : false;
    },
  });
  const brief = query.data;
  const error = saveError || (query.error ? errorMessage(query.error) : "");
  const check = () => {
    started.current = 0;
    void query.refetch();
  };
  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      if (brief?.status !== "pending")
        await api<Brief>("/briefs/refresh", { projectId, taskId });
      started.current = 0;
      await query.refetch();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const sources = [
    ...new Set(
      brief?.content?.sections.flatMap((section) =>
        section.statements.flatMap((statement) =>
          statement.sources.map((source) => source.id),
        ),
      ) ?? [],
    ),
  ];
  return (
    <section className="brief-document">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="font-editorial text-2xl">
          {taskId
            ? "Where you left off"
            : projectId
              ? "Notebook summary"
              : "A little about you"}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted" role="status">
            {brief?.status === "ready"
              ? "Up to date"
              : brief?.status === "pending"
                ? "Updating"
                : brief?.status === "failed"
                  ? "Needs attention"
                  : ""}
          </span>
          {brief && brief.status !== "disabled" && (
            <IconButton
              label={
                brief.status === "pending" ? "Check status" : "Refresh summary"
              }
              disabled={busy}
              aria-busy={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} />
            </IconButton>
          )}
        </div>
      </div>
      {error && (
        <LoadError
          message={error}
          retry={() => {
            setError("");
            check();
          }}
        />
      )}
      {!brief && !error && (
        <p className="mt-4 text-sm text-muted" role="status">
          Opening your summary…
        </p>
      )}
      {brief?.status === "disabled" ? (
        <p className="mt-4 text-sm leading-7 text-muted">
          This summary is unavailable. Check your{" "}
          <Link className="underline" href="/app/settings">
            AI preferences
          </Link>
          .
        </p>
      ) : brief?.content ? (
        <>
          <p className="mt-6 font-medium">{brief.content.title}</p>
          {brief.content.sections.map((section, i) => (
            <div className="brief-section" key={i}>
              <h3 className="text-sm font-semibold">{section.heading}</h3>
              <ul className="mt-3 space-y-4">
                {section.statements.map((statement, j) => (
                  <li key={j} className="text-sm leading-7">
                    <p>{statement.text}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted">
                      {statement.sources.map((source) => (
                        <Link
                          key={`${source.id}:${source.version}`}
                          className="underline"
                          href={`/app/memories/${source.id}?revision=${source.version}`}
                        >
                          Source {sources.indexOf(source.id) + 1} · revision{" "}
                          {source.version}
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="mt-6 text-xs leading-6 text-muted">
            {brief.coverage
              ? `${brief.coverage.examined} of ${brief.coverage.total} notes examined · ${brief.coverage.cited} cited`
              : `Based on ${brief.sourceCount} current ${brief.sourceCount === 1 ? "note" : "notes"}`}
            {brief.updatedAt ? ` · ${dateLabel(brief.updatedAt)}` : ""}
            {brief.truncated ? " · Partial coverage" : ""}
          </p>
        </>
      ) : (
        brief && (
          <p role="status" className="mt-4 text-sm text-muted">
            {brief.status === "failed"
              ? "This summary couldn’t be updated. Please try again."
              : "Updating this summary. You can keep working."}
          </p>
        )
      )}
    </section>
  );
}
