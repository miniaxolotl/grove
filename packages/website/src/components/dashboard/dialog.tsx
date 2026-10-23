"use client";
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { fitOverlayViewport, lockPageScroll } from "./ui/overlay-focus";
import { IconButton } from "./ui/button";

const DialogBusy = createContext<(busy: boolean) => void>(() => {});
export const useDialogBusy = () => useContext(DialogBusy);
export function Dialog({
  title,
  children,
  close,
  panel = false,
  busy = false,
  variant = "default",
  header,
  onDismissed,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  panel?: boolean;
  busy?: boolean;
  variant?: "default" | "palette" | "inspector";
  header?: React.ReactNode;
  onDismissed?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef<{ id: number; x: number; y: number } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const locked = busy || saving;
  const dismissed = useEffectEvent(() => onDismissed?.());
  useEffect(() => {
    const element = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const focusKey = previous?.dataset.focusKey;
    const unlock = lockPageScroll();
    const releaseViewport =
      variant !== "default" ? fitOverlayViewport(element) : undefined;
    element.showModal();
    (
      element.querySelector<HTMLElement>("[data-autofocus]") ??
      element.querySelector<HTMLElement>(
        "[contenteditable=true], textarea, input:not([type=checkbox]), [role=combobox]",
      )
    )?.focus();
    return () => {
      element.close();
      releaseViewport?.();
      unlock();
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
      dismissed();
    };
  }, [variant]);
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
      className={`app-dialog${panel ? " app-detail-panel" : ""}${variant !== "default" ? ` ${variant}-dialog` : ""}`}
    >
      <div
        className={
          variant === "palette"
            ? "palette-heading"
            : "dialog-heading mb-6 flex items-center justify-between gap-4"
        }
      >
        {header ?? <h2 className="font-editorial text-3xl">{title}</h2>}
        <IconButton disabled={locked} onClick={close} label="Close dialog">
          <X size={20} />
        </IconButton>
      </div>
      <DialogBusy.Provider value={setSaving}>{children}</DialogBusy.Provider>
    </dialog>
  );
}
