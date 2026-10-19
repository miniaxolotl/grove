"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Brief } from "@lib/shared/models";
import { api, errorMessage } from "@/lib/dashboard-api";
import { LoadError } from "./load-error";

export function BriefPanel({
  projectId = null,
  taskId,
}: {
  projectId?: string | null;
  taskId?: string;
}) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<Brief>("/briefs", { projectId, taskId }, undefined, controller.signal)
      .then(setBrief)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [projectId, taskId, check]);
  return (
    <section className="app-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="font-editorial text-2xl">
          {taskId
            ? "Task handoff"
            : projectId
              ? "Project brief"
              : "Personal profile"}
        </h2>
        <span className="text-xs capitalize text-muted">{brief?.status}</span>
      </div>
      {error && (
        <LoadError
          message={error}
          retry={() => {
            setError("");
            setCheck((n) => n + 1);
          }}
        />
      )}
      {!brief && !error && (
        <p className="mt-4 text-sm text-muted" role="status">
          Loading context…
        </p>
      )}
      {brief?.status === "disabled" ? (
        <p className="mt-4 text-sm leading-7 text-muted">
          Enable summaries in Settings and configure a generation model to build
          source-linked context.
        </p>
      ) : brief?.content ? (
        <>
          <p className="mt-6 font-medium">{brief.content.title}</p>
          {brief.content.sections.map((section, i) => (
            <div className="mt-6" key={i}>
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
                          Source {source.id.slice(0, 8)} · revision{" "}
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
            Generated from {brief.sourceCount} current memories
            {brief.updatedAt
              ? ` · ${new Date(brief.updatedAt).toLocaleString()}`
              : ""}
            .
            {brief.truncated
              ? " This brief covers a bounded selection of recent memories."
              : ""}{" "}
            Review the linked sources for context.
          </p>
        </>
      ) : (
        brief && (
          <p role="status" className="mt-4 text-sm text-muted">
            {brief.status === "failed"
              ? "Generation failed. Retry when the provider is available."
              : "Context is queued for background processing."}
          </p>
        )
      )}
      {brief && brief.status !== "disabled" && (
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="app-button secondary"
            disabled={busy}
            onClick={() => {
              setError("");
              setCheck((n) => n + 1);
            }}
          >
            Check status
          </button>
          <button
            className="app-button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setBrief(
                  await api<Brief>("/briefs/refresh", { projectId, taskId }),
                );
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Queuing…" : "Regenerate"}
          </button>
        </div>
      )}
    </section>
  );
}
