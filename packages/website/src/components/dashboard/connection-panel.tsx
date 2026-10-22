"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeftRight, ChevronRight } from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import {
  relationshipLabels,
  type ConnectionPage,
  type ConnectionQuery,
  type NoteConnection,
} from "@lib/shared/relationships";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache, useWorkspaceApi } from "./workspace-cache";
import { Dialog } from "./dialog";
import { Markdown } from "./markdown";

export function useConnections(
  query: Omit<ConnectionQuery, "limit" | "includeDismissed"> &
    Partial<Pick<ConnectionQuery, "limit" | "includeDismissed">>,
) {
  const cache = useWorkspaceCache();
  const result = useInfiniteQuery(cache.relationships(query));
  const page = useMemo<ConnectionPage | undefined>(
    () =>
      result.data && {
        ...result.data.pages[0],
        items: [
          ...new Map(
            result.data.pages
              .flatMap((page) => page.items)
              .map((item) => [item.id, item]),
          ).values(),
        ],
        nextCursor: result.data.pages.at(-1)?.nextCursor ?? null,
      },
    [result.data],
  );
  return {
    page,
    error: result.error ? errorMessage(result.error) : "",
    loading: result.isPending || result.isFetching,
    more: () => {
      if (!result.isFetching && result.hasNextPage) void result.fetchNextPage();
    },
    reload: () => {
      if (result.isFetchNextPageError) void result.fetchNextPage();
      else void result.refetch();
    },
  };
}
export function ConnectionStatus({
  state,
}: {
  state: ReturnType<typeof useConnections>;
}) {
  const { page, error, loading, reload } = state;
  if (error)
    return (
      <p className="connection-status" role="alert">
        {error}{" "}
        <button className="text-button" onClick={reload}>
          Try again
        </button>
      </p>
    );
  if (!page && loading)
    return (
      <p className="connection-status" role="status">
        Loading connections…
      </p>
    );
  if (page?.status === "pending")
    return (
      <p className="connection-status" role="status">
        Checking connections…
      </p>
    );
  if (page?.status === "failed")
    return (
      <p className="connection-status" role="status">
        Some connections could not be checked.
      </p>
    );
  if (page?.status === "disabled")
    return <p className="connection-status">Connections are unavailable.</p>;
  if (!page?.items.length)
    return <p className="connection-status">No connections yet.</p>;
  return null;
}
function connectionLabel(item: NoteConnection) {
  return item.level === "note"
    ? relationshipLabels[item.type]
    : item.breadth === "broad"
      ? "Shared context"
      : "Shared thread";
}
export function ConnectionList({
  items,
  endpointId,
  onInspect,
}: {
  items: NoteConnection[];
  endpointId?: string;
  onInspect: (item: NoteConnection) => void;
}) {
  const listId = useId();
  return (
    <ul className="connection-list">
      {items.map((item) => {
        const other = endpointId === item.to.id ? item.from : item.to;
        return (
          <li key={item.id}>
            <button
              type="button"
              className="connection-row"
              aria-label={`Connection: ${endpointId ? other.title : `${item.from.title} and ${item.to.title}`}`}
              aria-describedby={`${listId}-${item.id}-kind ${listId}-${item.id}-reason`}
              data-focus-key={`connection-${item.id}`}
              onClick={() => onInspect(item)}
            >
              <span className="connection-row-content">
                <span className="connection-row-heading">
                  <span className="connection-row-title">
                    {endpointId
                      ? other.title
                      : `${item.from.title} ↔ ${item.to.title}`}
                  </span>
                  <span
                    className="connection-kind"
                    id={`${listId}-${item.id}-kind`}
                  >
                    {connectionLabel(item)}
                  </span>
                </span>
                <span
                  className="connection-row-reason"
                  id={`${listId}-${item.id}-reason`}
                >
                  {item.reason}
                </span>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
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
}: {
  level: "note" | "notebook";
  endpointId: string;
}) {
  const api = useWorkspaceApi();
  const state = useConnections({ level, endpointId, limit: 5 });
  const [selected, setSelected] = useState<NoteConnection>();
  const [retryError, setRetryError] = useState("");
  return (
    <section
      className="connection-panel"
      aria-label={level === "note" ? "Note connections" : "Connected notebooks"}
      data-private
    >
      {level === "notebook" && <h2>Connected notebooks</h2>}
      <ConnectionStatus state={state} />
      <ConnectionList
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
  const api = useWorkspaceApi();
  const state = useConnections({
    level: connection.level,
    connectionId: connection.id,
    includeDismissed: true,
  });
  const current = state.page?.items[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [comparison, setComparison] = useState<Memory[]>();
  const [showEvidence, setShowEvidence] = useState(false);
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
        state.reload();
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
    <Dialog title="Connection" close={close} busy={busy}>
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
                This connection changed or is no longer available.
              </p>
            ) : (
              <ConnectionStatus state={state} />
            )}
          </>
        ) : (
          <>
            <p className="connection-kind">
              {connectionLabel(current)}
              {current.level === "notebook" &&
                (current.coverage.from.examined < current.coverage.from.total ||
                  current.coverage.to.examined < current.coverage.to.total) &&
                " · Partial coverage"}
            </p>
            <div className="connection-endpoints">
              <Link
                href={`/app/${current.level === "note" ? "memories" : "projects"}/${current.from.id}`}
              >
                {current.from.title}
              </Link>
              <ArrowLeftRight size={14} aria-label="and" />
              <Link
                href={`/app/${current.level === "note" ? "memories" : "projects"}/${current.to.id}`}
              >
                {current.to.title}
              </Link>
            </div>
            <p className="connection-reason">{current.reason}</p>
            <details
              className="connection-support"
              open={showEvidence}
              onToggle={(event) => setShowEvidence(event.currentTarget.open)}
            >
              <summary>Supporting notes</summary>
              <div className="connection-evidence">
                {(["from", "to"] as const).map((side) => (
                  <section key={side}>
                    {current.level === "notebook" && (
                      <>
                        <h3>{current[side].title}</h3>
                        <p className="connection-coverage">
                          {current.coverage[side].examined} of{" "}
                          {current.coverage[side].total} notes checked
                        </p>
                      </>
                    )}
                    {current.evidence
                      .filter((ref) =>
                        current.level === "note"
                          ? ref.id === current[side].id
                          : ref.projectId === current[side].id,
                      )
                      .map((ref) => (
                        <figure key={`${ref.id}:${ref.start}`}>
                          <figcaption>
                            <Link href={`/app/memories/${ref.id}`}>
                              {ref.title}
                            </Link>
                          </figcaption>
                          <blockquote>{ref.quote}</blockquote>
                        </figure>
                      ))}
                  </section>
                ))}
              </div>
              {current.level === "notebook" && (
                <p className="connection-coverage">
                  Directly filed notes only. Sub-notebooks are checked
                  separately.
                  {current.basis === "dependency" && (
                    <>
                      {" "}
                      {current.direction === "left_to_right"
                        ? `${current.from.title} depends on ${current.to.title}.`
                        : current.direction === "right_to_left"
                          ? `${current.to.title} depends on ${current.from.title}.`
                          : "The notes describe a shared dependency."}
                    </>
                  )}
                </p>
              )}
            </details>
            <div className="connection-actions connection-review">
              {current.level === "note" && (
                <button
                  className="text-button"
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
              {current.dismissed && <p role="status">Dismissed.</p>}
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
