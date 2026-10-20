"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  MessageSquare,
  Plus,
  Search,
  Sprout,
  Square,
} from "lucide-react";
import type { AskRequest, AskResult } from "@lib/shared/models";
import type { Memory } from "@lib/shared/contracts";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import {
  memoryExcerpt,
  memoryTitle,
  noteKindLabel,
} from "@/lib/memory-display";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { PageHeading } from "./ui/page-heading";
import { Button } from "./ui/button";
import { SegmentedControl } from "./ui/segmented-control";
import { SearchField } from "./ui/search-field";
import { MemoryInspector } from "./memory-inspector";

type Turn = {
  id: string;
  question: string;
  result?: AskResult;
  error?: string;
};
export function AskGrove({
  projectId,
  embedded = false,
}: {
  projectId?: string | null;
  embedded?: boolean;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectError, setProjectError] = useState("");
  const [scope, setScope] = useState(
    projectId === undefined ? "all" : (projectId ?? "personal"),
  );
  const [includePersonal, setPersonal] = useState(true);
  const [mode, setMode] = useState<AskRequest["mode"]>("answer");
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim());
  const [searchState, setSearch] = useState<{
    key: string;
    result?: AskResult;
    error?: string;
  }>();
  const [selected, setSelected] = useState<Pick<
    Memory,
    "id" | "version"
  > | null>(null);
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const filter = {
    projectId:
      scope === "all" ? undefined : scope === "personal" ? null : scope,
    includePersonal,
  };
  const searchKey = JSON.stringify({ search, scope, includePersonal });
  useEffect(() => {
    const controller = new AbortController();
    api<Project[]>("/projects", undefined, undefined, controller.signal)
      .then(setProjects)
      .catch((error) => {
        if (!controller.signal.aborted) setProjectError(errorMessage(error));
      });
    return () => controller.abort();
  }, []);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [turns, pending]);
  useEffect(() => {
    if (mode !== "search" || !search) return;
    const controller = new AbortController();
    api<AskResult>(
      "/ask",
      {
        query: search,
        projectId:
          scope === "all" ? undefined : scope === "personal" ? null : scope,
        includePersonal,
        mode: "search",
      },
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setSearch({ key: searchKey, result });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setSearch({ key: searchKey, error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [mode, search, scope, includePersonal, searchKey]);
  function reset() {
    request.current?.abort();
    request.current = null;
    setPending(false);
    setTurns([]);
    setDraft("");
    setSelected(null);
  }
  function stop() {
    request.current?.abort();
    request.current = null;
    setPending(false);
    setTurns((current) =>
      current.map((turn) =>
        turn.result || turn.error
          ? turn
          : {
              ...turn,
              error: "Answer stopped. You can try this question again.",
            },
      ),
    );
  }
  async function ask(question = draft.trim(), retryId?: string) {
    if (!question || pending) return;
    const id = retryId ?? crypto.randomUUID();
    const previousQuestions = (
      retryId
        ? turns.slice(
            0,
            turns.findIndex((turn) => turn.id === retryId),
          )
        : turns
    )
      .slice(-4)
      .map((turn) => turn.question);
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setDraft("");
    setTurns((current) =>
      retryId
        ? current.map((turn) => (turn.id === id ? { id, question } : turn))
        : [...current, { id, question }],
    );
    try {
      const result = await api<AskResult>(
        "/ask",
        { ...filter, query: question, previousQuestions, mode: "answer" },
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted)
        setTurns((current) =>
          current.map((turn) => (turn.id === id ? { ...turn, result } : turn)),
        );
    } catch (error) {
      if (!controller.signal.aborted)
        setTurns((current) =>
          current.map((turn) =>
            turn.id === id ? { ...turn, error: errorMessage(error) } : turn,
          ),
        );
    } finally {
      if (request.current === controller) {
        setPending(false);
        request.current = null;
        input.current?.focus();
      }
    }
  }
  const visibleSearch =
    searchState?.key === searchKey ? searchState : undefined;
  const sourceCount = turns.at(-1)?.result?.sources.length;
  return (
    <>
      {!embedded && (
        <PageHeading
          title="Ask Grove"
          description="Find an answer in your own notes."
          actions={
            <Button variant="secondary" onClick={reset}>
              <Plus size={15} />
              New conversation
            </Button>
          }
        />
      )}
      <section className="ask-console" aria-label="Ask Grove console">
        <div className="ask-toolbar">
          <SegmentedControl
            label="Console mode"
            value={mode}
            onChange={(value) => {
              stop();
              setMode(value);
            }}
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
              <label>
                Look in
                <select
                  aria-label="Look in notebook"
                  value={scope}
                  onChange={(event) => {
                    reset();
                    setScope(event.target.value);
                  }}
                >
                  <option value="all">All notes</option>
                  <option value="personal">Personal</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span>
                {projectId
                  ? (projects.find((project) => project.id === projectId)
                      ?.name ?? "This notebook")
                  : "Personal"}
              </span>
            )}
            {scope !== "personal" && scope !== "all" && (
              <label className="ask-personal">
                <input
                  type="checkbox"
                  checked={includePersonal}
                  onChange={(event) => {
                    reset();
                    setPersonal(event.target.checked);
                  }}
                />
                Include personal notes
              </label>
            )}
          </div>
          {embedded && (
            <button
              className="app-icon"
              aria-label="New conversation"
              onClick={reset}
            >
              <Plus size={18} />
            </button>
          )}
        </div>
        {projectError && (
          <p role="alert" className="app-error">
            Notebooks could not load. {projectError}
          </p>
        )}
        {mode === "answer" ? (
          <>
            <div
              className="ask-conversation"
              role="log"
              aria-label="Conversation"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {!turns.length ? (
                <div className="ask-welcome">
                  <span className="ask-mark">
                    <Sprout size={28} strokeWidth={1.4} />
                  </span>
                  <h2>Make sense of what you know.</h2>
                  <p>
                    Revisit a decision, connect a few ideas, or pick up where
                    you left off.
                  </p>
                  <div className="ask-suggestions">
                    {[
                      "What decisions have I made recently?",
                      "What should I work on next?",
                      "How do I prefer to work?",
                    ].map((question) => (
                      <button
                        key={question}
                        onClick={() => {
                          setDraft(question);
                          input.current?.focus();
                        }}
                      >
                        <span>{question}</span>
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                turns.map((turn) => (
                  <section className="ask-turn" key={turn.id}>
                    <div className="ask-question">
                      <span>You</span>
                      <p>{turn.question}</p>
                    </div>
                    <div className="ask-answer">
                      <div className="ask-answer-label">
                        <Sprout size={17} />
                        Grove
                      </div>
                      {turn.result && (
                        <Answer result={turn.result} onOpen={setSelected} />
                      )}
                      {turn.error && (
                        <div className="ask-error" role="alert">
                          <p>{turn.error}</p>
                          <button
                            className="text-button"
                            disabled={pending}
                            onClick={() => void ask(turn.question, turn.id)}
                          >
                            Try again
                          </button>
                        </div>
                      )}
                      {!turn.result && !turn.error && (
                        <p className="ask-pending" role="status">
                          Looking through your notes…
                        </p>
                      )}
                    </div>
                  </section>
                ))
              )}
              <div ref={bottom} />
            </div>
            <form
              className="ask-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void ask();
              }}
            >
              <label className="sr-only" htmlFor="ask-question">
                Ask about your notes
              </label>
              <textarea
                ref={input}
                id="ask-question"
                value={draft}
                maxLength={1000}
                rows={2}
                placeholder="Ask about your notes…"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void ask();
                  }
                }}
              />
              <div className="ask-composer-footer">
                <span>
                  {sourceCount === undefined
                    ? "Answers include links to their sources"
                    : `${sourceCount} ${sourceCount === 1 ? "source" : "sources"} in the latest response`}
                </span>
                {pending ? (
                  <button
                    type="button"
                    className="ask-send"
                    aria-label="Stop answer"
                    onClick={stop}
                  >
                    <Square size={15} />
                  </button>
                ) : (
                  <button
                    className="ask-send"
                    aria-label="Send question"
                    disabled={!draft.trim()}
                  >
                    <ArrowUp size={18} />
                  </button>
                )}
              </div>
            </form>
            <p className="ask-privacy">
              Just a conversation. Your notes stay as you wrote them.
            </p>
          </>
        ) : (
          <div className="ask-search">
            <SearchField
              label="Search saved notes"
              value={query}
              onChange={setQuery}
              placeholder="Find a decision, detail, or idea…"
            />
            <p className="ask-search-caption">Find the pages behind an idea.</p>
            {!search ? (
              <div className="ask-search-empty">
                <Search size={24} />
                <h2>Find your way back.</h2>
                <p>A few words are all you need.</p>
              </div>
            ) : !visibleSearch ? (
              <p role="status">Searching your notes…</p>
            ) : visibleSearch.error ? (
              <p className="app-error" role="alert">
                {visibleSearch.error}
              </p>
            ) : (
              <>
                <p className="ask-result-count">
                  {visibleSearch.result!.sources.length} results ·{" "}
                  {visibleSearch.result!.searchMode === "hybrid"
                    ? "Words + meaning"
                    : "Matching words"}
                </p>
                <SourceList
                  sources={visibleSearch.result!.sources}
                  onOpen={setSelected}
                />
                {!visibleSearch.result!.sources.length && (
                  <p className="ask-search-empty">
                    No matching notes. Try another phrase or notebook.
                  </p>
                )}
              </>
            )}
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
    </>
  );
}
function Answer({
  result,
  onOpen,
}: {
  result: AskResult;
  onOpen: (source: Pick<Memory, "id" | "version">) => void;
}) {
  return (
    <>
      {result.answer?.statements.map((statement, index) => (
        <p className="ask-statement" key={index}>
          {statement.text}
          {statement.sources.map((ref) => (
            <button
              key={ref.id}
              className="ask-citation"
              aria-label={`Read source ${result.sources.findIndex((source) => source.id === ref.id) + 1}`}
              title={memoryTitle(
                result.sources.find((source) => source.id === ref.id)!,
              )}
              onClick={() => onOpen(ref)}
            >
              {result.sources.findIndex((source) => source.id === ref.id) + 1}
            </button>
          ))}
        </p>
      ))}
      {result.status === "no_evidence" && (
        <p>
          I couldn’t find enough in your notes to answer that. Try a more
          specific question or another notebook.
        </p>
      )}
      {result.status === "generation_disabled" && (
        <p>Answers are turned off in Settings. Here are the notes I found.</p>
      )}
      {result.status === "ready" && result.answer?.insufficient && (
        <p className="ask-answer-note">
          The saved context only answers part of this question.
        </p>
      )}
      {!!result.sources.length && (
        <details className="ask-sources">
          <summary>
            <BookOpen size={14} />
            {result.sources.length}{" "}
            {result.sources.length === 1 ? "note" : "notes"} consulted
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
              <small>
                {noteKindLabel(source.kind)} · version {source.version}
              </small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        </li>
      ))}
    </ol>
  );
}
