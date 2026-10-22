"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";

type Toast = { id: number; message: string; error?: boolean };
const Context = createContext<(message: string, error?: boolean) => void>(
  () => {},
);
const NoticeHost = createContext<HTMLDivElement | null>(null);
export const useToast = () => useContext(Context);

/** Durable action feedback shares the toast stack without losing its Undo owner. */
export function WorkspaceNotice({ children }: { children: ReactNode }) {
  const host = useContext(NoticeHost);
  return host
    ? createPortal(
        <div className="workspace-notice" role="status">
          {children}
        </div>,
        host,
      )
    : null;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast>();
  const [host, setHost] = useState<Element>();
  const [region, setRegion] = useState<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);
  const notify = useCallback((message: string, error = false) => {
    setToast({ id: Date.now(), message, error });
  }, []);
  useEffect(() => {
    // Keep feedback in the active modal's top layer and accessible tree.
    const locate = () =>
      setHost(
        [...document.querySelectorAll("dialog[open]")].at(-1) ??
          document.querySelector(".memory-graph[data-expanded]") ??
          document.body,
      );
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "data-expanded"],
    });
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!region) return;
    const viewport = window.visualViewport;
    let composer: Element | null = null;
    const observer = new ResizeObserver(() => place());
    const place = () => {
      if (!region.childElementCount) return;
      const current =
        host === document.body ? document.querySelector(".ask-composer") : null;
      if (current !== composer) {
        observer.disconnect();
        if (current) observer.observe(current);
        composer = current;
      }
      const viewportBottom =
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
      let bottom = window.innerHeight - viewportBottom + 16;
      const bounds = composer?.getBoundingClientRect();
      if (bounds && bounds.bottom > 0 && bounds.top < viewportBottom)
        bottom = Math.max(bottom, window.innerHeight - bounds.top + 8);
      region.style.setProperty("--toast-bottom", `${bottom}px`);
    };
    place();
    const content = new MutationObserver(place);
    content.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      content.disconnect();
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [region, host]);
  useEffect(() => {
    if (!toast || paused) return;
    const timer = setTimeout(
      () => setToast(undefined),
      toast.error ? 10000 : 5000,
    );
    return () => clearTimeout(timer);
  }, [toast, paused]);
  return (
    <Context.Provider value={notify}>
      <NoticeHost.Provider value={region}>
        {children}
        {host &&
          createPortal(
            <div
              ref={setRegion}
              className="toast-region"
              role="region"
              aria-label="Notifications"
              data-private
            >
              {toast && (
                <div
                  className={`workspace-toast${toast.error ? " is-error" : ""}`}
                  onMouseEnter={() => setPaused(true)}
                  onMouseLeave={() => setPaused(false)}
                  onFocus={() => setPaused(true)}
                  onBlur={() => setPaused(false)}
                >
                  {!toast.error && <Check size={17} aria-hidden="true" />}
                  <p role={toast.error ? "alert" : "status"} key={toast.id}>
                    {toast.message}
                  </p>
                  <button
                    type="button"
                    className="app-icon"
                    aria-label="Dismiss notification"
                    onClick={() => {
                      setToast(undefined);
                      setPaused(false);
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>,
            host,
          )}
      </NoticeHost.Provider>
    </Context.Provider>
  );
}
