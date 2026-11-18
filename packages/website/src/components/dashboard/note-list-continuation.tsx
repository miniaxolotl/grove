"use client";

import { useEffectEvent, useLayoutEffect, useMemo, useRef } from "react";
import type {
  InfiniteData,
  UseInfiniteQueryResult,
} from "@tanstack/react-query";
import type { Memory } from "@lib/shared/contracts";

type NotePage = { items: Memory[]; nextCursor?: string | null };
type NoteQuery = UseInfiniteQueryResult<InfiniteData<NotePage>>;

export function uniquePageNotes(pages: NotePage[] = []) {
  const notes = new Map<string, Memory>();
  for (const page of pages) {
    for (const note of page.items) notes.set(note.id, note);
  }
  return [...notes.values()];
}

export function NoteListContinuation({
  query,
  paused,
}: {
  query: NoteQuery;
  paused: boolean;
}) {
  const edge = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const request = useRef<Promise<unknown> | null>(null);
  const { data, hasNextPage, isFetching, isFetchingNextPage } = query;
  const cursor = data?.pages.at(-1)?.nextCursor;
  const repeated = !!cursor && data?.pageParams.includes(cursor);
  const stalled = useMemo(() => {
    if (!data || data.pages.length < 2) return false;
    const seen = new Set<string>();
    for (const page of data.pages.slice(0, -1)) {
      for (const note of page.items) seen.add(note.id);
    }
    return !data.pages.at(-1)!.items.some((note) => !seen.has(note.id));
  }, [data]);
  const failed = query.isFetchNextPageError;
  const stale =
    query.error instanceof Error &&
    "code" in query.error &&
    ["stale_search", "invalid_cursor"].includes(String(query.error.code));
  const refresh = repeated || stale;
  const canLoad = hasNextPage && !isFetching && !paused;
  const auto = canLoad && !query.isError && !repeated && !stalled;
  const supportsObserver = typeof IntersectionObserver !== "undefined";

  function load() {
    if (!canLoad || request.current) return false;
    // A refresh may have started before its state reached React. Never cancel it.
    const result = refresh
      ? query.refetch({ cancelRefetch: false })
      : query.fetchNextPage({ cancelRefetch: false });
    request.current = result;
    void result.finally(() => {
      request.current = null;
    });
    return true;
  }

  const appendAtEdge = useEffectEvent(() => {
    if (!auto || document.activeElement === button.current) return false;
    return load();
  });
  useLayoutEffect(() => {
    const target = edge.current;
    if (!auto || !target || !supportsObserver) return;
    let observing = true;
    // The viewport root also clips through nested overflow containers, including
    // the notebook rail and its independently scrolling explorer.
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          observing &&
          (entries.at(-1)?.intersectionRatio ?? 0) >= 0.5 &&
          appendAtEdge()
        ) {
          observing = false;
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(target);
    // A focused manual control defers the append. On blur the edge may still
    // be visible, so there won't necessarily be another threshold crossing.
    const manual = button.current;
    const recheck = () => {
      observer.unobserve(target);
      observer.observe(target);
    };
    manual?.addEventListener("blur", recheck);
    return () => {
      observing = false;
      observer.disconnect();
      manual?.removeEventListener("blur", recheck);
    };
  }, [auto, cursor, supportsObserver]);

  const exceptional = failed || repeated || stalled;
  if (!hasNextPage && !isFetchingNextPage) return null;
  return (
    <li className="note-continuation">
      <span className="note-continuation-edge" aria-hidden="true" ref={edge} />
      <span role="status" className="note-continuation-status">
        {isFetchingNextPage
          ? "Loading more notes…"
          : isFetching && refresh
            ? "Refreshing notes…"
            : !isFetching && (failed || repeated)
              ? stale
                ? "Search results changed."
                : repeated
                  ? "The next page repeated."
                  : "Couldn’t load more notes."
              : null}
      </span>
      {hasNextPage && !isFetchingNextPage && !(isFetching && exceptional) && (
        <button
          type="button"
          className={`text-button${exceptional || !supportsObserver ? "" : " note-continuation-fallback"}`}
          ref={button}
          aria-disabled={!canLoad}
          onClick={(event) => {
            if (!load() || document.activeElement !== event.currentTarget)
              return;
            // Leave keyboard position just before the incoming rows, not after them.
            const previous = event.currentTarget
              .closest("ul")
              ?.querySelectorAll<HTMLElement>(
                ":scope > li [data-note-page-link]",
              );
            previous?.[previous.length - 1]?.focus({ preventScroll: true });
          }}
        >
          {refresh
            ? stale
              ? "Refresh search results"
              : "Refresh notes"
            : failed
              ? "Retry loading more notes"
              : stalled
                ? "Continue loading notes"
                : "Load more notes"}
        </button>
      )}
    </li>
  );
}
