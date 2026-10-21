"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";

type Toast = { id: number; message: string; error?: boolean };
const Context = createContext<(message: string, error?: boolean) => void>(
  () => {},
);
export const useToast = () => useContext(Context);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast>();
  const [host, setHost] = useState<Element>();
  const [paused, setPaused] = useState(false);
  const notify = useCallback((message: string, error = false) => {
    setToast({ id: Date.now(), message, error });
  }, []);
  useEffect(() => {
    // Keep feedback in the active modal's top layer and accessible tree.
    const locate = () =>
      setHost(
        [...document.querySelectorAll("dialog[open]")].at(-1) ?? document.body,
      );
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => observer.disconnect();
  }, []);
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
      {children}
      {host &&
        createPortal(
          <div
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
    </Context.Provider>
  );
}
