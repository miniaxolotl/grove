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
        <span className="text-xs text-muted">
          {brief?.status === "ready"
            ? "Up to date"
            : brief?.status === "pending"
              ? "Updating"
              : brief?.status === "failed"
                ? "Needs attention"
                : ""}
        </span>
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
          Summaries are turned off. You can enable them in Settings.
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
                          href={`/app/memories/${source.id}`}
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
            Based on {brief.sourceCount} current{" "}
            {brief.sourceCount === 1 ? "note" : "notes"}
            {brief.updatedAt ? ` · ${dateLabel(brief.updatedAt)}` : ""}.
            {brief.truncated
              ? " This summary covers your most recent notes."
              : ""}{" "}
            Review the linked sources for context.
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
      {brief && brief.status !== "disabled" && (
        <div className="mt-5 flex flex-wrap gap-3">
          {brief.status !== "ready" && (
            <button
              className="app-button secondary"
              disabled={busy}
              onClick={() => {
                setError("");
                check();
              }}
            >
              Check status
            </button>
          )}
          <button
            className="app-button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api<Brief>("/briefs/refresh", { projectId, taskId });
                check();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={14} />
            {busy ? "Updating…" : "Refresh summary"}
          </button>
        </div>
      )}
    </section>
  );
}
