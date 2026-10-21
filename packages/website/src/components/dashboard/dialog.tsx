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
  const backdropPress = useRef<{ id: number; x: number; y: number } | null>(
    null,
  );
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
    element
      .querySelector<HTMLElement>(
        "[contenteditable=true], textarea, input:not([type=checkbox]), [role=combobox]",
      )
      ?.focus();
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
          event.isPrimary &&
          event.button === 0 &&
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom)
            ? { id: event.pointerId, x: event.clientX, y: event.clientY }
            : null;
      }}
      onPointerMove={(event) => {
        const start = backdropPress.current;
        if (
          start &&
          (start.id !== event.pointerId ||
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8)
        )
          backdropPress.current = null;
      }}
      onPointerUp={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const start = backdropPress.current;
        backdropPress.current = null;
        if (
          !locked &&
          start?.id === event.pointerId &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8 &&
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom)
        )
          close();
      }}
      onPointerCancel={() => {
        backdropPress.current = null;
      }}
      onLostPointerCapture={() => {
        backdropPress.current = null;
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
