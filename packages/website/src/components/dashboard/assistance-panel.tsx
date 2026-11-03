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
import { DashboardApiError, errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { Dialog } from "./dialog";
import { LoadError } from "./load-error";
import { Button, IconButton } from "./ui/button";
import { RevisionCompare } from "./revision-compare";
import { SourceEvidence } from "./source-evidence";
import { MeetingBriefContent } from "./meeting-brief-content";
import { useNotebooks } from "./notebooks-provider";
import { NotebookSelect } from "./notebook-select";
import {
  notebookWorkflows,
  workflowScopeLabel,
} from "@lib/shared/notebook-workflows";
import { ToolResultContent } from "./tool-result-content";

const titles = {
  ...Object.fromEntries(
    Object.entries(notebookWorkflows).map(([kind, tool]) => [kind, tool.title]),
  ),
  filing: "Suggested notebook",
  actions: "Action list",
  cleanup: "Review notebook",
  digest: "Since your last visit",
  meeting: "Meeting preparation",
};

export function AssistancePanel({
  initial,
  close,
  back,
}: {
  initial: AssistanceRequest;
  close: () => void;
  back?: () => void;
}) {
  const cache = useWorkspaceCache();
  const { projects } = useNotebooks();
  const [destination, setDestination] = useState(
    "scope" in initial &&
      initial.scope.kind === "notebooks" &&
      initial.scope.ids.length === 1
      ? initial.scope.ids[0]
      : initial.kind === "meeting"
        ? (initial.projectId ?? "")
        : "",
  );
  const [request, setRequest] = useState(initial);
  const [started, setStarted] = useState(false);
  const [enqueueUncertain, setEnqueueUncertain] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveUncertain, setSaveUncertain] = useState(false);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [showKept, setShowKept] = useState(false);
  const operation = useRef<{
    id: string;
    input: AssistanceApply;
    undo: boolean;
  } | null>(null);
  const cancelVersion = useRef<number | null>(null);
  const continueVersion = useRef<number | null>(null);
  const [continueUncertain, setContinueUncertain] = useState<number | null>(
    null,
  );
  const path = `/assistance/${request.id}`;
  const query = useQuery({
    ...cache.resource<Assistance | null>(path),
    enabled: started,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 1500 : false),
  });
  const result = query.data,
    ready = result?.status === "ready";
  const unresolvedSave = saveUncertain && ready;
  const unresolvedContinue =
    continueUncertain !== null && ready && result.version === continueUncertain;
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
          setEnqueueUncertain(false);
          setError("");
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setEnqueueUncertain(
            !(reason instanceof DashboardApiError && reason.status < 500),
          );
          setError(errorMessage(reason));
        }
      });
    return () => controller.abort();
  }, [cache, request, path]);
  async function refresh(after?: string) {
    setBusy(true);
    setError("");
    try {
      let next = { ...request, id: crypto.randomUUID() };
      if ("scope" in next && next.scope.kind === "notes")
        next = {
          ...next,
          scope: {
            kind: "notes",
            sources: await Promise.all(
              next.scope.sources.map(async (ref) => {
                const note = await cache.api<Memory>(`/memories/${ref.id}`);
                return { id: note.id, version: note.version };
              }),
            ),
          },
        };
      if ("sources" in next && next.sources)
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
      setEnqueueUncertain(true);
      setEdits({});
      operation.current = null;
      setSaveUncertain(false);
      cancelVersion.current = null;
      continueVersion.current = null;
      setContinueUncertain(null);
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
            ...((request.kind === "meeting" || "scope" in request) && !undo
              ? { destinationProjectId: destination || null }
              : {}),
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
    setSaveUncertain(true);
    try {
      setResult(
        await cache.api<Assistance>(
          `${path}/${undo ? "undo" : "apply"}`,
          input,
        ),
      );
      operation.current = null;
      setSaveUncertain(false);
    } catch (reason) {
      if (reason instanceof DashboardApiError && reason.status < 500) {
        operation.current = null;
        setSaveUncertain(false);
      }
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
  async function cancel() {
    if (!result) return;
    setBusy(true);
    setError("");
    cancelVersion.current ??= result.version;
    try {
      setResult(
        await cache.api<Assistance>(`${path}/cancel`, {
          expectedVersion: cancelVersion.current,
        }),
      );
      cancelVersion.current = null;
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function continueReview() {
    if (!result) return;
    setBusy(true);
    setError("");
    if (!unresolvedContinue) continueVersion.current = result.version;
    try {
      setResult(
        await cache.api<Assistance>(`${path}/continue`, {
          expectedVersion: continueVersion.current,
        }),
      );
      continueVersion.current = null;
      setContinueUncertain(null);
    } catch (reason) {
      if (reason instanceof DashboardApiError && reason.status < 500) {
        continueVersion.current = null;
        setContinueUncertain(null);
      } else setContinueUncertain(continueVersion.current);
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={
        "scope" in request
          ? notebookWorkflows[request.kind].title
          : titles[request.kind]
      }
      close={close}
      busy={
        busy ||
        ((request.kind === "meeting" || "scope" in request) &&
          (unresolvedSave ||
            unresolvedContinue ||
            (!started && enqueueUncertain)))
      }
    >
      <div className="assistance-panel app-form">
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="text-sm text-muted">
            {!started || result?.status === "pending"
              ? `Checking notes${result?.progress ? ` · ${result.progress}` : ""}…`
              : result?.status === "applied"
                ? "scope" in request
                  ? "Saved to your notes"
                  : "Applied"
                : result?.status === "undone"
                  ? "Undone"
                  : result?.result
                    ? `${result.result.coverage.examined} of ${result.result.coverage.total} ${request.kind === "filing" ? "notebooks" : "notes"} examined`
                    : (result?.error ?? "Preview unavailable")}
          </p>
          <IconButton
            label="Refresh preview"
            disabled={
              !started ||
              busy ||
              unresolvedSave ||
              unresolvedContinue ||
              result?.status === "pending"
            }
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
        {(request.kind === "meeting" || "scope" in request) && (
          <>
            <p className="text-xs text-muted">
              {"scope" in request
                ? workflowScopeLabel(request.scope)
                : request.sources
                  ? "Selected notes only"
                  : "This notebook’s direct notes only"}
              {result?.result ? (
                <>
                  . {result.result.coverage.supplied} supplied;{" "}
                  {result.result.coverage.cited} cited.
                </>
              ) : (
                ". Only this scope will be used."
              )}
            </p>
            {result?.status === "pending" && (
              <>
                <p className="text-xs text-muted">
                  Checking your selected sources and preparing a cited preview.
                  Closing the preview does not cancel generation; use Cancel
                  generation to stop.
                </p>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void cancel()}
                >
                  Cancel generation
                </Button>
              </>
            )}
            {result?.result?.coverage.partial && (
              <p role="status" className="text-sm text-muted">
                Partial coverage. {result.result.coverage.reason}
              </p>
            )}
            {back && (
              <button
                className="text-button"
                disabled={
                  busy ||
                  unresolvedSave ||
                  unresolvedContinue ||
                  (!started && enqueueUncertain) ||
                  result?.status === "pending"
                }
                onClick={back}
              >
                {"scope" in request
                  ? "Edit tool inputs"
                  : "Edit meeting details"}
              </button>
            )}
          </>
        )}
        {ready && "scope" in request && result.result && (
          <>
            <ToolResultContent
              key={`${result.id}:${result.version}`}
              input={request}
              result={result.result}
            />
            {result.result.nextCursor && (
              <div className="space-y-3 border-y border-line py-4">
                <p className="text-sm text-muted">
                  More sources remain in your chosen scope. Continue this result
                  without using another assistance action.
                </p>
                <Button
                  variant="secondary"
                  disabled={busy || unresolvedSave}
                  onClick={() => void continueReview()}
                >
                  {unresolvedContinue
                    ? "Retry source review"
                    : "Review more sources"}
                </Button>
              </div>
            )}
            {result.result.preparation?.sections.some(
              (section) => section.items.length,
            ) ||
            result.result.study?.items.length ||
            result.result.weekly?.ideas.length ||
            result.result.weekly?.decisions.length ||
            result.result.weekly?.openActions.length ||
            result.result.gaps?.findings.length ||
            result.result.problems?.matches.length ? (
              <>
                <div className="space-y-4 rounded-lg border border-line p-4">
                  <h3 className="font-semibold">Keep this result</h3>
                  <NotebookSelect
                    label="Save result to"
                    projects={projects}
                    value={destination}
                    disabled={busy || unresolvedSave || unresolvedContinue}
                    onValueChange={(value) => {
                      operation.current = null;
                      setDestination(value);
                    }}
                  />
                  <p className="text-xs text-muted">
                    Save creates ordinary editable notes with sources and
                    coverage. Long results may create multiple notes; Undo
                    archives only those notes.
                  </p>
                  {request.kind === "study" && (
                    <p className="text-xs text-muted">
                      Saved study sets include answer keys and explanations.
                    </p>
                  )}
                  {unresolvedSave && (
                    <p role="status" className="text-sm">
                      Save is unconfirmed. Retry save checks the same operation
                      and destination; it won’t create a second copy.
                    </p>
                  )}
                  <Button
                    disabled={busy || unresolvedContinue}
                    onClick={() => void apply()}
                  >
                    {busy
                      ? "Saving…"
                      : unresolvedSave
                        ? "Retry save"
                        : "Save result"}
                  </Button>
                </div>
              </>
            ) : null}
          </>
        )}
        {ready && request.kind === "meeting" && result.result?.meeting && (
          <>
            <MeetingBriefContent
              brief={result.result.meeting}
              title={request.title}
              agenda={request.agenda}
              meetingDate={request.meetingDate}
            />
            {Object.values(result.result.meeting).some(
              (items) => items.length,
            ) && (
              <>
                <NotebookSelect
                  label="Save brief to"
                  projects={projects}
                  value={destination}
                  disabled={busy || unresolvedSave}
                  onValueChange={(value) => {
                    operation.current = null;
                    setDestination(value);
                  }}
                />
                <Button disabled={busy} onClick={() => void apply()}>
                  Save brief
                </Button>
              </>
            )}
          </>
        )}
        {result?.status === "applied" && (
          <div className="space-y-3 rounded-lg bg-sage p-4">
            {"scope" in request && (
              <p className="text-sm">
                Your original notes are unchanged. Open your saved result to
                edit it, or Undo to archive only the notes created by this save.
              </p>
            )}
            <div className="app-actions">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void apply(undefined, undefined, true)}
              >
                <Undo2 size={16} />
                Undo
              </Button>
              {result.applied.map((note, index) => (
                <Link
                  key={note.id}
                  className="text-button"
                  href={`/app/memories/${note.id}`}
                >
                  {result.applied.length === 1
                    ? "Open note"
                    : `Open note ${index + 1}`}
                </Link>
              ))}
              {result.applied.length > 1 && (
                <p className="text-sm text-muted">
                  {result.applied.length} notes saved. Undo affects all of these
                  created notes.
                </p>
              )}
            </div>
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
