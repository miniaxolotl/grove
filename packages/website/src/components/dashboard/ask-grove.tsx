"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowDown,
  BookOpen,
  History,
  MessageSquare,
  Plus,
  Search,
  Sprout,
  Trash2,
  Undo2,
} from "lucide-react";
import type { AskResult } from "@lib/shared/models";
import type {
  Conversation,
  ConversationPage,
  ConversationReply,
  ConversationTurn,
  ConversationTurnRequest,
} from "@lib/shared/conversations";
import type { Memory } from "@lib/shared/contracts";
import { DashboardApiError, errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { useQuery } from "@tanstack/react-query";
import { useNotebooks } from "./notebooks-provider";
import { NotebookSelect } from "./notebook-select";
import { memoryExcerpt, memoryTitle } from "@/lib/memory-display";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { PageHeading } from "./ui/page-heading";
import { Button } from "./ui/button";
import { SegmentedControl } from "./ui/segmented-control";
import { SearchField } from "./ui/search-field";
import { deferredFeature } from "./deferred-feature";
import { useWorkspaceSearch } from "./workspace-search";
import { AskComposer } from "./ask-composer";
import { Dialog } from "./dialog";
import { Markdown } from "./markdown";
import { RevisionCompare } from "./revision-compare";
import { LoadError } from "./load-error";
const MemoryInspector = deferredFeature(
  async () => ({
    default: (await import("./memory-inspector")).MemoryInspector,
  }),
  "Opening your note…",
  { failureTitle: "Your note couldn’t open" },
);

function reconcileReply(
  chat: Conversation,
  unconfirmed?: ConversationTurn,
): Conversation {
  if (!unconfirmed || chat.turns.some((turn) => turn.id === unconfirmed.id))
    return chat;
  return {
    ...chat,
    turns: [
      ...chat.turns,
      {
        ...unconfirmed,
        status: "failed",
        error: "This message wasn’t confirmed. Try again to finish sending it.",
      },
    ],
  };
}

export function AskGrove({
  projectId,
  embedded = false,
}: {
  projectId?: string | null;
  embedded?: boolean;
}) {
  const workspace = useWorkspaceSearch();
  const sessions = workspace?.sessions;
  const consumeQuestion = workspace?.setQuestion;
  const sessionKey = `ask:${projectId === undefined ? "global" : (projectId ?? "personal")}`;
  const [session] = useState(() => sessions?.get(sessionKey));
  const { projects, error: projectError } = useNotebooks();
  const cache = useWorkspaceCache();
  const api = cache.api;
  const [scope, setScope] = useState(
    session?.scope ??
      (projectId === undefined ? "all" : (projectId ?? "personal")),
  );
  const [includePersonal, setPersonal] = useState(
    session?.includePersonal ?? false,
  );
  const [mode, setMode] = useState<"answer" | "search">(
    workspace?.question ? "answer" : (session?.mode ?? "answer"),
  );
  const [draft, setDraft] = useState(
    workspace?.question || session?.draft || "",
  );
  const [handoff, setHandoff] = useState(workspace?.question);
  if (workspace?.question !== handoff) {
    setHandoff(workspace?.question);
    if (workspace?.question) {
      setDraft(workspace.question);
      setMode("answer");
    }
  }
  const [conversationId, setConversationId] = useState(session?.conversationId);
  const [conversation, setConversation] = useState<Conversation>();
  const [unconfirmed, setUnconfirmed] = useState(session?.unconfirmed);
  const [loading, setLoading] = useState(!!session?.conversationId);
  const [pending, setPending] = useState(false);
  const [actionError, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ConversationPage>();
  const [historyError, setHistoryError] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [deleting, setDeleting] = useState<string>();
  const [actionBusy, setActionBusy] = useState<string>();
  const chatQuery = useQuery({
    ...cache.resource<Conversation>(`/conversations/${conversationId ?? ""}`),
    enabled:
      !!conversationId && !pending && !loading && !unconfirmed && !actionBusy,
  });
  const [seenChat, setSeenChat] = useState<Conversation>();
  if (chatQuery.data !== seenChat) {
    setSeenChat(chatQuery.data);
    if (
      chatQuery.data &&
      !pending &&
      !unconfirmed &&
      chatQuery.data.id === conversationId
    )
      setConversation(chatQuery.data);
  }
  const unavailable =
    chatQuery.error instanceof DashboardApiError &&
    [403, 404].includes(chatQuery.error.status);
  if (unavailable && conversation && !pending) setConversation(undefined);
  const error =
    actionError || (chatQuery.error ? errorMessage(chatQuery.error) : "");
  const [query, setQuery] = useState(session?.query ?? "");
  const search = useDebouncedValue(query.trim());
  const searchQuery = useQuery({
    ...cache.resource<AskResult>("/ask", {
      query: search,
      projectId:
        scope === "all" ? undefined : scope === "personal" ? null : scope,
      includePersonal: scope === "all" || includePersonal,
      mode: "search",
    }),
    enabled: mode === "search" && !!search,
  });
  const [selected, setSelected] = useState<Pick<
    Memory,
    "id" | "version"
  > | null>(null);
  const request = useRef<AbortController | null>(null);
  const running = useRef(false);
  const conversationElement = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const creation = useRef<string | undefined>(session?.conversationId);
  const filter = {
    projectId:
      scope === "all" ? undefined : scope === "personal" ? null : scope,
    includePersonal,
  };
  useEffect(() => {
    consumeQuestion?.("");
  }, [consumeQuestion, workspace?.question]);
  useEffect(() => {
    sessions?.set(sessionKey, {
      scope,
      includePersonal,
      mode,
      draft,
      query,
      conversationId,
      unconfirmed,
    });
  }, [
    sessions,
    sessionKey,
    scope,
    includePersonal,
    mode,
    draft,
    query,
    conversationId,
    unconfirmed,
  ]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!session?.conversationId) return;
    const controller = new AbortController();
    request.current = controller;
    void api<Conversation>(
      `/conversations/${session.conversationId}`,
      undefined,
      undefined,
      controller.signal,
    )
      .then((chat) => {
        if (!controller.signal.aborted) {
          setConversation(reconcileReply(chat, session.unconfirmed));
          if (chat.turns.some((turn) => turn.id === session.unconfirmed?.id))
            setUnconfirmed(undefined);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session, api]);
  const followReply = useEffectEvent(() => {
    const element = conversationElement.current;
    if (!element || !conversation?.turns.length) return;
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      element.contains(selection.anchorNode)
    )
      following.current = false;
    if (following.current)
      element.scrollTo({ top: element.scrollHeight, behavior: "instant" });
    else setShowLatest(true);
  });
  useEffect(() => {
    followReply();
  }, [conversation, pending, mode]);
  useEffect(() => {
    const element = conversationElement.current;
    if (!element) return;
    const observer = new ResizeObserver(() => followReply());
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode]);
  function reset(clearDraft = true) {
    following.current = true;
    setShowLatest(false);
    request.current?.abort();
    request.current = null;
    running.current = false;
    creation.current = undefined;
    setConversationId(undefined);
    setConversation(undefined);
    setUnconfirmed(undefined);
    setPending(false);
    setLoading(false);
    setError("");
    setSelected(null);
    if (clearDraft) setDraft("");
  }
  function stop() {
    request.current?.abort();
    request.current = null;
    running.current = false;
    setPending(false);
    setConversation(
      (chat) =>
        chat && {
          ...chat,
          turns: chat.turns.map((turn) =>
            turn.status === "pending"
              ? {
                  ...turn,
                  status: "failed",
                  error: "Reply stopped. Try again when you’re ready.",
                }
              : turn,
          ),
        },
    );
  }
  async function openChat(id: string) {
    if (actionBusy) return;
    following.current = true;
    setShowLatest(false);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setPending(false);
    running.current = false;
    setError("");
    try {
      const chat = await api<Conversation>(
        `/conversations/${id}`,
        undefined,
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setConversation(
        reconcileReply(chat, id === conversationId ? unconfirmed : undefined),
      );
      if (
        id !== conversationId ||
        chat.turns.some((turn) => turn.id === unconfirmed?.id)
      )
        setUnconfirmed(undefined);
      setConversationId(id);
      creation.current = id;
      setScope(
        chat.scope.projectId === undefined
          ? "all"
          : (chat.scope.projectId ?? "personal"),
      );
      setPersonal(chat.scope.includePersonal);
      setMode("answer");
      setHistoryOpen(false);
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  async function loadHistory(after?: string) {
    if (historyBusy) return;
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const page = await api<ConversationPage>(
        `/conversations${after ? `?after=${after}` : ""}`,
      );
      setHistory((old) => ({
        ...page,
        items: after
          ? [...(old?.items ?? []), ...page.items].filter(
              (chat, index, all) =>
                all.findIndex((c) => c.id === chat.id) === index,
            )
          : page.items,
      }));
    } catch (e) {
      setHistoryError(errorMessage(e));
    } finally {
      setHistoryBusy(false);
    }
  }
  async function ask(format: "plain" | "markdown", retry?: ConversationTurn) {
    const question = retry?.question ?? draft.trim();
    if (!question || running.current || loading || actionBusy) return;
    following.current = true;
    setShowLatest(false);
    running.current = true;
    setPending(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    const input: ConversationTurnRequest = {
      id: retry?.id ?? crypto.randomUUID(),
      query: question,
      format: retry?.format ?? format,
      expectedVersion: retry?.expectedVersion ?? conversation?.version ?? 0,
    };
    try {
      let chat = conversation;
      if (!chat) {
        creation.current ??= crypto.randomUUID();
        chat = await api<Conversation>(
          "/conversations",
          { id: creation.current, ...filter },
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setConversationId(chat.id);
      }
      const id = chat.id;
      const turn: ConversationTurn = {
        id: input.id,
        question,
        format: input.format,
        expectedVersion: input.expectedVersion,
        status: "pending",
        result: null,
        error: null,
        createdAt: new Date().toISOString(),
      };
      setUnconfirmed(turn);
      setConversation({
        ...chat,
        version: input.expectedVersion + 1,
        turns: retry
          ? chat.turns.map((t) => (t.id === retry.id ? turn : t))
          : [...chat.turns, turn],
      });
      if (!retry) setDraft("");
      const result = await api<Conversation>(
        `/conversations/${id}/turns`,
        input,
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setConversation(result);
        setUnconfirmed(undefined);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        const message = errorMessage(e);
        setError(message);
        setConversation(
          (chat) =>
            chat && {
              ...chat,
              turns: chat.turns.map((turn) =>
                turn.id === input.id
                  ? { ...turn, status: "failed", error: message }
                  : turn,
              ),
            },
        );
      }
    } finally {
      if (request.current === controller) {
        running.current = false;
        setPending(false);
        request.current = null;
      }
    }
  }
  async function apply(turn: ConversationTurn, undo = false) {
    if (!conversation || running.current || actionBusy) return;
    setActionBusy(turn.id);
    setError("");
    try {
      setConversation(
        await api<Conversation>(
          `/conversations/${conversation.id}/turns/${turn.id}/${undo ? "undo" : "apply"}`,
          {},
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setActionBusy(undefined);
    }
  }
  const visibleSearch =
    search === query.trim() && !searchQuery.isPending
      ? {
          result: searchQuery.data,
          error: searchQuery.error
            ? errorMessage(searchQuery.error)
            : undefined,
        }
      : undefined;
  const historyButton = (
    <Button
      variant="secondary"
      aria-label="History"
      disabled={!!actionBusy}
      onClick={() => {
        setHistoryOpen(true);
        void loadHistory();
      }}
    >
      <History size={15} />
      <span>History</span>
    </Button>
  );
  return (
    <>
      {!embedded && (
        <PageHeading
          title="Ask Grove"
          actions={
            <div className="ask-page-actions">
              {historyButton}
              <Button
                variant="secondary"
                aria-label="New conversation"
                disabled={!!actionBusy}
                onClick={() => reset()}
              >
                <Plus size={15} />
                <span>New conversation</span>
              </Button>
            </div>
          }
        />
      )}
      <section className="ask-console" aria-label="Ask Grove console">
        <div className="ask-toolbar">
          <SegmentedControl
            label="Console mode"
            value={mode}
            onChange={(value) => setMode(value)}
            options={[
              {
                value: "answer",
                label: (
                  <>
                    <MessageSquare size={15} />
                    Ask
                  </>
                ),
              },
              {
                value: "search",
                label: (
                  <>
                    <Search size={15} />
                    Search
                  </>
                ),
              },
            ]}
          />
          <div className="ask-scope">
            {projectId === undefined ? (
              <NotebookSelect
                projects={projects}
                aria-label="Look in notebook"
                value={scope}
                disabled={!!actionBusy}
                onValueChange={(value) => {
                  reset(false);
                  setScope(value);
                }}
                leading={[
                  { value: "all", label: "All notes" },
                  { value: "personal", label: "Unfiled" },
                ]}
              />
            ) : (
              <span>
                {projects.find((p) => p.id === projectId)?.name ?? "Unfiled"}
              </span>
            )}
            {scope !== "all" && scope !== "personal" && (
              <label className="ask-personal">
                <input
                  type="checkbox"
                  checked={includePersonal}
                  disabled={!!actionBusy}
                  onChange={(e) => {
                    reset(false);
                    setPersonal(e.target.checked);
                  }}
                />
                Include unfiled notes
              </label>
            )}
          </div>
          {embedded && (
            <Link className="text-button" href="/app/ask">
              All conversations
            </Link>
          )}
        </div>
        {projectError && (
          <p role="alert" className="app-error">
            {projectError}
          </p>
        )}
        {mode === "answer" ? (
          <>
            <div
              className="ask-conversation"
              ref={conversationElement}
              tabIndex={0}
              onScroll={(event) => {
                const element = event.currentTarget;
                const near =
                  element.scrollHeight -
                    element.clientHeight -
                    element.scrollTop <=
                  64;
                following.current = near;
                setShowLatest(!near);
              }}
              role="log"
              aria-label="Conversation"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {loading ? (
                <p role="status">Opening conversation…</p>
              ) : !conversation?.turns.length ? (
                <div className="ask-welcome">
                  <h2>Ask your notes</h2>
                  <div className="ask-suggestions">
                    {[
                      "Find my recent plans",
                      "Help me tidy up my notes",
                      "What should I work on next?",
                    ].map((question) => (
                      <button key={question} onClick={() => setDraft(question)}>
                        <span>{question}</span>
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                conversation.turns.map((turn, index) => (
                  <section className="ask-turn" key={turn.id}>
                    <div className="ask-question">
                      <span>You</span>
                      {turn.format === "markdown" ? (
                        <Markdown>{turn.question}</Markdown>
                      ) : (
                        <p>{turn.question}</p>
                      )}
                    </div>
                    <div className="ask-answer">
                      <div className="ask-answer-label">
                        <Sprout size={17} />
                        Grove
                      </div>
                      {turn.result && (
                        <Answer
                          result={turn.result}
                          onOpen={setSelected}
                          busy={pending || !!actionBusy}
                          onApply={() => void apply(turn)}
                          onUndo={() => void apply(turn, true)}
                        />
                      )}
                      {turn.status === "pending" && pending && (
                        <p className="ask-pending" role="status">
                          Looking through your notes…
                        </p>
                      )}
                      {(turn.status === "failed" ||
                        (turn.status === "pending" && !pending)) && (
                        <div className="ask-error">
                          <p>
                            {turn.error ||
                              "This reply is still in progress. Reopen the conversation to check it."}
                          </p>
                          {index === conversation.turns.length - 1 && (
                            <button
                              className="text-button"
                              disabled={pending || !!actionBusy}
                              onClick={() => void ask(turn.format, turn)}
                            >
                              Try again
                            </button>
                          )}
                          <button
                            className="text-button"
                            disabled={pending || !!actionBusy}
                            onClick={() => void openChat(conversation.id)}
                          >
                            Reload conversation
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                ))
              )}
            </div>
            {showLatest && (
              <div className="ask-reading-controls">
                <button
                  type="button"
                  className="ask-latest"
                  onClick={() => {
                    following.current = true;
                    setShowLatest(false);
                    conversationElement.current?.focus({ preventScroll: true });
                    conversationElement.current?.scrollTo({
                      top: conversationElement.current.scrollHeight,
                      behavior: "instant",
                    });
                  }}
                >
                  <ArrowDown size={16} /> Latest reply
                </button>
              </div>
            )}
            {error && (
              <p className="app-error ask-action-error" role="alert">
                {error}
                {conversationId && !pending && (
                  <button
                    className="text-button"
                    onClick={() => void openChat(conversationId)}
                  >
                    Reload
                  </button>
                )}
              </p>
            )}
            <AskComposer
              value={draft}
              onChange={setDraft}
              onSend={(format) => void ask(format)}
              onStop={stop}
              pending={pending}
              disabled={loading || !!actionBusy}
            />
          </>
        ) : (
          <div className="ask-search">
            <div className="ask-search-header">
              <SearchField
                label="Search saved notes"
                value={query}
                onChange={setQuery}
                placeholder="Find a decision, detail, or idea…"
              />
              <p className="ask-result-count" role="status">
                {!query.trim()
                  ? "Search by words or meaning."
                  : !visibleSearch
                    ? "Searching…"
                    : visibleSearch.error
                      ? "Search couldn’t finish"
                      : `${visibleSearch.result!.sources.length} ${visibleSearch.result!.sources.length === 1 ? "note" : "notes"} found`}
              </p>
            </div>
            <div
              className="ask-search-results"
              aria-busy={!!query.trim() && !visibleSearch}
            >
              {query.trim() &&
                visibleSearch &&
                (visibleSearch.error ? (
                  <LoadError
                    message={visibleSearch.error}
                    title="Search couldn’t finish"
                    retry={() => void searchQuery.refetch()}
                  />
                ) : visibleSearch.result!.sources.length ? (
                  <SourceList
                    sources={visibleSearch.result!.sources}
                    onOpen={setSelected}
                  />
                ) : (
                  <p className="ask-search-empty">
                    No matching notes. Try another phrase or notebook.
                  </p>
                ))}
            </div>
          </div>
        )}
      </section>
      {selected && (
        <MemoryInspector
          id={selected.id}
          citedVersion={selected.version}
          close={() => setSelected(null)}
        />
      )}
      {historyOpen && (
        <Dialog
          title="Conversations"
          close={() => {
            setHistoryOpen(false);
            setDeleting(undefined);
          }}
          busy={historyBusy || loading}
        >
          <div className="ask-history">
            {historyError && (
              <p role="alert" className="app-error">
                {historyError}
                <button
                  className="text-button"
                  onClick={() => void loadHistory()}
                >
                  Retry
                </button>
              </p>
            )}
            {history?.items.map((chat) => (
              <div key={chat.id} className="ask-history-item">
                <button
                  disabled={loading}
                  onClick={() => void openChat(chat.id)}
                >
                  <strong>{chat.title}</strong>
                  <small>
                    {chat.scope.projectId === undefined
                      ? "All notes"
                      : (projects.find((p) => p.id === chat.scope.projectId)
                          ?.name ?? "Unfiled")}{" "}
                    · {new Date(chat.updatedAt).toLocaleDateString()}
                  </small>
                </button>
                <button
                  className="app-icon"
                  aria-label={`Delete conversation ${chat.title}`}
                  onClick={() =>
                    setDeleting(deleting === chat.id ? undefined : chat.id)
                  }
                >
                  <Trash2 size={15} />
                </button>
                {deleting === chat.id && (
                  <div className="ask-delete">
                    <span>Delete this conversation?</span>
                    <button
                      className="text-button"
                      disabled={historyBusy}
                      onClick={async () => {
                        setHistoryBusy(true);
                        setHistoryError("");
                        try {
                          await api(
                            `/conversations/${chat.id}`,
                            undefined,
                            "DELETE",
                          );
                          setHistory(
                            (old) =>
                              old && {
                                ...old,
                                items: old.items.filter(
                                  (c) => c.id !== chat.id,
                                ),
                              },
                          );
                          if (conversationId === chat.id) reset();
                          setDeleting(undefined);
                        } catch (e) {
                          setHistoryError(errorMessage(e));
                        } finally {
                          setHistoryBusy(false);
                        }
                      }}
                    >
                      Delete
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setDeleting(undefined)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
            {historyBusy && <p role="status">Loading…</p>}
            {history && !history.items.length && (
              <p className="ask-search-empty">
                Your conversations will appear here.
              </p>
            )}
            {history?.nextCursor && (
              <Button
                variant="secondary"
                disabled={historyBusy}
                onClick={() => void loadHistory(history.nextCursor!)}
              >
                More conversations
              </Button>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Answer({
  result,
  onOpen,
  onApply,
  onUndo,
  busy,
}: {
  result: ConversationReply;
  onOpen: (source: Pick<Memory, "id" | "version">) => void;
  onApply: () => void;
  onUndo: () => void;
  busy: boolean;
}) {
  const proposal = result.proposal;
  const target = result.sources.find((s) => s.id === proposal?.target?.id);
  return (
    <>
      {result.message && <p className="ask-statement">{result.message}</p>}
      {result.statements.map((statement, index) => (
        <p className="ask-statement" key={index}>
          {statement.text}
          {statement.sources.map((reference) => {
            const source = result.sources.find((s) => s.id === reference.id);
            return source ? (
              <button
                key={reference.id}
                className="ask-citation"
                aria-label={`Read source ${result.sources.indexOf(source) + 1}`}
                title={memoryTitle(source)}
                onClick={() => onOpen(reference)}
              >
                {result.sources.indexOf(source) + 1}
              </button>
            ) : (
              <small key={reference.id} className="ask-answer-note">
                {" "}
                (note unavailable)
              </small>
            );
          })}
        </p>
      ))}
      {proposal && (
        <section className="ask-proposal" aria-label="Proposed note changes">
          <h3>
            {proposal.kind === "create"
              ? "New note"
              : proposal.kind === "merge"
                ? "Merge notes"
                : "Edit note"}
            {target && <span> · {memoryTitle(target)}</span>}
          </h3>
          {proposal.kind === "merge" && (
            <p>
              {proposal.sources.length} notes combined. Originals move to
              Archive.
            </p>
          )}
          {proposal.status === "proposed" && (
            <>
              <details>
                <summary>Review changes</summary>
                <RevisionCompare
                  before={target?.content ?? ""}
                  after={proposal.content}
                  beforeLabel="Current note"
                  afterLabel="Proposed note"
                />
              </details>
              <div className="ask-proposal-preview">
                <Markdown>{proposal.content}</Markdown>
              </div>
              <Button disabled={busy} onClick={onApply}>
                {proposal.kind === "create"
                  ? "Save note"
                  : proposal.kind === "merge"
                    ? "Merge notes"
                    : "Apply edit"}
              </Button>
            </>
          )}
          {proposal.status === "applied" && (
            <div className="ask-applied">
              <span>Saved</span>
              <button disabled={busy} className="text-button" onClick={onUndo}>
                <Undo2 size={14} />
                Undo
              </button>
              {proposal.applied?.find(
                (r) =>
                  r.id === proposal.target?.id || proposal.kind === "create",
              ) && (
                <Link
                  className="text-button"
                  href={`/app/memories/${proposal.target?.id ?? proposal.applied[0].id}`}
                >
                  Open note
                  <ArrowUpRight size={14} />
                </Link>
              )}
            </div>
          )}
          {proposal.status === "undone" && <p>Change undone.</p>}
          {proposal.status === "unavailable" && (
            <p>
              A source note is no longer available. Ask Grove for a new preview.
            </p>
          )}
        </section>
      )}
      {!!result.sources.length && (
        <details
          className="ask-sources"
          open={!result.statements.length && !proposal}
        >
          <summary>
            <BookOpen size={14} />
            {result.sources.length}{" "}
            {result.sources.length === 1 ? "note" : "notes"}
          </summary>
          <SourceList sources={result.sources} onOpen={onOpen} />
        </details>
      )}
    </>
  );
}
function SourceList({
  sources,
  onOpen,
}: {
  sources: Memory[];
  onOpen: (source: Pick<Memory, "id" | "version">) => void;
}) {
  return (
    <ol className="ask-source-list">
      {sources.map((source, index) => (
        <li key={source.id}>
          <button onClick={() => onOpen(source)}>
            <span className="source-number">{index + 1}</span>
            <span>
              <strong>{memoryTitle(source)}</strong>
              <p>{memoryExcerpt(source)}</p>
            </span>
            <ArrowUpRight size={15} />
          </button>
        </li>
      ))}
    </ol>
  );
}
