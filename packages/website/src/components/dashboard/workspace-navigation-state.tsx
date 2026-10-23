"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type NavigationState = {
  expanded: Record<string, boolean>;
  scroll: { desktop: number; mobile: number };
  pinned: boolean;
};
const empty = (): NavigationState => ({
  expanded: {},
  scroll: { desktop: 0, mobile: 0 },
  pinned: false,
});
const Context = createContext<{
  state: NavigationState;
  ready: boolean;
  update: (change: Partial<NavigationState>) => void;
} | null>(null);
const validId = /^[\da-f-]{36}$/i;
function sanitize(value: unknown): NavigationState {
  const result = empty();
  if (!value || typeof value !== "object") return result;
  const data = value as Partial<NavigationState>;
  if (data.expanded && typeof data.expanded === "object")
    Object.entries(data.expanded)
      .slice(-500)
      .forEach(([id, open]) => {
        if (validId.test(id) && typeof open === "boolean")
          result.expanded[id] = open;
      });
  for (const mode of ["desktop", "mobile"] as const) {
    const top = data.scroll?.[mode];
    if (typeof top === "number" && Number.isFinite(top))
      result.scroll[mode] = Math.max(0, Math.min(top, 1_000_000));
  }
  result.pinned = data.pinned === true;
  return result;
}

/** Only UI metadata crosses reloads. The shell remounts this owner per account/session. */
export function WorkspaceNavigationState({
  account,
  children,
}: {
  account: string;
  children: ReactNode;
}) {
  const [state, setState] = useState(empty);
  const [ready, setReady] = useState(false);
  const current = useRef(state);
  const loaded = useRef(false);
  const key = `grove:navigation:v1:${encodeURIComponent(account)}`;
  useEffect(() => {
    let value = empty();
    try {
      const raw = localStorage.getItem(key);
      if (raw && raw.length <= 50_000) value = sanitize(JSON.parse(raw));
    } catch {
      /* Private/blocked storage keeps safe in-memory defaults. */
    }
    current.current = value;
    loaded.current = true;
    const frame = requestAnimationFrame(() => {
      setState(value);
      setReady(true);
    });
    return () => {
      loaded.current = false;
      cancelAnimationFrame(frame);
    };
  }, [key]);
  function update(change: Partial<NavigationState>) {
    if (!loaded.current) return;
    const next = sanitize({ ...current.current, ...change });
    current.current = next;
    setState(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Optional persistence. */
    }
  }
  return (
    <Context.Provider value={{ state, ready, update }}>
      {children}
    </Context.Provider>
  );
}

export const useWorkspaceNavigationState = () => useContext(Context);
