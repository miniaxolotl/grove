"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Search, ArrowUpRight, FileText, MessageSquare } from "lucide-react";
import type { Memory, Page } from "@lib/shared/contracts";
import type { AskResult } from "@lib/shared/models";
import type { ConversationTurn } from "@lib/shared/conversations";
import { api, errorMessage } from "@/lib/dashboard-api";
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
  const [retry, setRetry] = useState(0);
  const search = useDebouncedValue(query.trim());
  const key = JSON.stringify({ search, scope, retry });
  const [result, setResult] = useState<{
    key: string;
    items?: Memory[];
    error?: string;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    const projectId =
      scope === "all" ? undefined : scope === "personal" ? null : scope;
    const load = search
      ? api<AskResult>(
          "/ask",
          {
            query: search,
            projectId,
            includePersonal: projectId === undefined,
            mode: "search",
          },
          undefined,
          controller.signal,
        ).then((result) => result.sources)
      : api<Page<Memory>>(
          "/memories/search",
          { projectId, status: "active", sort: "updated_desc", limit: 8 },
          undefined,
          controller.signal,
        ).then((result) => result.items);
    void load
      .then((items) => {
        if (!controller.signal.aborted) setResult({ key, items });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ key, error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [key, search, scope]);
  const current =
    search === query.trim() && result?.key === key ? result : undefined;
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
              retry={() => setRetry((value) => value + 1)}
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
