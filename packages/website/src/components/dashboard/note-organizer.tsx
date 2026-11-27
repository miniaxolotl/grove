"use client";

import { useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUp, ArrowDown } from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import type {
  OrganizeNote,
  NoteOrganization,
} from "@lib/shared/note-organization";
import { DashboardApiError, errorMessage } from "@/lib/dashboard-api";
import { memoryTitle } from "@/lib/memory-display";
import { useWorkspaceCache } from "./workspace-cache";
import { useWorkspaceView } from "./workspace-location";
import { uniquePageNotes } from "./note-list-continuation";
import { Dialog } from "./dialog";
import { Button, IconButton } from "./ui/button";
import { ActionMenu } from "./ui/action-menu";
import "./note-organizer.css";

type Move = { id: string; input: OrganizeNote; undo: boolean };
type Undo = {
  note: Memory;
  state: string;
  placement: NoteOrganization["undo"];
};

export function NoteOrganizer({
  projectId,
  name,
  close,
}: {
  projectId?: string | null;
  name: string;
  close: () => void;
}) {
  const cache = useWorkspaceCache();
  const query = useInfiniteQuery({
    // Arrangement is explicitly paged, independent of the library's automatic
    // continuation and filters; no unseen page loads merely because it is open.
    ...cache.notes({ projectId, sort: "custom", status: "active", limit: 50 }),
    staleTime: 0,
  });
  const notes = uniquePageNotes(query.data?.pages);
  const state = query.data?.pages[0]?.orderState;
  const [pending, setPending] = useWorkspaceView<Move | null>(
    `note-order:${projectId === undefined ? "all" : (projectId ?? "unfiled")}:pending`,
    null,
  );
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  const list = useRef<HTMLOListElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const locked =
    busy || !!pending || query.isFetching || query.isError || review || !state;
  async function send(move: Move) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setPending(move);
    setError("");
    setNotice("");
    try {
      const result = await cache.api<NoteOrganization>(
        `/memories/${move.id}/organize`,
        move.input,
      );
      setPending(null);
      const note = notes.find((item) => item.id === move.id);
      setUndo(
        !move.undo && note
          ? { note, state: result.state, placement: result.undo }
          : null,
      );
      setNotice(move.undo ? "Note order restored." : "Note order saved.");
      await query.refetch();
      requestAnimationFrame(() =>
        (
          list.current?.querySelector<HTMLElement>(
            `[data-ordered-note="${move.id}"]`,
          ) ?? feedback.current
        )?.focus({ preventScroll: true }),
      );
    } catch (cause) {
      if (
        cause instanceof DashboardApiError &&
        [400, 403, 404, 409, 422].includes(cause.status)
      ) {
        setPending(null);
        setUndo(null);
        setReview(true);
        setError(errorMessage(cause));
      } else
        setError(
          "The move is not confirmed. Retry the same move to check its result.",
        );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  function place(note: Memory, placement: NoteOrganization["undo"]) {
    if (locked || !state) return;
    setUndo(null);
    void send({
      id: note.id,
      undo: false,
      input: {
        operationId: crypto.randomUUID(),
        expectedVersion: note.version,
        expectedState: state,
        ...(projectId !== undefined ? { projectId } : {}),
        ...placement,
      },
    });
  }
  async function refresh() {
    if (running.current || pending) return;
    setUndo(null);
    const result = await query.refetch();
    if (!result.isError) {
      setReview(false);
      setError("");
      setNotice("Current order loaded. Review it before moving a note.");
    }
  }
  return (
    <Dialog title="Arrange notes" close={close} busy={busy}>
      <p className="note-order-scope">
        {name} has its own order. Other notebook and Unfiled orders stay
        separate. Search and filters do not limit this arrangement.
      </p>
      <div
        className="note-order-feedback"
        ref={feedback}
        tabIndex={-1}
        role={error || query.error ? "alert" : "status"}
      >
        {error ||
          (query.error ? errorMessage(query.error) : notice) ||
          (query.isPending
            ? "Loading note order…"
            : "Use the arrows or placement menu. Changes save immediately.")}
        {pending && !busy ? (
          <Button variant="secondary" onClick={() => void send(pending)}>
            Retry same move
          </Button>
        ) : null}
        {!pending &&
        (review || query.isError || (!state && query.isSuccess)) ? (
          <Button
            variant="secondary"
            disabled={busy || query.isFetching}
            onClick={() => void refresh()}
          >
            Review current order
          </Button>
        ) : null}
        {undo && !pending && !review ? (
          <Button
            variant="secondary"
            disabled={locked}
            onClick={() =>
              void send({
                id: undo.note.id,
                undo: true,
                input: {
                  operationId: crypto.randomUUID(),
                  expectedVersion: undo.note.version,
                  expectedState: undo.state,
                  ...(projectId !== undefined ? { projectId } : {}),
                  ...undo.placement,
                },
              })
            }
          >
            Undo order
          </Button>
        ) : null}
      </div>
      <ol
        className="note-order-list"
        ref={list}
        aria-label={`Custom order for ${name}`}
      >
        {notes.map((note, index) => {
          const title = memoryTitle(note);
          return (
            <li key={note.id} data-ordered-note={note.id} tabIndex={-1}>
              <span>{title}</span>
              <div className="note-order-actions">
                <IconButton
                  label={`Move ${title} up`}
                  disabled={locked || index === 0}
                  onClick={() => place(note, { beforeId: notes[index - 1].id })}
                >
                  <ArrowUp size={16} />
                </IconButton>
                <IconButton
                  label={`Move ${title} down`}
                  disabled={locked || index === notes.length - 1}
                  onClick={() => place(note, { afterId: notes[index + 1].id })}
                >
                  <ArrowDown size={16} />
                </IconButton>
                <ActionMenu label={`Placement for ${title}`}>
                  <button
                    type="button"
                    disabled={locked || index === 0}
                    onClick={() => place(note, { beforeId: notes[0].id })}
                  >
                    Move to start
                  </button>
                  <button
                    type="button"
                    disabled={
                      locked ||
                      (!query.hasNextPage && index === notes.length - 1)
                    }
                    onClick={() => place(note, {})}
                  >
                    Move to end
                  </button>
                </ActionMenu>
              </div>
            </li>
          );
        })}
      </ol>
      {!query.isPending && !query.error && !notes.length ? (
        <p>No active notes to arrange here.</p>
      ) : null}
      {query.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={busy || !!pending || query.isFetching || review}
          onClick={() => void query.fetchNextPage()}
        >
          Load more notes
        </Button>
      ) : null}
    </Dialog>
  );
}
