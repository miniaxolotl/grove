"use client";
import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { paletteSessionKey, useWorkspaceSearch } from "./workspace-search";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Search,
  ArrowUpRight,
  FileText,
  MessageSquare,
  LoaderCircle,
} from "lucide-react";
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
export default function SearchDialog({ close }: { close: () => void }) {
  const context = useWorkspaceSearch()!;
  const router = useRouter();
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
  const {
    result: searchQuery,
    ready,
    previous,
  } = useNoteSearch(search, projectId, projectId === undefined, !cancelled);
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
  // A refined phrase keeps the previous matches visible, dimmed, until it lands.
  const refining = !cancelled && !current && !!search ? previous : undefined;
  const shown = refining
    ? {
        items: refining.data.sources,
        query: refining.query,
        matches: refining.data.matches,
      }
    : current
      ? {
          items: current.items,
          query: search,
          matches: searchQuery.data?.matches,
        }
      : undefined;
  const pendingLabel = activeQuery.isPaused
    ? "Waiting for a connection…"
    : search
      ? "Searching…"
      : "Loading recent notes…";
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
        search ? (
          <button
            type="button"
            className="quick-search-ask"
            onClick={() => {
              const id = crypto.randomUUID();
              context.sessions.set(paletteSessionKey(id), {
                scope,
                includePersonal: projectId === undefined,
                mode: "answer",
                draft: search,
                query: "",
              });
              router.push(`/app/ask?draft=${id}`);
              close();
            }}
          >
            <MessageSquare size={16} /> Ask Grove about this{" "}
            <ArrowUpRight size={15} />
          </button>
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
          {cancelled ? (
            <div className="search-feedback">
              <Search aria-hidden="true" size={22} />
              <strong role="status">Search cancelled</strong>
              <p>Your search and notebook are still selected.</p>
              <button
                type="button"
                className="app-button secondary"
                onClick={() => {
                  input.current?.focus();
                  setCancelled(false);
                }}
              >
                Search again
              </button>
            </div>
          ) : !refining && !current ? (
            // A quiet status line instead of a full-panel spinner.
            <div className="quick-search-caption">
              <p role="status" className="quick-search-pending">
                <LoaderCircle
                  className="motion-safe:animate-spin"
                  aria-hidden="true"
                  size={14}
                />
                <span>{pendingLabel}</span>
              </p>
              {!!search && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setCancelled(true)}
                >
                  Cancel search
                </button>
              )}
            </div>
          ) : !refining && current?.error ? (
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
            <div className="quick-search-list" aria-busy={!!refining}>
              {!!shown?.items?.length && (
                <div className="quick-search-caption">
                  <p role="status">
                    {refining
                      ? pendingLabel
                      : search
                        ? `${shown.items.length} matching ${shown.items.length === 1 ? "note" : "notes"}`
                        : "Recently updated"}
                  </p>
                  {refining && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setCancelled(true)}
                    >
                      Cancel search
                    </button>
                  )}
                </div>
              )}
              {shown?.items?.map((note) => (
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
                        query={shown.query}
                        version={note.version}
                        evidence={shown.matches?.[note.id]}
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
                        query={shown.query}
                        length={140}
                        version={note.version}
                        evidence={shown.matches?.[note.id]}
                      />
                    </p>
                  </span>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
              {!shown?.items?.length && (
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
            </div>
          )}
        </div>
      </div>
    </PaletteDialog>
  );
}
