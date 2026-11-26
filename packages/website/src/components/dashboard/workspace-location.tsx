"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";

type ReturnLocation = {
  href: string;
  scroll: number;
  pageScroll: number;
  focus: string;
  views: Map<string, unknown>;
};
class Locations {
  readonly views = new Map<string, unknown>();
  readonly returns = new Map<string, ReturnLocation>();
  readonly titles = new Map<string, { owner: symbol; title: string }>();
  private pending?: ReturnLocation;
  takePending(href: string) {
    if (this.pending?.href !== href) return;
    const target = this.pending;
    this.pending = undefined;
    return target;
  }
  restore(target: ReturnLocation) {
    this.views.clear();
    for (const [key, value] of target.views) this.views.set(key, value);
    this.pending = target;
  }
}
const Context = createContext<Locations | null>(null);
const locationKey = () => window.location.pathname + window.location.search;
const safePath = (href: string) =>
  href.startsWith("/app") &&
  /^\/app(?:[/?]|$)/.test(href) &&
  !href.includes("\\") &&
  !Array.from(href).some((character) => character.charCodeAt(0) < 32) &&
  href.length <= 4096;
const fallbackTitle = (path: string) => {
  const settings: Record<string, string> = {
    models: "AI & search",
    account: "Account",
    connections: "Connections",
    data: "Your data",
    files: "Files & storage",
    billing: "Billing",
    admin: "Admin",
  };
  if (path.startsWith("/app/settings"))
    return settings[path.split("/")[3]] ?? "Writing";
  return path.startsWith("/app/ask")
    ? "Ask Grove"
    : path === "/app/projects"
      ? "Notebooks"
      : path === "/app/profile"
        ? "About you"
        : path === "/app/archive"
          ? "Archive"
          : "Notes";
};

/** Account/session-owned navigation metadata. Private lookups and drafts never touch disk. */
export function WorkspaceLocation({ children }: { children: ReactNode }) {
  const [state] = useState(() => new Locations());
  const path = usePathname();
  const params = useSearchParams();
  const key = `${path}?${params}`;
  useEffect(() => {
    const current = locationKey();
    document.title = `${state.titles.get(current)?.title ?? fallbackTitle(path)} · Grove`;
    const pending = state.takePending(current);
    if (!pending) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector(".settings-page")?.scrollTo(0, pending.scroll);
      window.scrollTo(0, pending.pageScroll);
      document
        .querySelector<HTMLElement>(
          `[data-return-focus="${CSS.escape(pending.focus)}"]`,
        )
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [path, key, state]);
  useEffect(
    () => () => {
      document.title = "Grove";
    },
    [],
  );
  return <Context.Provider value={state}>{children}</Context.Provider>;
}

export function useResourceTitle(title?: string) {
  const state = useContext(Context);
  const path = usePathname();
  const params = useSearchParams();
  const key = `${path}${params.size ? `?${params}` : ""}`;
  useEffect(() => {
    if (!state || !title) return;
    const owner = Symbol();
    state.titles.set(key, { owner, title });
    if (locationKey() === key) document.title = `${title} · Grove`;
    return () => {
      if (state.titles.get(key)?.owner !== owner) return;
      state.titles.delete(key);
      if (locationKey() === key)
        document.title = `${fallbackTitle(path)} · Grove`;
    };
  }, [state, key, title, path]);
}

/** Retain in-app drafts and view choices without serializing private values in a URL. */
export function useWorkspaceView<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const state = useContext(Context);
  const initialValue = () =>
    state?.views.has(key)
      ? (state.views.get(key) as T)
      : typeof initial === "function"
        ? (initial as () => T)()
        : initial;
  const [slot, setSlot] = useState(() => ({ key, value: initialValue() }));
  if (slot.key !== key) setSlot({ key, value: initialValue() });
  useEffect(() => {
    if (!state) return;
    if (state.views.size >= 200 && !state.views.has(slot.key))
      state.views.delete(state.views.keys().next().value!);
    state.views.set(slot.key, slot.value);
  }, [state, slot]);
  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setSlot((current) => {
        const value =
          typeof next === "function"
            ? (next as (value: T) => T)(current.value)
            : next;
        if (current.key === key && Object.is(current.value, value))
          return current;
        return { key, value };
      });
    },
    [key],
  );
  return [slot.value, update];
}

export function ReturnLink({
  href,
  onClick,
  ...props
}: ComponentProps<typeof Link>) {
  const state = useContext(Context);
  const path = usePathname();
  const params = useSearchParams();
  const origin = `${path}${params.size ? `?${params}` : ""}`;
  const token = useId();
  const focusKey = typeof href === "string" ? href : token;
  const destination =
    typeof href === "string" && safePath(href) && state
      ? `${href}${href.includes("?") ? "&" : "?"}return=${encodeURIComponent(token)}`
      : href;
  return (
    <Link
      {...props}
      data-return-focus={focusKey}
      href={destination}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !state || !safePath(origin)) return;
        if (state.returns.size >= 100 && !state.returns.has(token))
          state.returns.delete(state.returns.keys().next().value!);
        state.returns.set(token, {
          href: origin,
          scroll: document.querySelector(".settings-page")?.scrollTop ?? 0,
          pageScroll: window.scrollY,
          focus: focusKey,
          views: new Map(state.views),
        });
      }}
    />
  );
}

export function useReturnLocation() {
  const state = useContext(Context);
  const router = useRouter();
  const params = useSearchParams();
  const target = state?.returns.get(params.get("return") ?? "");
  return target && safePath(target.href)
    ? () => {
        state!.restore(target);
        router.push(target.href, { scroll: false });
      }
    : undefined;
}
