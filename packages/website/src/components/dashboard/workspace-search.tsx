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
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { memoryTitle, memoryExcerpt } from "@/lib/memory-display";
import { notebookPath } from "@/lib/notebooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { Dialog } from "./dialog";
import { useNotebooks } from "./notebooks-provider";
import { NotebookSelect } from "./notebook-select";
import { SearchField } from "./ui/search-field";
import { LoadError } from "./load-error";
import { Shortcut } from "./workspace-commands";

export type AskSession = {
  scope: string;
  includePersonal: boolean;
  draft: string;
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
        !event.defaultPrevented &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
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
      onClick={context?.open}
    >
      <Search size={16} />
      <span>Search anything</span>
      <Shortcut>Mod K</Shortcut>
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
    <Dialog title="Search your Grove" close={close}>
      <div className="quick-search">
        <SearchField
          label="Search your Grove"
          value={query}
          onChange={setQuery}
          placeholder="A title, a phrase, or an idea…"
        />
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
                  ? `${current.items?.length ?? 0} matching notes`
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
                    <strong>{memoryTitle(note)}</strong>
                    <small>
                      {notebookPath(projects, note.projectId)
                        .map((p) => p.name)
                        .join(" / ") || "Unfiled"}
                    </small>
                    <p>{memoryExcerpt(note, 140)}</p>
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
        <div className="quick-search-footer">
          {query.trim() && (
            <Link
              className="quick-search-ask"
              href="/app/ask"
              onClick={() => {
                context.setQuestion(query.trim());
                close();
              }}
            >
              <MessageSquare size={16} />
              Ask Grove about this
              <ArrowUpRight size={15} />
            </Link>
          )}
        </div>
      </div>
    </Dialog>
  );
}
