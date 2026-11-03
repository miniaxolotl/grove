"use client";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useCallback,
} from "react";
import type {
  DocumentList,
  DocumentSource,
} from "@lib/shared/conversation-documents";
import { AskDocuments } from "./ask-documents";
import { Dialog } from "./dialog";
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
  Undo2,
  Globe,
  AtSign,
} from "lucide-react";
import type { AskResult } from "@lib/shared/models";
import { askToolCatalog } from "@lib/shared/ask-tools";
import type {
  Conversation,
  ConversationReply,
  ConversationTurn,
  ConversationTurnRequest,
  AskTools,
} from "@lib/shared/conversations";
import type { Memory } from "@lib/shared/contracts";
import { DashboardApiError, errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { useQuery } from "@tanstack/react-query";
import { useNotebooks } from "./notebooks-provider";
import { NotebookSelect } from "./notebook-select";
import { memoryExcerpt, memoryTitle } from "@/lib/memory-display";
import { notebookPath } from "@/lib/notebooks";
import { SearchPassage, SearchTitle } from "./search-passage";
import type { SearchMatches } from "@lib/shared/search";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { PageHeading } from "./ui/page-heading";
import { Button } from "./ui/button";
import { SegmentedControl } from "./ui/segmented-control";
import { SearchField } from "./ui/search-field";
import { deferredFeature } from "./deferred-feature";
import { useWorkspaceSearch } from "./workspace-search";
import { AskComposer } from "./ask-composer";
import {
  AskSourcePicker,
  SelectedSources,
  type SourceSelection,
} from "./ask-sources";
import { Markdown } from "./markdown";
import { RevisionCompare } from "./revision-compare";
import { LoadError } from "./load-error";
import {
  AskToolMenu,
  OrganizationPreview,
  LifecyclePreview,
  initialTools,
  researchActivityLabel,
  type ToolCapabilities,
} from "./ask-tools";
const AskHistory = deferredFeature(
  async () => ({ default: (await import("./ask-history")).AskHistory }),
  "Opening history…",
  { failureTitle: "History couldn’t open" },
);
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
  const [sources, setSources] = useState<SourceSelection | undefined>(
    session?.sources,
  );
  const [rejected, setRejected] = useState(session?.rejected);
  const [sourcePicker, setSourcePicker] = useState<"notes" | "notebooks">();
  const mention = useRef<
    { value: string; start: number; end: number } | undefined
  >(undefined);
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
  const conversationDrafts = useRef(session?.conversationDrafts ?? {});
  const reviewFromStart = useRef(false);
  const [actionBusy, setActionBusy] = useState<string>();
  const [toolsBusy, setToolsBusy] = useState(false);
  const toolsRunning = useRef(false);
  const [toolsError, setToolsError] = useState("");
  const [toolsNotice, setToolsNotice] = useState("");
  const [pendingTools, setPendingTools] = useState<AskTools>();
  const capabilities = useQuery(cache.resource<ToolCapabilities>("/ask-tools"));
  const effectiveTools =
    pendingTools ??
    conversation?.tools ??
    capabilities.data?.defaults ??
    initialTools;
  const chatQuery = useQuery({
    ...cache.resource<Conversation>(`/conversations/${conversationId ?? ""}`),
    enabled:
      !!conversationId &&
      !loading &&
      (!unconfirmed || pending) &&
      !actionBusy &&
      !toolsBusy,
    refetchInterval: pending ? 2000 : false,
  });
  const [seenChat, setSeenChat] = useState<Conversation>();
  if (chatQuery.data !== seenChat) {
    setSeenChat(chatQuery.data);
    if (
      chatQuery.data &&
      (!unconfirmed || pending) &&
      (!pending ||
        (chatQuery.data.version >= (conversation?.version ?? 0) &&
          chatQuery.data.turns.some((turn) => turn.id === unconfirmed?.id))) &&
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
  const [selectedDocument, setSelectedDocument] = useState<DocumentSource>();
  const [documentState, setDocumentState] = useState({
    busy: false,
    blocked: false,
    count: 0,
  });
  const documentChanged = useCallback(
    (state: { busy: boolean; blocked: boolean; count: number }) =>
      setDocumentState(state),
    [],
  );
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
      sources,
      rejected,
      query,
      conversationId,
      unconfirmed,
      conversationDrafts: conversationDrafts.current,
    });
  }, [
    sessions,
    sessionKey,
    scope,
    includePersonal,
    mode,
    draft,
    sources,
    rejected,
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
    if (reviewFromStart.current) {
      // Dialog cleanup explicitly hands focus over; a frame alone can run before
      // its deferred opener restoration, even after historyOpen becomes false.
      element.scrollTo({ top: 0, behavior: "instant" });
      setShowLatest(element.scrollHeight > element.clientHeight + 64);
      return;
    }
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
    if (conversationId) rememberDraft(conversationId);
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
    setToolsBusy(false);
    setToolsError("");
    setToolsNotice("");
    setPendingTools(undefined);
    setError("");
    setSelected(null);
    if (clearDraft) {
      const scratch = conversationDrafts.current.new;
      setDraft(scratch?.draft ?? "");
      setSources(scratch?.sources);
      setRejected(scratch?.rejected);
      if (scratch?.scope) {
        setScope(scratch.scope);
        setPersonal(scratch.includePersonal ?? false);
      }
    }
  }
  function rememberDraft(id: string) {
    if (draft || unconfirmed || sources || rejected)
      conversationDrafts.current[id] = {
        draft,
        unconfirmed,
        scope,
        includePersonal,
        sources,
        rejected,
      };
    else delete conversationDrafts.current[id];
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
  async function openChat(id: string, historySignal?: AbortSignal) {
    if (actionBusy || toolsBusy) return;
    const controller = new AbortController();
    const signal = historySignal
      ? AbortSignal.any([historySignal, controller.signal])
      : controller.signal;
    if (!historySignal) {
      request.current?.abort();
      request.current = controller;
      setLoading(true);
      setPending(false);
      running.current = false;
      setError("");
    }
    try {
      const chat = await api<Conversation>(
        `/conversations/${id}`,
        undefined,
        undefined,
        signal,
      );
      if (signal.aborted) return;
      following.current = !historySignal;
      reviewFromStart.current = !!historySignal;
      setShowLatest(false);
      setError("");
      setToolsError("");
      setToolsNotice("");
      if (id !== conversationId) {
        rememberDraft(conversationId ?? "new");
        setDraft(conversationDrafts.current[id]?.draft ?? "");
        setSources(conversationDrafts.current[id]?.sources);
        setRejected(conversationDrafts.current[id]?.rejected);
      }
      const retained =
        id === conversationId
          ? unconfirmed
          : conversationDrafts.current[id]?.unconfirmed;
      setConversation(reconcileReply(chat, retained));
      setUnconfirmed(
        chat.turns.some((turn) => turn.id === retained?.id)
          ? undefined
          : retained,
      );
      setConversationId(id);
      creation.current = id;
      setScope(
        chat.scope.projectId === undefined
          ? "all"
          : (chat.scope.projectId ?? "personal"),
      );
      setPersonal(chat.scope.includePersonal);
      setMode("answer");
    } catch (e) {
      if (historySignal) throw e;
      if (!signal.aborted) setError(errorMessage(e));
    } finally {
      if (!historySignal && !signal.aborted) setLoading(false);
    }
  }
  async function ask(
    format: "plain" | "markdown",
    retry?: ConversationTurn,
    refresh?: ConversationTurn,
  ) {
    const question = refresh?.question ?? retry?.question ?? draft.trim();
    if (
      !question ||
      running.current ||
      loading ||
      actionBusy ||
      toolsError ||
      toolsRunning.current ||
      documentState.busy ||
      documentState.blocked
    )
      return;
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
      ...(refresh || retry?.refreshSources ? { refreshSources: true } : {}),
      ...((refresh ? refresh.context : retry ? retry.context : sources?.context)
        ? {
            context: refresh
              ? refresh.context
              : retry
                ? retry.context
                : sources?.context,
          }
        : {}),
      ...(retry?.documentsVersion !== undefined
        ? { documentsVersion: retry.documentsVersion }
        : {}),
    };
    const sentSources = refresh
      ? selectionFor(refresh)
      : retry
        ? selectionFor(retry)
        : sources;
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
        // The scratch message now belongs to this persisted conversation (and
        // its uncertain-turn identity). Do not revive it as a new draft later.
        delete conversationDrafts.current.new;
      }
      const id = chat.id;
      if (documentState.count || chat.documents?.length) {
        const docs = await api<DocumentList>(`/conversations/${id}/documents`);
        if (docs.documents.length) {
          await api(
            `/conversations/${id}/documents/accept`,
            { expectedVersion: docs.version },
            undefined,
            controller.signal,
          );
          input.documentsVersion = retry?.documentsVersion ?? docs.version;
        }
      }
      const turn: ConversationTurn = {
        id: input.id,
        question,
        format: input.format,
        expectedVersion: input.expectedVersion,
        context: input.context,
        status: "pending",
        result: null,
        error: null,
        createdAt: new Date().toISOString(),
        ...(input.refreshSources ? { refreshSources: true } : {}),
        documentsVersion: input.documentsVersion,
      };
      setUnconfirmed(turn);
      setConversation({
        ...chat,
        version: input.expectedVersion + 1,
        turns: retry
          ? chat.turns.map((t) => (t.id === retry.id ? turn : t))
          : [...chat.turns, turn],
      });
      if (!retry && !refresh) {
        setDraft("");
        setSources(undefined);
      }
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
        if (
          e instanceof DashboardApiError &&
          e.code === "context_unavailable" &&
          sentSources
        ) {
          // This error happens before admission/provider dispatch. Keep the
          // rejected input editable with a fresh operation ID; never broaden it.
          setRejected({ question, sources: sentSources });
          if (!retry) {
            setUnconfirmed(undefined);
            setConversation(
              (chat) =>
                chat && {
                  ...chat,
                  version: input.expectedVersion,
                  turns: chat.turns.filter((turn) => turn.id !== input.id),
                },
            );
          }
          return;
        }
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
  function selectionFor(turn: ConversationTurn): SourceSelection | undefined {
    if (!turn.context) return undefined;
    const labels = Object.fromEntries([
      ...turn.context.notes.map((id) => {
        const note = turn.result?.sources.find((source) => source.id === id);
        return [id, note ? memoryTitle(note) : "Selected note"];
      }),
      ...turn.context.notebooks.map((id) => [
        id,
        projects.find((book) => book.id === id)?.name ?? "Selected notebook",
      ]),
    ]);
    return { context: turn.context, labels };
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
  async function configureTools(tools: AskTools) {
    if (toolsRunning.current || loading || actionBusy) return;
    toolsRunning.current = true;
    if (pending) stop();
    setToolsBusy(true);
    setToolsError("");
    setToolsNotice("");
    setPendingTools(tools);
    try {
      const defaultPatch = Object.fromEntries(
        Object.entries(tools).filter(
          ([key, value]) => effectiveTools[key as keyof AskTools] !== value,
        ),
      );
      // The workspace owns durable writes, so leaving this view does not cancel
      // a save or prevent cache/cross-tab reconciliation after it commits.
      if (conversation) {
        const saved = await api<Conversation>(
          `/conversations/${conversation.id}/tools`,
          {
            tools,
            expectedVersion: conversation.toolsVersion ?? 0,
            saveDefault: true,
            defaultPatch,
          },
          "PATCH",
        );
        setConversation(saved);
      } else await api("/ask-tools", defaultPatch, "PATCH");
      setToolsNotice("Saved for new chats.");
    } catch (e) {
      setToolsError(
        `${errorMessage(e)} Refresh to confirm your saved choices.`,
      );
    } finally {
      toolsRunning.current = false;
      setToolsBusy(false);
      setPendingTools(undefined);
    }
  }
  async function refreshTools() {
    if (toolsRunning.current) return;
    toolsRunning.current = true;
    setToolsBusy(true);
    setToolsError("");
    setToolsNotice("");
    try {
      const [, chat] = await Promise.all([
        capabilities.refetch({ throwOnError: true }),
        conversationId
          ? api<Conversation>(`/conversations/${conversationId}`)
          : undefined,
      ]);
      if (chat) setConversation(chat);
    } catch (e) {
      setToolsError(errorMessage(e));
    } finally {
      toolsRunning.current = false;
      setToolsBusy(false);
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
      disabled={!!actionBusy || pending || loading || toolsBusy}
      onClick={() => setHistoryOpen(true)}
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
                disabled={!!actionBusy || toolsBusy}
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
                disabled={!!actionBusy || toolsBusy}
                onValueChange={(value) => {
                  reset(false);
                  setSources(undefined);
                  setRejected(undefined);
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
                  disabled={!!actionBusy || toolsBusy}
                  onChange={(e) => {
                    reset(false);
                    setSources(undefined);
                    setRejected(undefined);
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
            {conversation?.turns.length ? (
              <div className="ask-current-conversation">
                <h2>{conversation.title}</h2>
                <span>
                  {conversation.turns.length}{" "}
                  {conversation.turns.length === 1 ? "question" : "questions"}
                </span>
              </div>
            ) : null}
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
                  <h2>What’s on your mind?</h2>
                  <div className="ask-suggestions">
                    {[
                      "Find my recent plans",
                      "Research a topic for a note",
                      "Organize my unfiled notes",
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
                      {turn.context && (
                        <p className="ask-context-summary">
                          {turn.context.only
                            ? "Selected sources only"
                            : "Selected + automatic sources"}
                        </p>
                      )}
                    </div>
                    <div className="ask-answer">
                      <div className="ask-answer-label">
                        <Sprout size={17} />
                        Grove
                      </div>
                      {turn.context && (
                        <>
                          <ContextDetails turn={turn} />
                          <button
                            type="button"
                            className="text-button ask-add-sources"
                            title={
                              draft.trim() || sources
                                ? "Send or clear the current draft before revising this question’s sources."
                                : "Revise this question with more sources"
                            }
                            disabled={
                              pending ||
                              !!actionBusy ||
                              !!draft.trim() ||
                              !!sources
                            }
                            onClick={() => {
                              setDraft(turn.question);
                              setSources(selectionFor(turn));
                              setSourcePicker("notes");
                            }}
                          >
                            Add sources
                            <span className="sr-only">
                              {" "}
                              for question {index + 1}
                            </span>
                          </button>
                        </>
                      )}
                      {turn.result && (
                        <Answer
                          result={turn.result}
                          onOpen={setSelected}
                          onOpenDocument={setSelectedDocument}
                          busy={pending || !!actionBusy}
                          canApply={effectiveTools.organize}
                          onApply={() => void apply(turn)}
                          onUndo={() => void apply(turn, true)}
                        />
                      )}
                      {turn.result?.usage ? (
                        <p className="ask-answer-note">
                          {turn.result.usage.status === "cached"
                            ? "Cached"
                            : turn.result.usage.status === "mixed"
                              ? "Partly cached"
                              : "Fresh"}
                          {turn.result.usage.actions !== null
                            ? ` · ${turn.result.usage.actions} ${turn.result.usage.actions === 1 ? "action" : "actions"}`
                            : ""}
                        </p>
                      ) : null}
                      {turn.status === "ready" &&
                      turn.result &&
                      !turn.result.proposal &&
                      !turn.result.organization &&
                      !turn.result.lifecycle &&
                      index === conversation.turns.length - 1 ? (
                        <button
                          type="button"
                          className="text-button"
                          disabled={
                            pending || loading || !!actionBusy || toolsBusy
                          }
                          title="Read current notes and refresh web sources. Fresh work uses one Ask action."
                          onClick={() => void ask(turn.format, undefined, turn)}
                        >
                          Refresh sources
                        </button>
                      ) : null}
                      {turn.toolRuns?.some(
                        (run) => run.status === "limited",
                      ) && (
                        <p className="ask-answer-note" role="status">
                          Research allowance reached. You can continue with your
                          saved notes.
                        </p>
                      )}
                      {turn.status === "pending" && pending && (
                        <p className="ask-pending" role="status">
                          {researchActivityLabel(turn.toolRuns)}
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
            {rejected && (
              <div className="ask-context-recovery" role="status">
                <p>
                  A selected source is unavailable. Your question and choices
                  are kept.
                </p>
                <p>{rejected.question}</p>
                <button
                  type="button"
                  className="text-button"
                  disabled={pending || !!draft.trim() || !!sources}
                  onClick={() => {
                    setDraft(rejected.question);
                    setSources(rejected.sources);
                    setRejected(undefined);
                    setError("");
                    setSourcePicker("notes");
                  }}
                >
                  Edit sources
                </button>
                {(draft.trim() || sources) && (
                  <small>Send or clear your current draft first.</small>
                )}
              </div>
            )}
            <AskDocuments
              conversationId={conversationId}
              ensureChat={async () => {
                if (conversationId) return conversationId;
                creation.current ??= crypto.randomUUID();
                const chat = await api<Conversation>("/conversations", {
                  id: creation.current,
                  ...filter,
                });
                setConversation(chat);
                setConversationId(chat.id);
                return chat.id;
              }}
              disabled={pending || loading || !!actionBusy}
              onState={documentChanged}
            />
            <AskComposer
              value={draft}
              onChange={setDraft}
              onSend={(format) => void ask(format)}
              onStop={stop}
              pending={pending}
              disabled={loading || !!actionBusy}
              sendDisabled={
                toolsBusy ||
                !!toolsError ||
                documentState.busy ||
                documentState.blocked ||
                (!!sources &&
                  !sources.context.notes.length &&
                  !sources.context.notebooks.length)
              }
              onMention={(kind, value, start, end) => {
                mention.current = { value, start, end };
                setSourcePicker(kind);
              }}
              sources={
                sources && (
                  <SelectedSources
                    selection={sources}
                    onChange={setSources}
                    disabled={loading || !!actionBusy}
                    replace={() => {
                      mention.current = undefined;
                      setSourcePicker("notes");
                    }}
                  />
                )
              }
              tools={
                <>
                  <button
                    type="button"
                    className="text-button ask-sources-button"
                    aria-label="Sources"
                    disabled={loading || !!actionBusy}
                    onClick={() => {
                      mention.current = undefined;
                      setSourcePicker("notes");
                    }}
                    title="Choose sources (@note or @notebook)"
                  >
                    <AtSign size={16} /> <span>Sources</span>
                  </button>
                  <AskToolMenu
                    tools={effectiveTools}
                    available={capabilities.data?.available}
                    busy={
                      toolsBusy ||
                      loading ||
                      !!actionBusy ||
                      capabilities.isPending
                    }
                    error={
                      toolsError ||
                      (capabilities.error
                        ? "Tools could not load. Refresh to try again."
                        : undefined)
                    }
                    onChange={(tools) => void configureTools(tools)}
                    notice={toolsNotice}
                    onRetry={() => void refreshTools()}
                  />
                </>
              }
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
              {visibleSearch?.result?.usage ? (
                <p className="ask-answer-note">
                  {visibleSearch.result.usage.status === "cached"
                    ? "Cached"
                    : visibleSearch.result.usage.status === "mixed"
                      ? "Partly cached"
                      : "Fresh"}
                  {visibleSearch.result.usage.actions !== null
                    ? ` · ${visibleSearch.result.usage.actions} ${visibleSearch.result.usage.actions === 1 ? "action" : "actions"}`
                    : ""}
                </p>
              ) : null}
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
                    query={search}
                    sources={visibleSearch.result!.sources}
                    matches={visibleSearch.result!.matches}
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
      {sourcePicker && (
        <AskSourcePicker
          initialKind={sourcePicker}
          scope={scope}
          includePersonal={includePersonal}
          selection={sources}
          close={() => {
            setSourcePicker(undefined);
            mention.current = undefined;
          }}
          onChange={(next) => {
            setSources(next);
            const token = mention.current;
            // The modal prevents edits while choosing. Still fence against a
            // different draft being restored before removing the mention trigger.
            if (token)
              setDraft((current) =>
                current === token.value
                  ? current.slice(0, token.start) + current.slice(token.end)
                  : current,
              );
            mention.current = undefined;
          }}
        />
      )}
      {selectedDocument && (
        <Dialog
          title={selectedDocument.filename}
          close={() => setSelectedDocument(undefined)}
        >
          <p>
            {/\.pdf$/i.test(selectedDocument.filename)
              ? `Pages ${selectedDocument.pageStart}–${selectedDocument.pageEnd}`
              : `Part ${selectedDocument.ordinal + 1}`}
          </p>
          <div className="ask-document-excerpt">{selectedDocument.content}</div>
          <a
            className="text-button"
            href={`/api/grove/conversations/${conversationId}/documents/${selectedDocument.documentId}/original`}
          >
            Download original
          </a>
        </Dialog>
      )}
      {historyOpen && (
        <AskHistory
          onDismissed={() => {
            const element = conversationElement.current;
            if (!reviewFromStart.current || !element?.isConnected) return;
            reviewFromStart.current = false;
            element.scrollTo({ top: 0, behavior: "instant" });
            element.focus({ preventScroll: true });
          }}
          projects={projects}
          currentId={conversationId}
          onOpen={openChat}
          close={() => setHistoryOpen(false)}
          onDeleted={(id) => {
            if (conversationId === id) reset();
            delete conversationDrafts.current[id];
          }}
        />
      )}
    </>
  );
}

function Answer({
  result,
  onOpen,
  onOpenDocument,
  onApply,
  onUndo,
  busy,
  canApply,
}: {
  result: ConversationReply;
  onOpen: (source: Pick<Memory, "id" | "version">) => void;
  onOpenDocument: (source: DocumentSource) => void;
  onApply: () => void;
  onUndo: () => void;
  busy: boolean;
  canApply: boolean;
}) {
  const proposal = result.proposal;
  const target = result.sources.find((s) => s.id === proposal?.target?.id);
  return (
    <>
      {result.message && <p className="ask-statement">{result.message}</p>}
      {result.documentStatements?.map((statement, index) => (
        <p
          className="ask-statement ask-document-evidence"
          key={`document-${index}`}
        >
          {statement.text}
          {statement.sources.map((ref) => {
            const source = result.documentSources?.find(
              (s) => s.id === ref.id && s.version === ref.version,
            );
            return source ? (
              <button
                className="ask-citation"
                key={ref.id}
                onClick={() => onOpenDocument(source)}
              >
                {source.filename}
                {/\.pdf$/i.test(source.filename)
                  ? ` · p. ${source.pageStart}`
                  : ` · part ${source.ordinal + 1}`}
              </button>
            ) : null;
          })}
        </p>
      ))}
      {result.documentCoverage?.partial && (
        <p className="ask-answer-note">
          Based on {result.documentCoverage.shown} of{" "}
          {result.documentCoverage.total} extracted passages. Ask about a
          specific section for more detail.
        </p>
      )}
      {result.documentContext && (result.proposal || result.organization) && (
        <p className="ask-answer-note">
          Generated from document passages, not a full-text import. Review
          before saving. Saved text follows the notebook’s sharing settings;
          original files stay private.
        </p>
      )}
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
      {(result.webStatements ?? []).map((statement, index) => (
        <p className="ask-statement" key={`web-${index}`}>
          {statement.text}
          {statement.urls.map((url) => {
            const source = result.webSources?.find(
              (source) => source.url === url,
            );
            return source ? (
              <a
                className="ask-citation"
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title={source.title}
                aria-label={`Open web source ${source.title}`}
              >
                <Globe size={12} />
                {result.webSources!.indexOf(source) + 1}
              </a>
            ) : null;
          })}
        </p>
      ))}
      {result.researchIncomplete && (
        <p className="ask-answer-note" role="status">
          Web research was incomplete. You can retry, change tools, or continue
          with your notes.
        </p>
      )}
      {result.organization && (
        <OrganizationPreview
          proposal={result.organization}
          sources={result.sources}
          busy={busy}
          canApply={canApply}
          onApply={onApply}
          onUndo={onUndo}
        />
      )}
      {result.lifecycle && (
        <LifecyclePreview
          proposal={result.lifecycle}
          sources={result.sources}
          busy={busy}
          canApply={canApply}
          onApply={onApply}
          onUndo={onUndo}
        />
      )}
      {!canApply &&
        (proposal?.status === "proposed" ||
          result.organization?.status === "proposed" ||
          result.lifecycle?.status === "proposed") && (
          <p className="ask-answer-note">
            Enable {askToolCatalog.organize.label} in Tools to apply these
            changes.
          </p>
        )}
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
              {proposal.kind !== "create" && (
                <details>
                  <summary>Review changes</summary>
                  <RevisionCompare
                    before={target?.content ?? ""}
                    after={proposal.content}
                    beforeLabel="Current note"
                    afterLabel="Proposed note"
                  />
                </details>
              )}
              <div className="ask-proposal-preview">
                <Markdown>{proposal.content}</Markdown>
              </div>
              <Button disabled={busy || !canApply} onClick={onApply}>
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
          open={
            !result.statements.length &&
            !proposal &&
            !result.organization &&
            !result.lifecycle
          }
        >
          <summary>
            <BookOpen size={14} />
            {result.sources.length}{" "}
            {result.sources.length === 1 ? "note" : "notes"}
            {result.contextCoverage && " provided as evidence"}
          </summary>
          <SourceList
            sources={result.sources}
            onOpen={onOpen}
            cited={
              result.contextCoverage
                ? new Set(
                    result.statements.flatMap((statement) =>
                      statement.sources.map(
                        (source) => `${source.id}:${source.version}`,
                      ),
                    ),
                  )
                : undefined
            }
          />
        </details>
      )}
      {!!result.webSources?.length && (
        <details className="ask-sources">
          <summary>
            <Globe size={14} />
            {result.webSources.length} web{" "}
            {result.webSources.length === 1 ? "source" : "sources"}
          </summary>
          <ol className="ask-source-list ask-web-sources">
            {result.webSources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  <span>
                    <strong>{source.title}</strong>
                    <small>
                      {askToolCatalog[source.provider].label} ·{" "}
                      {source.kind === "page"
                        ? "Page extract"
                        : "Search result"}{" "}
                      · {new Date(source.retrievedAt).toLocaleDateString()}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}
function SourceList({
  sources,
  onOpen,
  query,
  cited,
  matches,
}: {
  sources: Memory[];
  onOpen: (source: Pick<Memory, "id" | "version">) => void;
  query?: string;
  cited?: Set<string>;
  matches?: SearchMatches;
}) {
  const { projects } = useNotebooks();
  return (
    <ol className="ask-source-list">
      {sources.map((source, index) => (
        <li key={source.id}>
          <button onClick={() => onOpen(source)}>
            <span className="source-number">{index + 1}</span>
            <span>
              <strong>
                <SearchTitle
                  title={memoryTitle(source)}
                  query={query ?? ""}
                  version={source.version}
                  evidence={matches?.[source.id]}
                />
              </strong>
              {cited && (
                <small>
                  Version {source.version} ·{" "}
                  {cited.has(`${source.id}:${source.version}`)
                    ? "Cited in answer"
                    : "Provided, not cited"}
                </small>
              )}
              {query !== undefined && (
                <small>
                  {notebookPath(projects, source.projectId)
                    .map((p) => p.name)
                    .join(" / ") || "Unfiled"}
                </small>
              )}
              <p>
                {query !== undefined ? (
                  <SearchPassage
                    content={source.content}
                    query={query}
                    version={source.version}
                    evidence={matches?.[source.id]}
                  />
                ) : (
                  memoryExcerpt(source)
                )}
              </p>
            </span>
            <ArrowUpRight size={15} />
          </button>
        </li>
      ))}
    </ol>
  );
}

function ContextDetails({ turn }: { turn: ConversationTurn }) {
  const { projects } = useNotebooks();
  const context = turn.context!;
  const coverage = turn.result?.contextCoverage;
  return (
    <div className="ask-context-details">
      <p className="ask-context-summary">
        {context.only
          ? "Selected sources only"
          : "Selected + automatic sources"}
      </p>
      <details>
        <summary>
          Selected scope · {context.notes.length}{" "}
          {context.notes.length === 1 ? "note" : "notes"},{" "}
          {context.notebooks.length}{" "}
          {context.notebooks.length === 1 ? "notebook" : "notebooks"}
        </summary>
        <ul>
          {context.notes.map((id) => {
            const source = turn.result?.sources.find((note) => note.id === id);
            return (
              <li key={id}>
                Note:{" "}
                {source
                  ? memoryTitle(source)
                  : "Unavailable or not yet provided"}
              </li>
            );
          })}
          {context.notebooks.map((id) => (
            <li key={id}>
              Notebook:{" "}
              {notebookPath(projects, id)
                .map((book) => book.name)
                .join(" / ") || "Unavailable notebook"}{" "}
              (direct notes only)
            </li>
          ))}
        </ul>
        <p className="ask-context-summary">
          Citations identify supporting notes, not every note provided to the
          model.
        </p>
      </details>
      {coverage && (
        <p className="ask-context-summary">
          {coverage.provided} of {coverage.eligible} selected-scope notes
          provided as evidence.
          {coverage.partial
            ? " Partial coverage; not a complete notebook review."
            : ""}
          {coverage.notebookEligible > 0 && coverage.notebookProvided === 0
            ? " Pinned notes filled the budget; no additional notebook notes were provided."
            : ""}
        </p>
      )}
    </div>
  );
}
