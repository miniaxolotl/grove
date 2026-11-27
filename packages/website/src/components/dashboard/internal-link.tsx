"use client";
import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import Link from "next/link";
import {
  isLocalGroveLink,
  parseGroveLink,
  type GroveLink,
  type GroveLinkPreview,
} from "@lib/shared/internal-links";
import type { WorkspaceCache } from "@/lib/workspace-cache";
import { DashboardApiError } from "@/lib/dashboard-api";
import { useOptionalWorkspaceCache } from "./workspace-cache";
import { ActionMenu } from "./ui/action-menu";

function DestinationLink({
  cache,
  target,
  children,
  className,
}: {
  cache: WorkspaceCache;
  target: GroveLink;
  children: ReactNode;
  className?: string;
}) {
  const [warmHref, setWarmHref] = useState("");
  function warm() {
    if (
      new URL(target.href, location.origin).origin !== location.origin ||
      (navigator as Navigator & { connection?: { saveData?: boolean } })
        .connection?.saveData
    )
      return;
    setWarmHref(target.href);
    if (target.kind === "note" && !target.revision)
      void cache.client.prefetchQuery(cache.note(target.id));
  }
  return (
    <Link
      href={target.href}
      className={className}
      prefetch={warmHref === target.href}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") warm();
      }}
      onFocus={warm}
    >
      {children}
    </Link>
  );
}

const subscribeOrigin = () => () => {};
const browserOrigin = () => window.location.origin;
const serverOrigin = () => "";
const emptyPreview = () => undefined;

/** The plain anchor is also the server/public fallback; nothing rewrites source. */
export function InternalLink({
  href,
  followTitle,
  children,
}: {
  href: string;
  followTitle: boolean;
  children: ReactNode;
}) {
  const cache = useOptionalWorkspaceCache();
  const origin = useSyncExternalStore(
    subscribeOrigin,
    browserOrigin,
    serverOrigin,
  );
  const target =
    origin && isLocalGroveLink(href, origin)
      ? parseGroveLink(href, origin)
      : null;
  return cache && target ? (
    <PrivateLink
      key={`${target.kind}:${target.id}:${target.revision ?? "current"}`}
      cache={cache}
      target={target}
      followTitle={followTitle}
    >
      {children}
    </PrivateLink>
  ) : (
    <a href={href}>{children}</a>
  );
}

function PrivateLink({
  cache,
  target,
  followTitle,
  children,
}: {
  cache: WorkspaceCache;
  target: GroveLink;
  followTitle: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () =>
      cache.linkPreview({
        kind: target.kind,
        id: target.id,
        revision: target.revision,
      }),
    [cache, target.kind, target.id, target.revision],
  );
  // Observe labels without owning a query: merely rendering/focusing an anchor
  // must not fetch, keep a closed request alive, or renew a private snapshot.
  const subscribe = useCallback(
    (notify: () => void) => cache.client.getQueryCache().subscribe(notify),
    [cache],
  );
  const snapshot = useCallback(() => {
    const value = cache.client.getQueryData<GroveLinkPreview | null>(
      options.queryKey,
    );
    return value?.expiresAt && Date.parse(value.expiresAt) <= Date.now()
      ? null
      : value;
  }, [cache, options]);
  const preview = useSyncExternalStore(subscribe, snapshot, emptyPreview);
  return (
    <span className="grove-link">
      <DestinationLink cache={cache} target={target}>
        {followTitle && preview ? preview.title : children}
      </DestinationLink>
      <ActionMenu
        label={`Preview linked ${target.kind}`}
        icon={<Info size={15} aria-hidden="true" />}
        portal
        closeOnSelect={false}
        align="start"
        className="grove-link-preview"
        onOpenChange={setOpen}
      >
        {open ? <Preview cache={cache} target={target} /> : null}
      </ActionMenu>
    </span>
  );
}

function Preview({
  cache,
  target,
}: {
  cache: WorkspaceCache;
  target: GroveLink;
}) {
  const query = useQuery(
    cache.linkPreview({
      kind: target.kind,
      id: target.id,
      revision: target.revision,
    }),
  );
  const denied =
    query.error instanceof DashboardApiError &&
    [403, 404, 410].includes(query.error.status);
  const value = query.data;
  return (
    <div className="grove-link-preview-body" aria-live="polite">
      {denied || value === null ? (
        <p>This link is unavailable.</p>
      ) : query.isError ? (
        <>
          <p>Preview couldn’t load.</p>
          <button
            type="button"
            className="app-button secondary"
            onClick={() => void query.refetch()}
          >
            Retry preview
          </button>
        </>
      ) : value ? (
        <>
          <p className="grove-link-type">
            {target.kind === "notebook"
              ? "Notebook"
              : target.revision
                ? `Note · Revision ${target.revision}`
                : "Note"}
            {query.isFetching ? " · Checking…" : ""}
          </p>
          <p className="grove-link-title">{value.title}</p>
          {value.excerpt ? <p>{value.excerpt}</p> : null}
        </>
      ) : (
        <p>Loading preview…</p>
      )}
      <DestinationLink
        className="app-button secondary"
        target={target}
        cache={cache}
      >
        {target.revision
          ? `Open revision ${target.revision}`
          : `Open ${target.kind}`}
      </DestinationLink>
    </div>
  );
}
