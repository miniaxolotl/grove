"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

const DialogBusy = createContext<(busy: boolean) => void>(() => {});
export const useDialogBusy = () => useContext(DialogBusy);
export function Dialog({
  title,
  children,
  close,
  panel = false,
  busy = false,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  panel?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const locked = busy || saving;
  useEffect(() => {
    const element = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    element
      .querySelector<HTMLElement>(
        "textarea, input:not([type=checkbox]), select",
      )
      ?.focus();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) close();
      }}
      aria-label={title}
      className={`app-dialog${panel ? " app-detail-panel" : ""}`}
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="font-editorial text-3xl">{title}</h2>
        <button
          disabled={locked}
          onClick={close}
          className="app-icon"
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      <DialogBusy.Provider value={setSaving}>{children}</DialogBusy.Provider>
    </dialog>
  );
}
