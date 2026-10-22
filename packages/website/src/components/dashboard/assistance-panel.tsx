"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Check, RefreshCw, Undo2 } from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import type {
  Assistance,
  AssistanceApply,
  AssistanceRequest,
  CleanupCandidate,
} from "@lib/shared/assistance";
import type { SummaryEvidence } from "@lib/shared/summaries";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { Dialog } from "./dialog";
import { LoadError } from "./load-error";
import { Button, IconButton } from "./ui/button";
import { RevisionCompare } from "./revision-compare";

const titles = {
  filing: "Suggested notebook",
  actions: "Action list",
  cleanup: "Review notebook",
  digest: "Since your last visit",
};
export function SourceEvidence({ sources }: { sources: SummaryEvidence[] }) {
  return (
    <details className="connection-support">
      <summary>Sources</summary>
      <div className="connection-evidence">
        <section className="col-span-full">
          {sources.map((source, index) => (
            <figure key={`${source.id}:${source.version}:${index}`}>
              <figcaption>
                <Link
                  href={`/app/memories/${source.id}?revision=${source.version}`}
                >
                  Revision {source.version}
                </Link>
              </figcaption>
              <blockquote>{source.quote}</blockquote>
            </figure>
          ))}
        </section>
      </div>
    </details>
  );
}

export function AssistancePanel({
  initial,
  close,
}: {
  initial: AssistanceRequest;
  close: () => void;
}) {
  const cache = useWorkspaceCache();
  const [request, setRequest] = useState(initial);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [showKept, setShowKept] = useState(false);
  const operation = useRef<{
    id: string;
    input: AssistanceApply;
    undo: boolean;
  } | null>(null);
  const path = `/assistance/${request.id}`;
  const query = useQuery({
    ...cache.resource<Assistance | null>(path),
    enabled: started,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 1500 : false),
  });
  const result = query.data,
    ready = result?.status === "ready";
  const setResult = (value: Assistance) =>
    cache.client.setQueryData(cache.resource(path).queryKey, value);
  useEffect(() => {
    if (!result?.expiresAt || result.status !== "ready") return;
    const timer = setTimeout(
      () => {
        const key = cache.resource(path).queryKey;
        void cache.client.cancelQueries({ queryKey: key, exact: true });
        cache.client.setQueryData(key, {
          ...result,
          result: null,
          status: "stale",
          error: "Sources expired. Refresh the preview.",
        });
        void cache.client.invalidateQueries({ queryKey: key, exact: true });
      },
      Math.min(
        2_147_483_647,
        Math.max(0, Date.parse(result.expiresAt) - Date.now()),
      ),
    );
    return () => clearTimeout(timer);
  }, [cache, path, result]);
  useEffect(() => {
    const controller = new AbortController();
    void cache
      .api<Assistance>("/assistance", request, "POST", controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          cache.client.setQueryData(cache.resource(path).queryKey, value);
          setStarted(true);
          setError("");
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [cache, request, path]);
  async function refresh(after?: string) {
    setBusy(true);
    setError("");
    try {
      let next = { ...request, id: crypto.randomUUID() };
      if ("sources" in next)
        next = {
          ...next,
          sources: await Promise.all(
            next.sources.map(async (ref) => {
              const note = await cache.api<Memory>(`/memories/${ref.id}`);
              return { id: note.id, version: note.version };
            }),
          ),
        };
      if (next.kind === "digest" && after) next = { ...next, after };
      setStarted(false);
      setEdits({});
      operation.current = null;
      setRequest(next);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function apply(
    candidate?: CleanupCandidate,
    action?: "combine" | "update",
    undo = false,
  ) {
    if (!result) return;
    setBusy(true);
    setError("");
    const previous = operation.current;
    const input: AssistanceApply =
      previous?.id === result.id && previous.undo === undo
        ? previous.input
        : {
            expectedVersion: result.version,
            ...(candidate ? { candidate: candidate.key, action } : {}),
            ...(request.kind === "actions" && !undo
              ? {
                  edits: Object.entries(edits).map(([index, text]) => ({
                    index: Number(index),
                    text,
                  })),
                }
              : {}),
          };
    operation.current = { id: result.id, input, undo };
    try {
      setResult(
        await cache.api<Assistance>(
          `${path}/${undo ? "undo" : "apply"}`,
          input,
        ),
      );
      operation.current = null;
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function review(candidate: CleanupCandidate, dismissed: boolean) {
    setBusy(true);
    setError("");
    try {
      setResult(
        await cache.api<Assistance>(`${path}/review`, {
          candidate: candidate.key,
          expectedVersion: candidate.reviewVersion,
          dismissed,
        }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={titles[request.kind]} close={close} busy={busy}>
      <div className="assistance-panel app-form">
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="text-sm text-muted">
            {!started || result?.status === "pending"
              ? `Checking notes${result?.progress ? ` · ${result.progress}` : ""}…`
              : result?.status === "applied"
                ? "Applied"
                : result?.status === "undone"
                  ? "Undone"
                  : result?.result
                    ? `${result.result.coverage.examined} of ${result.result.coverage.total} ${request.kind === "filing" ? "notebooks" : "notes"} examined`
                    : (result?.error ?? "Preview unavailable")}
          </p>
          <IconButton
            label="Refresh preview"
            disabled={busy || result?.status === "pending"}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
          </IconButton>
        </div>
        {(error || query.error) && (
          <LoadError
            message={error || errorMessage(query.error)}
            retry={() => {
              if (!started) setRequest({ ...request });
              else void query.refetch();
            }}
          />
        )}
        {result?.status === "applied" && (
          <div className="app-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void apply(undefined, undefined, true)}
            >
              <Undo2 size={16} />
              Undo
            </Button>
            {result.applied[0] && (
              <Link
                className="text-button"
                href={`/app/memories/${result.applied[0].id}`}
              >
                Open note
              </Link>
            )}
          </div>
        )}
        {ready && result.result?.filing && (
          <>
            {result.result.filing.destination.length ? (
              <>
                <h3 className="text-lg font-semibold">
                  {result.result.filing.name}
                </h3>
                <p>{result.result.filing.reason}</p>
                <SourceEvidence sources={result.result.filing.evidence} />
                <Button disabled={busy} onClick={() => void apply()}>
                  <Check size={16} />
                  Move here
                </Button>
              </>
            ) : (
              <p>No clear match.</p>
            )}
          </>
        )}
        {ready && result.result?.items && (
          <>
            {!result.result.items.length && <p>No recorded actions found.</p>}
            {result.result.items.map((item, index) => (
              <section key={index} className="border-b pb-4">
                <textarea
                  rows={2}
                  className="app-input w-full"
                  aria-label={`Action ${index + 1}`}
                  maxLength={240}
                  disabled={busy}
                  value={edits[index] ?? item.text}
                  onChange={(event) => {
                    operation.current = null;
                    setEdits({ ...edits, [index]: event.target.value });
                  }}
                />
                {edits[index] !== undefined && edits[index] !== item.text && (
                  <span className="text-xs text-muted">Edited</span>
                )}
                <SourceEvidence sources={item.sources} />
              </section>
            ))}
            {!!result.result.items.length && (
              <Button
                disabled={
                  busy || Object.values(edits).some((text) => !text.trim())
                }
                onClick={() => void apply()}
              >
                Save action list
              </Button>
            )}
          </>
        )}
        {ready && result.result?.candidates && (
          <>
            {!result.result.candidates.some((c) => !c.dismissed) && (
              <p>No further changes to review.</p>
            )}
            {result.result.candidates.some((c) => c.dismissed) && (
              <button
                className="text-button"
                onClick={() => setShowKept(!showKept)}
              >
                {showKept ? "Hide kept notes" : "Show kept notes"}
              </button>
            )}
            {result.result.candidates
              .filter((c) => !c.dismissed || showKept)
              .map((candidate) => (
                <section key={candidate.key} className="border-b pb-4">
                  <h3 className="font-semibold">
                    {candidate.kind === "duplicate"
                      ? "Possible duplicate"
                      : candidate.kind === "superseded"
                        ? "Explicit replacement"
                        : "May conflict"}
                  </h3>
                  <p className="my-2 text-sm">{candidate.reason}</p>
                  <SourceEvidence sources={candidate.evidence} />
                  <details className="my-3">
                    <summary>Preview changes</summary>
                    <RevisionCompare
                      before={candidate.before}
                      after={candidate.content}
                      beforeLabel={
                        candidate.kind === "superseded"
                          ? "Current note"
                          : "Original notes"
                      }
                      afterLabel="Proposed note"
                    />
                    {candidate.kind !== "superseded" && (
                      <p className="my-2 text-xs text-muted">
                        The combined note stays here; the other note moves to
                        Archive.
                      </p>
                    )}
                  </details>
                  <div className="app-actions">
                    {candidate.dismissed ? (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void review(candidate, false)}
                      >
                        Undo keep both
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void review(candidate, true)}
                        >
                          Keep both
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void apply(
                              candidate,
                              candidate.kind === "superseded"
                                ? "update"
                                : "combine",
                            )
                          }
                        >
                          {candidate.kind === "superseded"
                            ? "Update note"
                            : "Combine"}
                        </Button>
                      </>
                    )}
                  </div>
                </section>
              ))}
          </>
        )}
        {ready && result.result?.changes && (
          <>
            {!result.result.changes.length && (
              <p>No changes in this visit window.</p>
            )}
            {result.result.summary?.items.map((item, index) => (
              <section key={index}>
                <p>{item.text}</p>
                <SourceEvidence sources={item.sources} />
              </section>
            ))}
            {result.result.changes.map((change) => (
              <details key={change.id} className="border-b py-3">
                <summary>
                  <span className="capitalize">{change.kind}</span> ·{" "}
                  {change.title}
                </summary>
                <p className="my-2 text-xs text-muted">
                  {new Date(change.at).toLocaleString()}
                </p>
                <RevisionCompare
                  before={change.beforeContent ?? "Source unavailable"}
                  after={change.afterContent ?? "Source unavailable"}
                  beforeLabel={
                    change.before ? `Revision ${change.before}` : "Before"
                  }
                  afterLabel={
                    change.after ? `Revision ${change.after}` : "After"
                  }
                />
              </details>
            ))}
            {result.result.nextCursor && (
              <Button
                variant="secondary"
                onClick={() => void refresh(result.result!.nextCursor!)}
              >
                More changes
              </Button>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
