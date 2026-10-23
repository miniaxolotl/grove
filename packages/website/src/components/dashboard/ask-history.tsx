"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUpRight, MessageSquare, Trash2 } from "lucide-react";
import type {
  ConversationHistoryItem,
  ConversationHistoryPage,
} from "@lib/shared/conversation-history";
import { errorMessage, type Project } from "@/lib/dashboard-api";
import { workspaceKeys } from "@/lib/workspace-cache";
import { memoryExcerpt } from "@/lib/memory-display";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { Dialog } from "./dialog";
import { useWorkspaceCache } from "./workspace-cache";
import { Button, IconButton } from "./ui/button";
import { SearchField } from "./ui/search-field";

function dateGroup(value: string) {
  const date = new Date(value),
    today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
function scopeLabel(chat: ConversationHistoryItem, projects: Project[]) {
  const id = chat.scope.projectId;
  return id === undefined
    ? "All notes"
    : id === null
      ? "Unfiled"
      : (projects.find((p) => p.id === id)?.name ?? "Unavailable notebook");
}

export function AskHistory({
  projects,
  currentId,
  onOpen,
  onDeleted,
  close,
  onDismissed,
}: {
  projects: Project[];
  currentId?: string;
  onOpen: (id: string, signal: AbortSignal) => Promise<void>;
  onDeleted: (id: string) => void;
  close: () => void;
  onDismissed?: () => void;
}) {
  const cache = useWorkspaceCache();
  const [input, setInput] = useState("");
  const query = useDebouncedValue(input.trim());
  const history = useInfiniteQuery({
    queryKey: [
      ...workspaceKeys.resource("/conversations/search", { query }),
      "pages",
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      cache.api<ConversationHistoryPage>(
        "/conversations/search",
        { query, ...(pageParam ? { after: pageParam } : {}) },
        "POST",
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [opening, setOpening] = useState<string>();
  const [openError, setOpenError] = useState("");
  const [deleting, setDeleting] = useState<ConversationHistoryItem>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [removed, setRemoved] = useState(() => new Set<string>());
  const openRequest = useRef<AbortController | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const focusSearchAfterDelete = useRef(false);
  useEffect(() => () => openRequest.current?.abort(), []);
  const searching = input.trim() !== query;
  const items = (
    history.data?.pages.flatMap((page) => page.items) ?? []
  ).filter(
    (chat, index, all) =>
      !removed.has(chat.id) &&
      all.findIndex((item) => item.id === chat.id) === index,
  );
  const groups = Map.groupBy(items, (chat) => dateGroup(chat.updatedAt));
  async function openConversation(event: MouseEvent<HTMLButtonElement>) {
    const id = event.currentTarget.dataset.conversationId!;
    const controller = new AbortController();
    openRequest.current = controller;
    setOpening(id);
    setOpenError("");
    try {
      await onOpen(id, controller.signal);
      if (!controller.signal.aborted) close();
    } catch (e) {
      if (!controller.signal.aborted) setOpenError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setOpening(undefined);
    }
  }
  return (
    <Dialog
      title="Conversations"
      variant="inspector"
      busy={deleteBusy}
      close={close}
      onDismissed={onDismissed}
    >
      <div className="ask-history-browser">
        <div className="ask-history-search" ref={searchRef}>
          <SearchField
            label="Find a conversation"
            maxLength={200}
            placeholder="Search titles and questions…"
            value={input}
            onChange={setInput}
          />
          <p className="ask-history-status" role="status">
            {searching || history.isPending
              ? "Finding conversations…"
              : opening
                ? "Opening conversation…"
                : `${items.length}${history.hasNextPage ? "+" : ""} ${items.length === 1 ? "conversation" : "conversations"}${query ? " found" : " · most recent first"}`}
          </p>
        </div>
        {openError && (
          <p role="alert" className="app-error">
            {openError} Choose the conversation to try again.
          </p>
        )}
        <div
          className="ask-history-results"
          aria-busy={history.isFetching || searching}
        >
          {!searching &&
            [...groups].map(([label, chats]) => (
              <section key={label} aria-label={label}>
                <h3 className="ask-history-group">{label}</h3>
                <ul className="ask-history-list">
                  {chats.map((chat) => (
                    <li
                      key={chat.id}
                      className="ask-history-row"
                      data-current={chat.id === currentId || undefined}
                    >
                      <button
                        className="ask-history-open"
                        aria-current={
                          chat.id === currentId ? "true" : undefined
                        }
                        disabled={!!opening}
                        data-conversation-id={chat.id}
                        onClick={openConversation}
                      >
                        <span className="ask-history-title">
                          <strong>{chat.title}</strong>
                          {chat.id === currentId && <small>Current</small>}
                          <ArrowUpRight size={15} aria-hidden="true" />
                        </span>
                        {chat.preview && (
                          <span className="ask-history-preview">
                            {memoryExcerpt({ content: chat.preview }, 180)}
                          </span>
                        )}
                        <span className="ask-history-meta">
                          <span>{scopeLabel(chat, projects)}</span>
                          <time
                            dateTime={chat.updatedAt}
                            title={new Date(chat.updatedAt).toLocaleString()}
                          >
                            {new Date(chat.updatedAt).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric" },
                            )}
                          </time>
                          <span>
                            {chat.turnCount
                              ? `${chat.turnCount} ${chat.turnCount === 1 ? "question" : "questions"}`
                              : "No messages yet"}
                          </span>
                        </span>
                      </button>
                      <IconButton
                        label={`Delete conversation ${chat.title}`}
                        disabled={!!opening}
                        onClick={() => {
                          setDeleting(chat);
                          setDeleteError("");
                        }}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          {!searching &&
            !history.isPending &&
            !history.error &&
            !items.length && (
              <div className="ask-history-empty">
                <MessageSquare size={22} aria-hidden="true" />
                <h3>
                  {query
                    ? "No matching conversations"
                    : "Your conversations will appear here."}
                </h3>
                <p>
                  {query
                    ? "Try another title or a few words from your question."
                    : "Ask Grove a question to start a conversation."}
                </p>
                {query && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setInput("");
                      searchRef.current?.querySelector("input")?.focus();
                    }}
                  >
                    Clear search
                  </Button>
                )}
              </div>
            )}
          {history.error && (
            <div className="ask-history-retry" role="alert">
              <p>{errorMessage(history.error)}</p>
              <Button
                variant="secondary"
                disabled={history.isFetching}
                onClick={() =>
                  void (history.isFetchNextPageError
                    ? history.fetchNextPage()
                    : history.refetch())
                }
              >
                Retry
              </Button>
            </div>
          )}
          {!searching && history.hasNextPage && !history.error && (
            <Button
              variant="secondary"
              className="ask-history-more"
              disabled={history.isFetching}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? "Loading…" : "More conversations"}
            </Button>
          )}
        </div>
      </div>
      {deleting && (
        <Dialog
          title="Delete conversation"
          busy={deleteBusy}
          close={() => setDeleting(undefined)}
          onDismissed={() => {
            if (!focusSearchAfterDelete.current) return;
            focusSearchAfterDelete.current = false;
            searchRef.current?.querySelector("input")?.focus();
          }}
        >
          <div className="app-form">
            <p>
              Delete <strong>{deleting.title}</strong> from your history?
            </p>
            <p>Saved notes are kept. This conversation cannot be reopened.</p>
            {deleteError && (
              <p className="app-error" role="alert">
                {deleteError}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                disabled={deleteBusy}
                data-autofocus
                onClick={() => setDeleting(undefined)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={deleteBusy}
                onClick={async () => {
                  setDeleteBusy(true);
                  setDeleteError("");
                  try {
                    await cache.api(
                      `/conversations/${deleting.id}`,
                      undefined,
                      "DELETE",
                    );
                    setRemoved((old) => new Set([...old, deleting.id]));
                    onDeleted(deleting.id);
                    focusSearchAfterDelete.current = true;
                    setDeleting(undefined);
                  } catch (e) {
                    setDeleteError(errorMessage(e));
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
