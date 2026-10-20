"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Feather, Plus } from "lucide-react";
import Link from "next/link";
import type { Memory, Page } from "@lib/shared/contracts";
import { api, errorMessage } from "@/lib/dashboard-api";
import { dateLabel, memoryExcerpt, memoryTitle } from "@/lib/memory-display";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { PageHeading } from "./ui/page-heading";
import { SearchField } from "./ui/search-field";
import { Button } from "./ui/button";
import { MemoryInspector } from "./memory-inspector";
import { LoadError } from "./load-error";

export function Journal() {
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim());
  const [result, setResult] = useState<{
    key: string;
    page?: Page<Memory>;
    error?: string;
  }>();
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const key = `${search}:${refresh}`;
  const filter = {
    projectId: null,
    sourceAgent: "website",
    status: "active",
    sort: "created_desc",
    query: search || undefined,
  };
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    api<Page<Memory>>(
      "/memories/search",
      {
        projectId: null,
        sourceAgent: "website",
        status: "active",
        sort: "created_desc",
        query: search || undefined,
      },
      undefined,
      request.signal,
    )
      .then((page) => {
        if (!request.signal.aborted) setResult({ key, page });
      })
      .catch((error) => {
        if (!request.signal.aborted)
          setResult({ key, error: errorMessage(error) });
      });
    return () => request.abort();
  }, [search, key]);
  const current = result?.key === key ? result : undefined;
  const groups = new Map<string, Memory[]>();
  for (const note of current?.page?.items ?? []) {
    const date = dateLabel(note.createdAt);
    groups.set(date, [...(groups.get(date) ?? []), note]);
  }
  return (
    <>
      <PageHeading
        title="Journal"
        description="Daily notes and reflections."
        actions={
          <Link className="app-button" href="/app/notes/new?from=journal">
            <Plus size={16} />
            New entry
          </Link>
        }
      />
      <div className="journal-layout">
        <div className="journal-pages">
          <SearchField
            label="Search journal"
            value={query}
            onChange={setQuery}
            placeholder="Find something you wrote…"
          />
          {current?.error && (
            <LoadError
              message={current.error}
              retry={() => setRefresh((value) => value + 1)}
            />
          )}
          {!current && (
            <p role="status" className="library-loading">
              Opening your journal…
            </p>
          )}
          {current?.page && !current.page.items.length && (
            <div className="journal-empty">
              <Feather size={26} strokeWidth={1.4} />
              <h2>
                {search
                  ? "Nothing here matches yet."
                  : "Start with a few words."}
              </h2>
              <p>
                {search
                  ? "Try a different phrase."
                  : "A thought, a small win, or something you want to return to."}
              </p>
              {!search && (
                <Link
                  className="app-button secondary"
                  href="/app/notes/new?from=journal"
                >
                  Write your first entry
                </Link>
              )}
            </div>
          )}
          {[...groups].map(([day, entries]) => (
            <section className="journal-day" key={day}>
              <h2>{day}</h2>
              <div>
                {entries.map((note) => (
                  <button
                    className="journal-entry"
                    key={note.id}
                    onClick={() => setSelected(note.id)}
                  >
                    <span>
                      <strong>{memoryTitle(note)}</strong>
                      <p>{memoryExcerpt(note, 280)}</p>
                    </span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              </div>
            </section>
          ))}
          {current?.page?.nextCursor && (
            <Button
              variant="secondary"
              disabled={more}
              onClick={async () => {
                const request = controller.current;
                if (!request) return;
                setMore(true);
                try {
                  const page = await api<Page<Memory>>(
                    "/memories/search",
                    { ...filter, cursor: current.page!.nextCursor },
                    undefined,
                    request.signal,
                  );
                  if (!request.signal.aborted)
                    setResult({
                      key,
                      page: {
                        ...page,
                        items: [...current.page!.items, ...page.items],
                      },
                    });
                } catch (error) {
                  if (!request.signal.aborted)
                    setResult({ ...current, key, error: errorMessage(error) });
                } finally {
                  setMore(false);
                }
              }}
            >
              Earlier entries
            </Button>
          )}
        </div>
        <aside className="journal-guide">
          <span>Today</span>
          <h2>
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </h2>
          <p>What’s on your mind?</p>
          <Link className="text-button" href="/app/notes/new?from=journal">
            Open a fresh page <ArrowUpRight size={14} />
          </Link>
          <div>
            <p>Your personal notes, in the order you wrote them.</p>
            <Link href="/app/profile">
              A little about you <ArrowUpRight size={14} />
            </Link>
          </div>
        </aside>
      </div>
      {selected && (
        <MemoryInspector
          id={selected}
          close={() => {
            setSelected(null);
            setRefresh((value) => value + 1);
          }}
        />
      )}
    </>
  );
}
