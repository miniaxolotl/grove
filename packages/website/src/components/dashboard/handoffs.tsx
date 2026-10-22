"use client";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { dateLabel, memoryTitle } from "@/lib/memory-display";
import { BriefPanel } from "./brief";
import { LoadError } from "./load-error";
import { SearchField } from "./ui/search-field";
import { useDebouncedValue } from "@/lib/use-debounced-value";

export function Handoffs({
  projectId,
  onCreate,
}: {
  projectId: string | null;
  onCreate: () => void;
}) {
  const [selectedId, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim());
  const cache = useWorkspaceCache();
  const notes = useInfiniteQuery(
    cache.notes({ projectId, kind: "handoff", query: search }),
  );
  const memories = notes.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = memories.find((note) => note.id === selectedId);
  const error = notes.error ? errorMessage(notes.error) : "";
  const loading = notes.isPending || notes.isFetchingNextPage;
  const next = notes.hasNextPage;
  function reload() {
    void notes.refetch();
  }
  return (
    <section>
      <div className="workspace-section-heading">
        <div>
          <h2>Pick up where you left off</h2>
          <p>What’s done, what’s next, and where to begin again.</p>
        </div>
        <button className="app-button secondary" onClick={onCreate}>
          <Plus size={16} />
          New progress note
        </button>
      </div>
      <SearchField
        className="mb-5"
        label="Search progress notes"
        value={query}
        onChange={setQuery}
        placeholder="Find a task by its name or content…"
      />
      {error && <LoadError message={error} retry={() => reload()} />}
      {loading && !memories.length ? (
        <p role="status">Opening your notes…</p>
      ) : !memories.length && !error ? (
        <div className="app-empty">
          <h3 className="font-editorial text-2xl">
            {search ? "No matching notes." : "Leave a good starting point."}
          </h3>
          <p>Write down what’s done and what comes next.</p>
          <button className="app-button mt-5" onClick={onCreate}>
            Write a progress note
          </button>
        </div>
      ) : (
        <ul className="handoff-list">
          {memories.map((memory) => (
            <li key={memory.id}>
              <button
                aria-pressed={selected?.id === memory.id}
                onClick={() => setSelected(memory.id)}
              >
                <span>
                  <strong>{memoryTitle(memory)}</strong>
                  <span>
                    Updated {dateLabel(memory.updatedAt)}
                    {memory.expiresAt
                      ? ` · Active until ${dateLabel(memory.expiresAt)}`
                      : ""}
                  </span>
                </span>
                <ArrowRight size={17} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <button
          className="app-button secondary mt-4"
          disabled={loading}
          onClick={() => void notes.fetchNextPage()}
        >
          Earlier progress notes
        </button>
      )}
      {selected?.taskId && (
        <div className="mt-6" key={`${selected.id}:${selected.version}`}>
          <div className="workspace-section-heading">
            <h3>{memoryTitle(selected)}</h3>
            <Link className="text-button" href={`/app/memories/${selected.id}`}>
              Read or edit this note
            </Link>
          </div>
          <BriefPanel projectId={projectId} taskId={selected.taskId} />
        </div>
      )}
      <details className="agent-details mt-6">
        <summary>How this works with agents</summary>
        <p>
          The title is for you. A stable task reference lets agents update the
          same handoff across sessions instead of creating duplicates. Grove
          creates the reference automatically; you can find it under Agent
          details on the memory.
        </p>
        <p>
          Progress notes are kept for 30 days by default. In Note options,
          choose a different duration or keep a note until you remove it.
          Expired notes can be restored for 60 days.
        </p>
      </details>
    </section>
  );
}
