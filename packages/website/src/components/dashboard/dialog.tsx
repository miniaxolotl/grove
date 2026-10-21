"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

const DialogBusy = createContext<(busy: boolean) => void>(() => {});
let scrollLocks = 0;
let previousOverflow = "";
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
  const backdropPress = useRef(false);
  const [saving, setSaving] = useState(false);
  const locked = busy || saving;
  useEffect(() => {
    const element = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const focusKey = previous?.dataset.focusKey;
    if (scrollLocks++ === 0)
      previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    element.showModal();
    (
      element.querySelector<HTMLElement>("[data-autofocus]") ??
      element.querySelector<HTMLElement>(
        "[contenteditable=true], textarea, input:not([type=checkbox]), [role=combobox]",
      )
    )?.focus();
    return () => {
      element.close();
      if (--scrollLocks === 0)
        document.documentElement.style.overflow = previousOverflow;
      const scope =
        [...document.querySelectorAll("dialog[open]")].at(-1) ?? document;
      const target = previous?.isConnected
        ? previous
        : focusKey
          ? scope.querySelector<HTMLElement>(
              `[data-focus-key="${CSS.escape(focusKey)}"]`,
            )
          : null;
      target?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        backdropPress.current =
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom);
      }}
      onPointerUp={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          !locked &&
          backdropPress.current &&
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom)
        )
          close();
        backdropPress.current = false;
      }}
      onPointerCancel={() => {
        backdropPress.current = false;
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!locked) close();
      }}
      aria-label={title}
      className={`app-dialog${panel ? " app-detail-panel" : ""}`}
    >
      <div className="dialog-heading mb-6 flex items-center justify-between gap-4">
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
