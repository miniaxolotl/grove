"use client";
import {
  useEffect,
  useCallback,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Link as LinkIcon,
  Search,
  LoaderCircle,
} from "lucide-react";
import {
  publicReaderStateSchema,
  type PublicShare,
  type PublicReaderState,
} from "@lib/shared/sharing";
import {
  headingFromHash,
  filterOutline,
  type NoteHeading,
} from "@/lib/note-headings";
import { sharedNoteDocument } from "@/lib/shared-note-document";
import { matchesShortcut, shortcuts } from "@/lib/workspace-shortcuts";
import { isTyping, isActiveSurface } from "@/lib/workspace-keyboard";
import { canWarmLink } from "@/lib/link-intent";
import { uuidSchema } from "@lib/shared/contracts";
import { OutlineItems } from "../dashboard/ui/outline-items";
import { SearchField } from "../dashboard/ui/search-field";
import { SharedNote } from "./shared-note";
import { ReaderPalette } from "./reader-palette";

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
});
type Candidate = {
  href: string;
  state: PublicReaderState;
  validator: string;
  at: number;
  restarted?: boolean;
};

export function PublicReader({
  initial,
  token,
  path,
  origin,
}: {
  initial: PublicReaderState;
  token: string;
  path: string;
  origin: string;
}) {
  const root = `/s/${token}`;
  const [state, setState] = useState(initial);
  const [current, setCurrent] = useState(path);
  const [pending, setPending] = useState(false);
  const [pendingId, setPendingId] = useState<string>();
  const [failure, setFailure] = useState<"unavailable" | "failed" | null>(null);
  const [palette, setPalette] = useState<"search" | "commands" | "help" | null>(
    null,
  );
  const [listPoints, setListPoints] = useState(false);
  const [outlineQuery, setOutlineQuery] = useState("");
  const [active, setActive] = useState("");
  const [missing, setMissing] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [manualLink, setManualLink] = useState("");
  const [listingBusy, setListingBusy] = useState(false);
  const [listingError, setListingError] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);
  const notebookPanel = useRef<HTMLDetailsElement>(null);
  const outlinePanel = useRef<HTMLDetailsElement>(null);
  const manualInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const warming = useRef<AbortController | null>(null);
  const warmingHref = useRef("");
  const candidate = useRef<Candidate | null>(null);
  const warmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const candidateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const sequence = useRef(0);
  const cooldown = useRef(0);
  const retryHref = useRef(path);
  const listController = useRef<AbortController | null>(null);
  const listingCursors = useRef<(string | null)[]>([
    new URL(path, "https://reader.invalid").searchParams.get("cursor"),
  ]);
  const positions = useRef(
    new Map<
      string,
      {
        scroll: number;
        row?: string;
        cursors: (string | null)[];
        folder?: string;
        railScroll: number;
        railOpen: boolean;
      }
    >(),
  );
  const { data, navigation, listing } = state;
  const noteDocument = useMemo(
    () => sharedNoteDocument(data.note?.content ?? "", data.note?.title ?? ""),
    [data.note?.content, data.note?.title],
  );
  const headings = noteDocument.targets;
  const visibleHeadings = useMemo(() => {
    const hasSections = headings.some((item) => !item.point);
    return filterOutline(
      headings.filter((h) => listPoints || !h.point || !hasSections),
      outlineQuery,
    );
  }, [headings, listPoints, outlineQuery]);
  const title = data.note?.title || data.notebook?.name || data.root.name;
  const titleAnchor = noteDocument.titleAnchor;
  function destination(href: string) {
    const url = new URL(href, location.origin);
    if (url.origin !== location.origin) return null;
    const suffix = url.pathname.slice(root.length);
    if (
      !url.pathname.startsWith(root) ||
      (suffix && !/^\/(notes|notebooks)\/[0-9a-f-]{36}$/.test(suffix))
    )
      return null;
    const [, kind, id] = suffix.split("/");
    if (kind && !uuidSchema.safeParse(id).success) return null;
    return {
      url,
      input: {
        kind: kind || "root",
        id,
        cursor: url.searchParams.get("cursor") ?? undefined,
      },
    };
  }
  async function read(
    href: string,
    signal: AbortSignal,
    previous?: Candidate | null,
    library?: { cursors: (string | null)[]; folder?: string },
  ): Promise<Candidate> {
    const target = destination(href);
    if (!target) throw new Error();
    const response = await fetch(`${root}/read`, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...target.input,
        validator: previous?.validator,
        listingFolder: library?.folder ?? state.listing?.notebook?.id,
        listingCursors: library?.cursors ?? listingCursors.current,
      }),
      signal,
    });
    if (response.status === 429)
      cooldown.current =
        Date.now() +
        Math.max(1, Number(response.headers.get("retry-after")) || 60) * 1000;
    if (
      response.status === 400 &&
      (target.input.cursor ||
        (library?.cursors ?? listingCursors.current).some(Boolean))
    ) {
      const restart = new URL(href, location.origin);
      restart.searchParams.delete("cursor");
      listingCursors.current = [null];
      const result = await read(restart.href, signal, null, {
        cursors: [null],
        folder: state.listing?.notebook?.id,
      });
      return { ...result, restarted: true };
    }
    if (!response.ok) throw response.status;
    const value = await response.json();
    const next =
      value.unchanged && previous
        ? previous.state
        : publicReaderStateSchema.parse(value.state);
    return {
      href,
      state: next,
      validator: value.validator as string,
      at: Date.now(),
      restarted: value.unchanged ? previous?.restarted : undefined,
    };
  }
  function savePosition() {
    const focused =
      document.activeElement?.closest<HTMLAnchorElement>("a[href]");
    positions.current.set(location.href, {
      scroll: window.scrollY,
      row: focused?.href,
      cursors: [...listingCursors.current],
      folder: state.listing?.notebook?.id,
      railScroll: notebookPanel.current?.scrollTop ?? 0,
      railOpen: notebookPanel.current?.open ?? false,
    });
    if (positions.current.size > 20)
      positions.current.delete(positions.current.keys().next().value!);
  }
  function prepared(href: string) {
    return candidate.current?.href === href &&
      Date.now() - candidate.current.at < 30_000
      ? candidate.current
      : null;
  }
  async function navigate(href: string, history = false) {
    const target = destination(href);
    if (!target) return;
    if (
      !history &&
      target.url.pathname + target.url.search === current &&
      target.url.hash
    ) {
      jumpHash(target.url.hash, true);
      return;
    }
    const request = ++sequence.current;
    setPendingId(undefined);
    listController.current?.abort();
    setListingBusy(false);
    setListingError(false);
    controller.current?.abort();
    warming.current?.abort();
    clearTimeout(warmTimer.current);
    if (cooldown.current > Date.now()) {
      retryHref.current = href;
      setPending(false);
      setFailure("failed");
      setBlockedUntil(cooldown.current);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    retryHref.current = href;
    if (!history) savePosition();
    const timer = setTimeout(() => {
      if (request === sequence.current) {
        setPending(true);
        setPendingId(
          target.input.kind === "notes" ? target.input.id : undefined,
        );
      }
    }, 200);
    if (history) setPending(true);
    try {
      const cached = prepared(href);
      const saved = history
        ? positions.current.get(target.url.href)
        : undefined;
      const result = await read(href, abort.signal, cached, saved);
      if (request !== sequence.current) return;
      candidate.current = null;
      if (result.restarted) listingCursors.current = [null];
      else if (saved) listingCursors.current = saved.cursors;
      else if (
        result.state.listing?.notebook?.id !== state.listing?.notebook?.id ||
        target.input.kind !== "notes"
      )
        listingCursors.current = [target.input.cursor ?? null];
      const resolved = destination(result.href) ?? target;
      if (!history) window.history.pushState(null, "", resolved.url);
      setCurrent(resolved.url.pathname + resolved.url.search);
      setState(result.state);
      setFailure(null);
      setMissing(false);
      setCopyStatus("");
      setManualLink("");
      setOutlineQuery("");
      if (notebookPanel.current && matchMedia("(max-width: 800px)").matches)
        notebookPanel.current.open = false;
      requestAnimationFrame(() => {
        if (request !== sequence.current) return;
        const position = history
          ? positions.current.get(target.url.href)
          : null;
        if (position && notebookPanel.current) {
          notebookPanel.current.open = position.railOpen;
          notebookPanel.current.scrollTop = position.railScroll;
        }
        const row = position?.row
          ? [
              ...(host.current?.querySelectorAll<HTMLAnchorElement>(
                "a[href]",
              ) ?? []),
            ].find((link) => link.href === position.row)
          : undefined;
        (row ?? article.current?.querySelector<HTMLElement>("h1"))?.focus({
          preventScroll: true,
        });
        if (position) window.scrollTo(0, position.scroll);
        else if (target.url.hash) jumpHash(target.url.hash, false);
        else window.scrollTo(0, 0);
      });
    } catch (error) {
      if (abort.signal.aborted || request !== sequence.current) return;
      setFailure(error === 404 ? "unavailable" : "failed");
      requestAnimationFrame(() => {
        if (
          request === sequence.current &&
          document.activeElement === document.body &&
          isActiveSurface(host.current)
        )
          (
            article.current?.querySelector<HTMLElement>(".shared-retry") ??
            article.current?.querySelector<HTMLElement>("h1")
          )?.focus({ preventScroll: true });
      });
      if (error === 429) setBlockedUntil(cooldown.current);
      if (error === 404) {
        candidate.current = null;
        positions.current.clear();
      }
    } finally {
      clearTimeout(timer);
      if (request === sequence.current) {
        setPending(false);
        setPendingId(undefined);
      }
    }
  }
  function warm(href: string) {
    clearTimeout(warmTimer.current);
    const target = destination(href);
    if (target && target.url.pathname + target.url.search === current) return;
    if (warmingHref.current === href) return;
    if (
      cooldown.current > Date.now() ||
      !canWarmLink(href) ||
      !destination(href)
    )
      return;
    if (
      candidate.current?.href === href &&
      Date.now() - candidate.current.at < 30_000
    )
      return;
    warmTimer.current = setTimeout(async () => {
      warming.current?.abort();
      const abort = new AbortController();
      warming.current = abort;
      warmingHref.current = href;
      try {
        const result = await read(href, abort.signal);
        if (!abort.signal.aborted) {
          candidate.current = result;
          clearTimeout(candidateTimer.current);
          candidateTimer.current = setTimeout(() => {
            if (candidate.current === result) candidate.current = null;
          }, 30_000);
        }
      } catch {
        /* Hover has no visible error state. */
      } finally {
        if (warming.current === abort) warmingHref.current = "";
      }
    }, 100);
  }
  async function moreNotes(href: string) {
    if (listingBusy) return;
    if (cooldown.current > Date.now()) {
      setListingError(true);
      setBlockedUntil(cooldown.current);
      return;
    }
    clearTimeout(warmTimer.current);
    warming.current?.abort();
    const abort = new AbortController();
    listController.current = abort;
    setListingBusy(true);
    setListingError(false);
    try {
      const result = await read(href, abort.signal, prepared(href));
      if (abort.signal.aborted) return;
      const next = result.state.listing;
      if (next) {
        const nextCursor = destination(result.href)?.input.cursor ?? null;
        const cursors = result.restarted
          ? [null]
          : [...listingCursors.current, nextCursor];
        const keepOld = !result.restarted && cursors.length <= 3;
        listingCursors.current = cursors.slice(-3);
        setState((old) => ({
          ...old,
          listing: {
            ...next,
            notes: [
              ...(keepOld ? (old.listing?.notes ?? []) : []),
              ...next.notes.filter(
                (note) =>
                  !keepOld ||
                  !old.listing?.notes.some((row) => row.id === note.id),
              ),
            ],
          },
        }));
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        if (error === 404) setFailure("unavailable");
        else setListingError(true);
        if (error === 429) setBlockedUntil(cooldown.current);
      }
    } finally {
      if (!abort.signal.aborted) setListingBusy(false);
    }
  }
  function jumpHash(hash: string, push: boolean) {
    const id = headingFromHash(hash);
    if (!id) {
      setMissing(false);
      return;
    }
    const element = document.getElementById(id);
    if (!element || !article.current?.contains(element)) {
      setMissing(/^(section|point)-/.test(id));
      return;
    }
    if (push) {
      savePosition();
      window.history.pushState(null, "", hash);
    }
    element.tabIndex = -1;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "start" });
    setMissing(false);
    setActive(id);
  }
  function jump(heading: NoteHeading) {
    jumpHash(`#${heading.id}`, true);
  }
  function openOutline() {
    if (outlinePanel.current) {
      outlinePanel.current.open = true;
      outlinePanel.current
        .querySelector<HTMLElement>("a,button,input")
        ?.focus();
    }
  }
  const copy = useCallback(
    async (heading: NoteHeading) => {
      const generation = sequence.current;
      const url = new URL(current, location.origin);
      url.hash = heading.id;
      try {
        await navigator.clipboard.writeText(url.href);
        if (generation !== sequence.current) return;
        setCopyStatus("Link copied");
        setManualLink("");
      } catch {
        if (generation !== sequence.current) return;
        setManualLink(url.href);
        setCopyStatus("");
        requestAnimationFrame(() => {
          if (generation !== sequence.current) return;
          if (outlinePanel.current) outlinePanel.current.open = true;
          manualInput.current?.focus();
        });
      }
    },
    [current],
  );
  const handleHistory = useEffectEvent(() => {
    if (location.pathname + location.search === current && !failure)
      jumpHash(location.hash, false);
    else void navigate(location.href, true);
  });
  useEffect(() => {
    if (!blockedUntil) return;
    const timer = setTimeout(
      () => setBlockedUntil(0),
      Math.max(0, blockedUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [blockedUntil]);
  const handleKeys = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (!isActiveSurface(host.current) || failure) return;
    const mode =
      matchesShortcut(event, shortcuts.search) && data.kind === "notebook"
        ? "search"
        : matchesShortcut(event, shortcuts.commands)
          ? "commands"
          : matchesShortcut(event, shortcuts.help)
            ? "help"
            : null;
    if (mode) {
      event.preventDefault();
      setPalette(mode);
    } else if (matchesShortcut(event, shortcuts.outline) && headings.length) {
      event.preventDefault();
      openOutline();
    }
  });
  useEffect(() => {
    window.addEventListener("popstate", handleHistory);
    document.addEventListener("keydown", handleKeys);
    const initialFrame = requestAnimationFrame(() => {
      if (location.hash) handleHistory();
    });
    return () => {
      window.removeEventListener("popstate", handleHistory);
      cancelAnimationFrame(initialFrame);
      document.removeEventListener("keydown", handleKeys);
      controller.current?.abort();
      listController.current?.abort();
      warming.current?.abort();
      clearTimeout(warmTimer.current);
      clearTimeout(candidateTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!headings.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entering = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (entering) setActive(entering.target.id);
      },
      { rootMargin: "-5% 0px -65% 0px" },
    );
    article.current
      ?.querySelectorAll("[data-section-id], h1[id]")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [headings, pending, failure]);
  function arrows(event: KeyboardEvent<HTMLElement>, rows = false) {
    if (
      isTyping(event.target) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    if (rows && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      const links = [
        ...event.currentTarget.querySelectorAll<HTMLElement>(
          "a[href],button:not(.shared-copy)",
        ),
      ];
      const index = links.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      links[
        Math.max(
          0,
          Math.min(
            links.length - 1,
            index + (event.key === "ArrowDown" ? 1 : -1),
          ),
        )
      ]?.focus();
    } else if (
      !rows &&
      !event.repeat &&
      ["ArrowLeft", "ArrowRight"].includes(event.key) &&
      !window.getSelection()?.toString() &&
      !(event.target as Element).closest("pre,.markdown-table,a,button,audio")
    ) {
      const next =
        event.key === "ArrowLeft" ? navigation?.previous : navigation?.next;
      if (next) {
        event.preventDefault();
        void navigate(`${root}/notes/${next.id}`);
      }
    }
  }
  const listingPath =
    listing?.notebook?.id === data.root.id
      ? root
      : `${root}/notebooks/${listing?.notebook?.id}`;
  const contentList = listing && (
    <NotebookList
      data={listing}
      root={root}
      currentId={data.note?.id}
      pendingId={pendingId}
      busy={listingBusy}
      error={listingError}
      blocked={blockedUntil > 0}
      nextHref={
        listing.nextCursor
          ? `${listingPath}?cursor=${encodeURIComponent(listing.nextCursor)}`
          : undefined
      }
    />
  );
  return (
    <div
      className="shared-workspace"
      data-notebook={
        (failure !== "unavailable" &&
          data.kind === "notebook" &&
          !!data.note) ||
        undefined
      }
      data-outline={
        (failure !== "unavailable" && headings.length > 0) || undefined
      }
      data-shared-content
      data-private
      ref={host}
      onClick={(event) => {
        const link = (event.target as Element).closest<HTMLAnchorElement>(
          "a[href]",
        );
        if (
          !link ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          link.target ||
          link.hasAttribute("download") ||
          !destination(link.href)
        )
          return;
        event.preventDefault();
        if (link.hasAttribute("data-more-notes")) void moreNotes(link.href);
        else void navigate(link.href);
      }}
      onPointerOver={(event) => {
        if (event.pointerType !== "mouse") return;
        const link = (event.target as Element).closest<HTMLAnchorElement>(
          "a[href]",
        );
        if (link) warm(link.href);
      }}
      onPointerLeave={() => clearTimeout(warmTimer.current)}
      onFocus={(event) => {
        const link = (event.target as Element).closest<HTMLAnchorElement>(
          "a[href]",
        );
        if (link) warm(link.href);
      }}
    >
      {data.kind === "notebook" && failure !== "unavailable" && (
        <>
          <a className="shared-skip" href="#shared-article">
            Skip to note
          </a>
          {data.note && (
            <details
              className="shared-navigation"
              ref={notebookPanel}
              open={!data.note}
            >
              <summary>
                Notebook contents <ChevronDown size={16} aria-hidden="true" />
                <span className="shared-nav-status" aria-hidden="true">
                  {pending && <LoaderCircle size={16} />}
                </span>
              </summary>
              <nav
                aria-label="Notebook contents"
                onKeyDown={(event) => arrows(event, true)}
              >
                <a className="shared-root" href={root}>
                  <Folder size={17} aria-hidden="true" />
                  {data.root.name}
                </a>
                {navigation?.folder &&
                  navigation.folder.id !== data.root.id && (
                    <a
                      className="shared-folder"
                      href={`${root}/notebooks/${navigation.folder.id}`}
                    >
                      {navigation.folder.name}
                    </a>
                  )}
                {navigation?.folder?.parentId &&
                  navigation.folder.parentId !== data.root.id && (
                    <a href={`${root}/notebooks/${navigation.folder.parentId}`}>
                      <ArrowLeft size={15} aria-hidden="true" />
                      Parent notebook
                    </a>
                  )}
                {data.note && contentList}
                {data.note &&
                  !listing?.notes.some((note) => note.id === data.note?.id) && (
                    <a
                      href={`${root}/notes/${data.note.id}`}
                      aria-current="page"
                    >
                      <FileText size={17} aria-hidden="true" />
                      {data.note.title}
                    </a>
                  )}
              </nav>
            </details>
          )}
          <button
            className="shared-find"
            onClick={() => setPalette("search")}
            aria-label="Find a note"
          >
            <Search size={17} aria-hidden="true" />
            <span>Find a note</span>
          </button>
        </>
      )}
      <article
        className="shared-reader"
        id="shared-article"
        ref={article}
        aria-busy={pending}
        onKeyDown={(event) => arrows(event)}
      >
        {failure ? (
          <section className="shared-message" role="alert">
            <h1 tabIndex={-1}>
              {failure === "unavailable"
                ? "This link is unavailable"
                : "Could not open this link"}
            </h1>
            {failure === "unavailable" ? (
              <p>Ask the sender for a new link.</p>
            ) : (
              <button
                className="shared-retry"
                disabled={blockedUntil > 0}
                onClick={() => void navigate(retryHref.current)}
              >
                {blockedUntil > 0 ? "Try again shortly" : "Try again"}
              </button>
            )}
          </section>
        ) : pending ? (
          <div className="shared-skeleton" aria-hidden="true">
            <div />
            <div />
            <div />
            <div />
            <div />
          </div>
        ) : (
          <>
            {data.note && navigation?.folder && (
              <a
                className="shared-back"
                href={`${root}/notebooks/${navigation.folder.id}`}
              >
                <ArrowLeft size={16} aria-hidden="true" />
                {navigation.folder.name}
              </a>
            )}
            {!data.note && current !== root && (
              <a className="shared-back" href={root}>
                <ArrowLeft size={16} aria-hidden="true" />
                {data.root.name}
              </a>
            )}
            <header className="shared-heading">
              <h1 id={titleAnchor} tabIndex={-1}>
                {title || "Untitled note"}
              </h1>
              <div className="shared-heading-details">
                {data.note && (
                  <time dateTime={data.note.updatedAt}>
                    Updated {dateFormat.format(new Date(data.note.updatedAt))}
                  </time>
                )}
              </div>
            </header>
            {data.note && (
              <div className="shared-section-missing" role="status">
                {missing && (
                  <>
                    Section not found
                    {headings.length > 0 && (
                      <button onClick={openOutline}>On this page</button>
                    )}
                  </>
                )}
              </div>
            )}
            {data.note ? (
              <SharedNote
                note={data.note}
                root={root}
                origin={origin}
                document={noteDocument}
                copy={copy}
              />
            ) : (
              contentList
            )}
            {navigation?.next && (
              <a
                className="shared-next-note"
                href={`${root}/notes/${navigation.next.id}`}
              >
                <span>{navigation.next.title || "Untitled note"}</span>
                <ArrowRight size={18} aria-hidden="true" />
              </a>
            )}
          </>
        )}
      </article>
      {!!headings.length && failure !== "unavailable" && (
        <details className="shared-outline" ref={outlinePanel}>
          <summary>
            On this page <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <nav
            aria-label="Sections in this note"
            inert={pending || !!failure}
            onKeyDown={(event) => arrows(event, true)}
          >
            <SearchField
              label="Find a heading"
              placeholder="Find a heading…"
              value={outlineQuery}
              onChange={setOutlineQuery}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  visibleHeadings[0]
                ) {
                  event.preventDefault();
                  jump(visibleHeadings[0]);
                }
              }}
            />
            {headings.some((h) => h.point) && (
              <label className="shared-points">
                <input
                  type="checkbox"
                  checked={listPoints}
                  onChange={(event) => setListPoints(event.target.checked)}
                />
                List points
              </label>
            )}
            <OutlineItems
              headings={visibleHeadings}
              active={active}
              jump={jump}
              href={(heading) => `#${heading.id}`}
              action={(heading) =>
                !heading.point && (
                  <button
                    className="shared-copy"
                    aria-label={`Copy link to ${heading.title}`}
                    onClick={() => void copy(heading)}
                  >
                    <LinkIcon size={14} aria-hidden="true" />
                  </button>
                )
              }
            />
            <div className="shared-copy-status" role="status">
              {copyStatus}
            </div>
            {manualLink && (
              <input
                aria-label="Section link"
                ref={manualInput}
                readOnly
                value={manualLink}
                onFocus={(event) => event.currentTarget.select()}
              />
            )}
          </nav>
        </details>
      )}
      <span className="shared-loading-status" role="status">
        {pending ? "Loading…" : ""}
      </span>
      {palette && (
        <ReaderPalette
          mode={palette}
          root={root}
          notebook={data.kind === "notebook" && !failure}
          hasOutline={headings.length > 0}
          unavailable={() => {
            candidate.current = null;
            positions.current.clear();
            setPalette(null);
            setFailure("unavailable");
          }}
          close={() => setPalette(null)}
          outline={openOutline}
          navigate={(href) => {
            if (href === "search" || href === "help") setPalette(href);
            else void navigate(href);
          }}
        />
      )}
    </div>
  );
}

function NotebookList({
  data,
  root,
  currentId,
  pendingId,
  nextHref,
  busy,
  error,
  blocked,
}: {
  data: PublicShare;
  root: string;
  currentId?: string;
  pendingId?: string;
  nextHref?: string;
  busy?: boolean;
  error?: boolean;
  blocked?: boolean;
}) {
  return (
    <>
      {!!data.notebooks.length && (
        <section className="shared-notebooks" aria-label="Sub-notebooks">
          <h2>Sub-notebooks</h2>
          <ul>
            {data.notebooks.map((book) => (
              <li key={book.id}>
                <a href={`${root}/notebooks/${book.id}`}>
                  <Folder size={17} aria-hidden="true" />
                  <span>{book.name}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="shared-notes" aria-label="Notes">
        <h2>Notes</h2>
        {data.notes.length ? (
          <ul>
            {data.notes.map((note) => (
              <li key={note.id}>
                <a
                  href={`${root}/notes/${note.id}`}
                  aria-current={currentId === note.id ? "page" : undefined}
                  aria-busy={pendingId === note.id}
                >
                  {pendingId === note.id ? (
                    <LoaderCircle size={17} aria-hidden="true" />
                  ) : (
                    <FileText size={17} aria-hidden="true" />
                  )}
                  <span className="shared-note-label">
                    <span>{note.title || "Untitled note"}</span>
                    {!currentId && (
                      <time dateTime={note.updatedAt}>
                        Updated {dateFormat.format(new Date(note.updatedAt))}
                      </time>
                    )}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="shared-empty">No notes here.</p>
        )}
      </section>
      {nextHref && (
        <a
          className="shared-next"
          href={nextHref}
          data-more-notes
          aria-busy={busy}
          aria-disabled={busy || blocked}
        >
          {busy
            ? "Loading…"
            : blocked
              ? "Try again shortly"
              : error
                ? "Try again"
                : "More notes"}{" "}
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      )}
    </>
  );
}
