"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search, ArrowUpRight, FileText, MessageSquare } from "lucide-react";
import type { AskResult } from "@lib/shared/models";
import type { ConversationTurn } from "@lib/shared/conversations";
import type { SourceSelection } from "./ask-sources";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { memoryTitle } from "@/lib/memory-display";
import { SearchPassage, SearchTitle } from "./search-passage";
import { notebookPath } from "@/lib/notebooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";
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
  const cache = useWorkspaceCache();
  const search = useDebouncedValue(query.trim());
  const projectId =
    scope === "all" ? undefined : scope === "personal" ? null : scope;
  const searchQuery = useQuery({
    ...cache.resource<AskResult>("/ask", {
      query: search,
      projectId,
      includePersonal: projectId === undefined,
      mode: "search",
    }),
    enabled: !!search,
  });
  const recentQuery = useInfiniteQuery({
    ...cache.notes({ projectId, limit: 8 }),
    enabled: !search,
  });
  const activeQuery = search ? searchQuery : recentQuery;
  const current =
    search === query.trim() && !activeQuery.isPending
      ? {
          items: search
            ? searchQuery.data?.sources
            : recentQuery.data?.pages[0].items,
          error: activeQuery.error ? errorMessage(activeQuery.error) : "",
        }
      : undefined;
  return (
    <PaletteDialog
      title="Search your Grove"
      close={close}
      search={{
        label: "Search your Grove",
        value: query,
        onChange: setQuery,
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
          <span>Find a thought. Pick up where you left off.</span>
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
            onValueChange={setScope}
            leading={[
              { value: "all", label: "All notes" },
              { value: "personal", label: "Unfiled" },
            ]}
          />
        </div>
        <div className="quick-search-results" aria-busy={!current}>
          {!current ? (
            <p role="status">Searching…</p>
          ) : current.error ? (
            <LoadError
              message={current.error}
              retry={() => void activeQuery.refetch()}
            />
          ) : (
            <>
              <p className="quick-search-caption">
                {search
                  ? `${current.items?.length ?? 0} matching ${current.items?.length === 1 ? "note" : "notes"}`
                  : "Recently updated"}
              </p>
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
                <p className="quick-search-empty">
                  No notes found. Try another phrase or notebook.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </PaletteDialog>
  );
}
