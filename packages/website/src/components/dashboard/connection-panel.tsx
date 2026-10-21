"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Memory } from "@lib/shared/contracts";
import {
  relationshipLabels,
  type ConnectionPage,
  type ConnectionQuery,
  type NoteConnection,
} from "@lib/shared/relationships";
import { api, errorMessage } from "@/lib/dashboard-api";
import { Dialog } from "./dialog";
import { Markdown } from "./markdown";

const changed = () => window.dispatchEvent(new Event("grove:relationships"));
export function useConnections(
  query: Omit<ConnectionQuery, "limit" | "includeDismissed"> &
    Partial<Pick<ConnectionQuery, "limit" | "includeDismissed">>,
  revision?: number,
) {
  const key = JSON.stringify(query);
  const [result, setResult] = useState<{ key: string; page: ConnectionPage }>();
  const [failure, setFailure] = useState<{ key: string; error: string }>();
  const [loadingKey, setLoadingKey] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const requestKey = JSON.stringify([key, revision, refresh]);
  const page = result?.key === requestKey ? result.page : undefined;
  const error = failure?.key === requestKey ? failure.error : "";
  const loading = (!page && !error) || loadingKey === requestKey;
  const controller = useRef<AbortController | null>(null);
  const reload = useCallback(() => setRefresh((n) => n + 1), [setRefresh]);
  useEffect(() => {
    window.addEventListener("grove:relationships", reload);
    return () => window.removeEventListener("grove:relationships", reload);
  }, [reload]);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    let timer: ReturnType<typeof setTimeout>;
    api<ConnectionPage>(
      "/relationships/search",
      JSON.parse(key),
      undefined,
      abort.signal,
    )
      .then((result) => {
        if (abort.signal.aborted) return;
        setResult({ key: requestKey, page: result });
        if (result.status === "pending") timer = setTimeout(reload, 15000);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setFailure({ key: requestKey, error: errorMessage(e) });
      });
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [key, requestKey, reload]);
  async function more() {
    if (loading || !page?.nextCursor) return;
    const signal = controller.current?.signal;
    setLoadingKey(requestKey);
    try {
      const next = await api<ConnectionPage>(
        "/relationships/search",
        { ...JSON.parse(key), cursor: page.nextCursor },
        undefined,
        signal,
      );
      if (!signal?.aborted)
        setResult({
          key: requestKey,
          page: { ...next, items: [...page.items, ...next.items] },
        });
    } catch (e) {
      if (!signal?.aborted)
        setFailure({ key: requestKey, error: errorMessage(e) });
    } finally {
      if (!signal?.aborted) setLoadingKey(undefined);
    }
  }
  return { page, error, loading, more, reload };
}
export function ConnectionStatus({
  state,
}: {
  state: ReturnType<typeof useConnections>;
}) {
  const { page, error, loading, reload } = state;
  if (error)
    return (
      <p role="alert">
        {error}{" "}
        <button className="text-button" onClick={reload}>
          Try again
        </button>
      </p>
    );
  if (!page && loading) return <p role="status">Loading connections…</p>;
  if (page?.status === "pending")
    return (
      <p role="status">
        Grove is checking connections. Updated evidence will appear here.
      </p>
    );
  if (page?.status === "failed")
    return (
      <p role="status">
        Some connections could not be checked. You can retry processing.
      </p>
    );
  if (page?.status === "disabled")
    return (
      <p>
        Connections are unavailable while organization or text generation is
        off.
      </p>
    );
  if (!page?.items.length) return <p>No evidence-backed connections yet.</p>;
  return null;
}
export function ConnectionCards({
  items,
  endpointId,
  onInspect,
}: {
  items: NoteConnection[];
  endpointId?: string;
  onInspect: (item: NoteConnection) => void;
}) {
  return (
    <ul className="connection-cards">
      {items.map((item) => {
        const other = endpointId === item.to.id ? item.from : item.to;
        return (
          <li
            key={item.id}
            className={`connection-card connection-${item.type}`}
          >
            <small>{relationshipLabels[item.type]}</small>
            <h3>
              {endpointId ? (
                <Link
                  href={`/app/${item.level === "note" ? "memories" : "projects"}/${other.id}`}
                >
                  {other.title}
                </Link>
              ) : (
                `${item.from.title} ↔ ${item.to.title}`
              )}
            </h3>
            <p>{item.reason}</p>
            <button
              type="button"
              className="text-button"
              data-focus-key={`connection-${item.id}`}
              onClick={() => onInspect(item)}
            >
              Why this connection?
            </button>
          </li>
        );
      })}
    </ul>
  );
}
export function ConnectionPanel({
  level,
  endpointId,
  revision,
}: {
  level: "note" | "notebook";
  endpointId: string;
  revision?: number;
}) {
  const state = useConnections({ level, endpointId }, revision);
  const [selected, setSelected] = useState<NoteConnection>();
  const [retryError, setRetryError] = useState("");
  return (
    <section
      className="connection-panel"
      aria-label={level === "note" ? "Note connections" : "Connected notebooks"}
      data-private
    >
      {level === "notebook" && (
        <>
          <h2>Connected notebooks</h2>
          <p>
            Shared threads in directly filed notes. Sub-notebooks are assessed
            separately.
          </p>
        </>
      )}
      <ConnectionStatus state={state} />
      <ConnectionCards
        items={state.page?.items ?? []}
        endpointId={endpointId}
        onInspect={setSelected}
      />
      {state.page?.nextCursor && (
        <button
          className="text-button"
          disabled={state.loading}
          onClick={() => void state.more()}
        >
          More connections
        </button>
      )}
      {state.page?.status === "failed" && (
        <button
          className="text-button"
          onClick={async () => {
            try {
              await api(`/relationships/${level}/${endpointId}/retry`, {});
              setRetryError("");
              state.reload();
            } catch (e) {
              setRetryError(errorMessage(e));
            }
          }}
        >
          Retry connections
        </button>
      )}
      {retryError && <p role="alert">{retryError}</p>}
      {selected && (
        <ConnectionInspector
          connection={selected}
          close={() => setSelected(undefined)}
        />
      )}
    </section>
  );
}
export function ConnectionInspector({
  connection,
  close,
}: {
  connection: NoteConnection;
  close: () => void;
}) {
  const state = useConnections({
    level: connection.level,
    connectionId: connection.id,
    includeDismissed: true,
  });
  const current = state.page?.items[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [comparison, setComparison] = useState<Memory[]>();
  const operations = useRef(new Map<string, string>());
  const reviewButton = useRef<HTMLButtonElement>(null);
  const returnToReview = useRef(false);
  useEffect(() => {
    if (current && returnToReview.current) {
      returnToReview.current = false;
      reviewButton.current?.focus({ preventScroll: true });
    }
  }, [current]);
  async function review(dismissed: boolean) {
    if (!current || busy) return;
    setBusy(true);
    setError("");
    const body = {
      expectedRevision: current.revision,
      expectedReviewVersion: current.reviewVersion,
      dismissed,
    };
    const key = JSON.stringify(body);
    if (!operations.current.has(key))
      operations.current.set(key, crypto.randomUUID());
    try {
      await api(`/relationships/${current.level}/${current.id}/review`, {
        ...body,
        operationId: operations.current.get(key),
      });
      returnToReview.current = true;
      changed();
    } catch (e) {
      setError(errorMessage(e));
      state.reload();
    } finally {
      setBusy(false);
    }
  }
  async function compare() {
    if (!current || busy) return;
    setBusy(true);
    setError("");
    try {
      const notes = await Promise.all(
        [current.from.id, current.to.id].map((id) =>
          api<Memory>(`/memories/${id}`),
        ),
      );
      if (
        notes.some(
          (n) =>
            n.status !== "active" ||
            current.evidence.some(
              (e) =>
                e.id === n.id &&
                (e.version !== n.version ||
                  n.content.slice(e.start, e.end) !== e.quote),
            ),
        )
      ) {
        changed();
        throw new Error(
          "These notes changed. Reopen the connection for current evidence.",
        );
      }
      setComparison(notes);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Why this connection?" close={close} panel busy={busy}>
      <div className="connection-inspector" data-private>
        {error && (
          <p role="alert" className="app-error">
            {error}
          </p>
        )}
        {!current ? (
          <>
            {state.page && !state.error ? (
              <p role="status">
                This connection changed or is no longer available. Close this
                view to refresh.
              </p>
            ) : (
              <ConnectionStatus state={state} />
            )}
          </>
        ) : (
          <>
            <small>{relationshipLabels[current.type]}</small>
            <h3>
              {current.from.title} <span aria-label="and">↔</span>{" "}
              {current.to.title}
            </h3>
            <p>{current.reason}</p>
            {current.level === "notebook" && (
              <>
                <p className="connection-coverage">
                  {current.breadth === "broad"
                    ? "Broad shared context"
                    : "A shared thread"}
                  . Based on {current.coverage.from.examined} of{" "}
                  {current.coverage.from.total} notes in {current.from.title},
                  and {current.coverage.to.examined} of{" "}
                  {current.coverage.to.total} in {current.to.title}.
                </p>
                {current.basis === "dependency" && (
                  <p>
                    {current.direction === "left_to_right"
                      ? `${current.from.title} depends on ${current.to.title}.`
                      : current.direction === "right_to_left"
                        ? `${current.to.title} depends on ${current.from.title}.`
                        : "The notes describe a shared dependency."}
                  </p>
                )}
                <div className="connection-actions">
                  {[current.from, current.to].map((p) => (
                    <Link
                      className="text-button"
                      key={p.id}
                      href={`/app/projects/${p.id}`}
                    >
                      Open {p.title}
                    </Link>
                  ))}
                </div>
              </>
            )}
            <h4>Supporting notes</h4>
            <div className="connection-evidence">
              {current.evidence.map((ref) => (
                <figure key={`${ref.id}:${ref.start}`}>
                  <figcaption>
                    <Link href={`/app/memories/${ref.id}`}>{ref.title}</Link>{" "}
                    <span>· revision {ref.version}</span>
                  </figcaption>
                  <blockquote>{ref.quote}</blockquote>
                </figure>
              ))}
            </div>
            <div className="connection-actions">
              {current.level === "note" && (
                <button
                  className="app-button secondary"
                  aria-disabled={busy}
                  onClick={() => void compare()}
                >
                  Compare notes
                </button>
              )}
              <button
                className="text-button"
                ref={reviewButton}
                disabled={busy}
                onClick={() => void review(!current.dismissed)}
              >
                {current.dismissed ? "Undo dismissal" : "Dismiss suggestion"}
              </button>
              {current.dismissed && (
                <p role="status">Suggestion dismissed from both views.</p>
              )}
            </div>
          </>
        )}
        {comparison && (
          <Dialog
            title="Compare notes"
            close={() => setComparison(undefined)}
            panel
          >
            <div className="connection-comparison">
              {comparison.map((note) => (
                <section key={note.id}>
                  <h3>{note.content.split("\n")[0].replace(/^#+\s*/, "")}</h3>
                  <p>Revision {note.version}</p>
                  <Markdown>{note.content}</Markdown>
                </section>
              ))}
            </div>
          </Dialog>
        )}
      </div>
    </Dialog>
  );
}
