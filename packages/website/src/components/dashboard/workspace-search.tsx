"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Search,
  ArrowUpRight,
  FileText,
  MessageSquare,
  LoaderCircle,
} from "lucide-react";
import type { ConversationTurn } from "@lib/shared/conversations";
import type { SourceSelection } from "./ask-sources";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { memoryTitle } from "@/lib/memory-display";
import { SearchPassage, SearchTitle } from "./search-passage";
import { notebookPath } from "@/lib/notebooks";
import { useNoteSearch } from "./use-note-search";
import { useNotebooks } from "./notebooks-provider";
import { NotebookSelect } from "./notebook-select";
import { PaletteDialog } from "./ui/palette-dialog";
import { LoadError } from "./load-error";
import { Shortcut } from "./ui/shortcut";
import {
  matchesShortcut,
  shortcutHint,
  shortcuts,
} from "@/lib/workspace-shortcuts";

export type AskSession = {
  conversationDrafts?: Record<
    string,
    {
      draft: string;
      unconfirmed?: ConversationTurn;
      scope?: string;
      includePersonal?: boolean;
      sources?: SourceSelection;
      rejected?: { question: string; sources: SourceSelection };
    }
  >;
  scope: string;
  includePersonal: boolean;
  draft: string;
  sources?: SourceSelection;
  rejected?: { question: string; sources: SourceSelection };
  conversationId?: string;
  unconfirmed?: ConversationTurn;
  query: string;
  searchStopped?: boolean;
  mode: "answer" | "search";
};
const Context = createContext<{
  open: () => void;
  sessions: Map<string, AskSession>;
  question: string;
  setQuestion: (value: string) => void;
} | null>(null);
export const useWorkspaceSearch = () => useContext(Context);

export function WorkspaceSearch({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  const [sessions] = useState(() => new Map<string, AskSession>());
  const [question, setQuestion] = useState("");
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        matchesShortcut(event, shortcuts.search) &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        setOpened(true);
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  return (
    <Context.Provider
      value={{ open: () => setOpened(true), sessions, question, setQuestion }}
    >
      {children}
      {opened && <SearchDialog close={() => setOpened(false)} />}
    </Context.Provider>
  );
}
export function WorkspaceSearchButton() {
  const context = useWorkspaceSearch();
  return (
    <button
      type="button"
      className="workspace-search-launcher"
      aria-label="Search anything"
      title={`Search anything (${shortcutHint(shortcuts.search)})`}
      onClick={context?.open}
    >
      <Search size={16} aria-hidden="true" />
      <span>Search anything</span>
      <Shortcut>{shortcuts.search}</Shortcut>
    </button>
  );
}
function SearchDialog({ close }: { close: () => void }) {
  const context = useWorkspaceSearch()!;
  const { projects } = useNotebooks();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [cancelled, setCancelled] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const cache = useWorkspaceCache();
  const search = query.trim();
  const projectId =
    scope === "all" ? undefined : scope === "personal" ? null : scope;
  const { result: searchQuery, ready } = useNoteSearch(
    search,
    projectId,
    projectId === undefined,
    !cancelled,
  );
  const recentQuery = useInfiniteQuery({
    ...cache.notes({ projectId, limit: 8 }),
    enabled: !search,
    subscribed: !search,
  });
  const activeQuery = search ? searchQuery : recentQuery;
  const current = (search ? ready : !recentQuery.isPending)
    ? {
        items: search
          ? searchQuery.data?.sources
          : recentQuery.data?.pages[0].items,
        error: activeQuery.error ? errorMessage(activeQuery.error) : "",
      }
    : undefined;
  function navigateResults(event: ReactKeyboardEvent) {
    if (
      event.nativeEvent.isComposing ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey ||
      !["ArrowDown", "ArrowUp"].includes(event.key)
    )
      return;
    const links = Array.from(
      results.current?.querySelectorAll<HTMLAnchorElement>(
        ".quick-search-result",
      ) ?? [],
    );
    if (!links.length) return;
    const index = links.indexOf(event.target as HTMLAnchorElement);
    if (index === -1 && event.target !== input.current) return;
    event.preventDefault();
    if (event.key === "ArrowDown")
      links[Math.min(index + 1, links.length - 1)].focus();
    else if (index === 0) input.current?.focus();
    else links[index === -1 ? links.length - 1 : index - 1].focus();
  }
  return (
    <PaletteDialog
      title="Search your Grove"
      close={close}
      search={{
        label: "Search your Grove",
        inputRef: input,
        onKeyDown: navigateResults,
        value: query,
        onChange: (value) => {
          setCancelled(false);
          setQuery(value);
        },
        placeholder: "Search your notes…",
      }}
      footer={
        query.trim() ? (
          <Link
            className="quick-search-ask"
            href="/app/ask"
            onClick={() => {
              context.setQuestion(query.trim());
              close();
            }}
          >
            <MessageSquare size={16} /> Ask Grove about this{" "}
            <ArrowUpRight size={15} />
          </Link>
        ) : (
          <span>Type to search, or open a recent note.</span>
        )
      }
    >
      <div className="quick-search">
        <div className="palette-toolbar">
          <span>Search in</span>
          <NotebookSelect
            aria-label="Search in notebook"
            projects={projects}
            value={scope}
            onValueChange={(value) => {
              setCancelled(false);
              setScope(value);
            }}
            leading={[
              { value: "all", label: "All notes" },
              { value: "personal", label: "Unfiled" },
            ]}
          />
        </div>
        <div
          className="quick-search-results"
          ref={results}
          onKeyDown={navigateResults}
        >
          {cancelled || !current ? (
            <div className="search-feedback">
              {cancelled ? (
                <Search aria-hidden="true" size={22} />
              ) : (
                <LoaderCircle
                  className="motion-safe:animate-spin"
                  aria-hidden="true"
                  size={22}
                />
              )}
              <strong role="status">
                {cancelled
                  ? "Search cancelled"
                  : activeQuery.isPaused
                    ? "Waiting for a connection…"
                    : search
                      ? "Searching…"
                      : "Loading recent notes…"}
              </strong>
              <p>
                {cancelled
                  ? "Your search and notebook are still selected."
                  : activeQuery.isPaused
                    ? "This lookup will resume when you’re back online."
                    : search
                      ? "Looking for matches in your selected notes."
                      : "Finding the notes you updated most recently."}
              </p>
              {!!search && (
                <button
                  type="button"
                  className="app-button secondary"
                  onClick={() => {
                    if (cancelled) input.current?.focus();
                    setCancelled(!cancelled);
                  }}
                >
                  {cancelled ? "Search again" : "Cancel search"}
                </button>
              )}
            </div>
          ) : current.error ? (
            <LoadError
              title={
                search ? "Search couldn’t finish" : "Recent notes couldn’t load"
              }
              message={current.error}
              retry={() => {
                input.current?.focus();
                void activeQuery.refetch();
              }}
            />
          ) : (
            <>
              {!!current.items?.length && (
                <p className="quick-search-caption" role="status">
                  {search
                    ? `${current.items?.length ?? 0} matching ${current.items?.length === 1 ? "note" : "notes"}`
                    : "Recently updated"}
                </p>
              )}
              {current.items?.map((note) => (
                <Link
                  key={note.id}
                  href={`/app/memories/${note.id}`}
                  onClick={close}
                  className="quick-search-result"
                >
                  <FileText size={17} />
                  <span>
                    <strong>
                      <SearchTitle
                        title={memoryTitle(note)}
                        query={search}
                        version={note.version}
                        evidence={searchQuery.data?.matches?.[note.id]}
                      />
                    </strong>
                    <small>
                      {notebookPath(projects, note.projectId)
                        .map((p) => p.name)
                        .join(" / ") || "Unfiled"}
                    </small>
                    <p>
                      <SearchPassage
                        content={note.content}
                        query={search}
                        length={140}
                        version={note.version}
                        evidence={searchQuery.data?.matches?.[note.id]}
                      />
                    </p>
                  </span>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
              {!current.items?.length && (
                <div className="search-feedback">
                  <Search aria-hidden="true" size={22} />
                  <strong role="status">
                    {search ? "No matching notes" : "No recent notes"}
                  </strong>
                  <p>
                    {search
                      ? "Try fewer words or choose another notebook."
                      : "Notes you add to this scope will appear here."}
                  </p>
                  {scope !== "all" && (
                    <button
                      type="button"
                      className="app-button secondary"
                      onClick={() => {
                        input.current?.focus();
                        setScope("all");
                      }}
                    >
                      Search all notes
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PaletteDialog>
  );
}
