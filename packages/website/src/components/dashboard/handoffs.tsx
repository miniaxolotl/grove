"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, Search } from "lucide-react";
import type { Memory, Page } from "@lib/shared/contracts";
import { api, errorMessage } from "@/lib/dashboard-api";
import { dateLabel, memoryTitle } from "@/lib/memory-display";
import { BriefPanel } from "./brief";
import { LoadError } from "./load-error";

export function Handoffs({
  projectId,
  onCreate,
}: {
  projectId: string | null;
  onCreate: () => void;
}) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [selected, setSelected] = useState<Memory | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  function reload(searchText = search) {
    activeRequest.current?.abort();
    setLoading(true);
    setError("");
    setMemories([]);
    setSelected(null);
    setNext(null);
    setSearch(searchText);
    setRefresh((value) => value + 1);
  }
  useEffect(() => {
    const controller = new AbortController();
    activeRequest.current = controller;
    api<Page<Memory>>(
      "/memories/search",
      {
        projectId,
        kind: "handoff",
        status: "active",
        query: search || undefined,
      },
      undefined,
      controller.signal,
    )
      .then((page) => {
        if (!controller.signal.aborted) {
          setMemories(page.items);
          setNext(page.nextCursor);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, search, refresh]);
  return (
    <section>
      <div className="workspace-section-heading">
        <div>
          <h2>Pick up where you left off</h2>
          <p>
            A handoff records a task’s progress, blockers, and next steps for
            you and your agents.
          </p>
        </div>
        <button className="app-button secondary" onClick={onCreate}>
          <Plus size={16} />
          New handoff
        </button>
      </div>
      <form
        className="app-search mb-5"
        onSubmit={(e) => {
          e.preventDefault();
          reload(query.trim());
        }}
      >
        <Search size={17} />
        <input
          aria-label="Search handoffs"
          value={query}
          maxLength={1000}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a task by its name or content…"
        />
        <button>Search</button>
      </form>
      {error && <LoadError message={error} retry={() => reload()} />}
      {loading && !memories.length ? (
        <p role="status">Loading handoffs…</p>
      ) : !memories.length && !error ? (
        <div className="app-empty">
          <h3 className="font-editorial text-2xl">
            {search ? "No matching handoffs." : "Leave a good starting point."}
          </h3>
          <p>
            Write down what’s done and what comes next. Grove keeps the task
            reference for you.
          </p>
          <button className="app-button mt-5" onClick={onCreate}>
            Create a handoff
          </button>
        </div>
      ) : (
        <ul className="handoff-list">
          {memories.map((memory) => (
            <li key={memory.id}>
              <button
                aria-pressed={selected?.id === memory.id}
                onClick={() => setSelected(memory)}
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
          onClick={async () => {
            const controller = activeRequest.current;
            if (!controller || loading) return;
            setLoading(true);
            try {
              const page = await api<Page<Memory>>(
                "/memories/search",
                {
                  projectId,
                  kind: "handoff",
                  status: "active",
                  query: search || undefined,
                  cursor: next,
                },
                undefined,
                controller.signal,
              );
              if (!controller.signal.aborted) {
                setMemories((old) => [...old, ...page.items]);
                setNext(page.nextCursor);
              }
            } catch (e) {
              if (!controller.signal.aborted) setError(errorMessage(e));
            } finally {
              if (!controller.signal.aborted) setLoading(false);
            }
          }}
        >
          Load more handoffs
        </button>
      )}
      {selected?.taskId && (
        <div className="mt-6" key={`${selected.id}:${selected.version}`}>
          <div className="workspace-section-heading">
            <h3>{memoryTitle(selected)}</h3>
            <Link className="text-button" href={`/app/memories/${selected.id}`}>
              Read or edit the handoff
            </Link>
          </div>
          <BriefPanel projectId={projectId} taskId={selected.taskId} />
        </div>
      )}
      <details className="agent-details mt-6">
        <summary>How handoffs work</summary>
        <p>
          The title is for you. A stable task reference lets agents update the
          same handoff across sessions instead of creating duplicates. Grove
          creates the reference automatically; you can find it under Agent
          details on the memory.
        </p>
        <p>
          Handoffs stay in active recall for 30 days and are removed after 90.
          Use an ordinary memory for something you want to keep.
        </p>
      </details>
    </section>
  );
}
