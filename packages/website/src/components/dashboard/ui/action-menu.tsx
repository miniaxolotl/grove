"use client";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { overlayViewport } from "./overlay-focus";

/** Native popover gives all action menus light-dismiss, Escape and focus return. */
export function ActionMenu({
  label,
  visibleLabel,
  triggerRef,
  children,
  icon = <MoreHorizontal size={18} />,
  open: controlledOpen,
  onOpenChange,
  closeOnSelect = true,
  portal = false,
  className = "",
  align = "end",
}: {
  label: string;
  visibleLabel?: string;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
  icon?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  closeOnSelect?: boolean;
  portal?: boolean;
  className?: string;
  align?: "start" | "end";
}) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const localAnchor = useRef<HTMLButtonElement>(null);
  const anchor = triggerRef ?? localAnchor;
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const attachPortal = useCallback(
    (node: HTMLSpanElement | null) => {
      if (portal && node) setHost(node.closest("dialog") ?? document.body);
    },
    [portal],
  );
  useLayoutEffect(() => {
    if (controlledOpen === undefined) return;
    const element = popup.current;
    if (!element) return;
    if (controlledOpen && !element.matches(":popover-open")) {
      anchor.current?.focus({ preventScroll: true });
      element.showPopover();
    } else if (!controlledOpen) element.hidePopover();
  }, [anchor, controlledOpen, host]);
  useLayoutEffect(() => {
    if (!open) return;
    const element = popup.current!;
    const trigger = anchor.current!;
    const viewport = window.visualViewport;
    function place() {
      if (!trigger.isConnected || !trigger.getClientRects().length) {
        element.hidePopover();
        return;
      }
      const edge = 8;
      const bounds = overlayViewport();
      const left = bounds.left + edge;
      const top = bounds.top + edge;
      const right = left + bounds.width - edge * 2;
      const bottom = top + bounds.height - edge * 2;
      const rect = trigger.getBoundingClientRect();
      element.style.maxWidth = `${Math.max(0, right - left)}px`;
      element.style.maxHeight = `${Math.max(0, bottom - top)}px`;
      const menu = element.getBoundingClientRect();
      const y =
        rect.bottom + 4 + menu.height <= bottom
          ? rect.bottom + 4
          : rect.top - menu.height - 4;
      const x = align === "start" ? rect.left : rect.right - menu.width;
      element.style.left = `${Math.max(left, Math.min(x, right - menu.width))}px`;
      element.style.top = `${Math.max(top, Math.min(y, bottom - menu.height))}px`;
    }
    place();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    observer.observe(trigger);
    // Capture scrolls from nested readers and notebook explorers too.
    document.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [align, anchor, open]);
  const items = () =>
    [
      ...popup.current!.querySelectorAll<HTMLElement>(
        "button:not(:disabled), a[href]",
      ),
    ].filter((item) => item.getClientRects().length);
  const panel = (
    <div
      ref={popup}
      id={id}
      popover="auto"
      className={`action-menu ${className}`.trim()}
      role="group"
      aria-label={label}
      onToggle={(event) => {
        const next = event.newState === "open";
        setOpen(next);
        onOpenChange?.(next);
      }}
      onClickCapture={(event) => {
        // Close before the action runs so a child dialog remembers its opener.
        if (
          closeOnSelect &&
          (event.target as HTMLElement).closest(
            "button:not(:disabled), a[href]",
          )
        ) {
          popup.current?.hidePopover();
          anchor.current?.focus({ preventScroll: true });
        }
      }}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation();
        const choices = items();
        const current = choices.indexOf(document.activeElement as HTMLElement);
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? choices.length - 1
              : (current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  choices.length) %
                choices.length;
        choices[index]?.focus();
      }}
    >
      {children}
    </div>
  );
  const trigger = (
    <button
      ref={anchor}
      type="button"
      className={visibleLabel ? "app-button secondary" : "app-icon"}
      aria-label={label}
      title={label}
      aria-expanded={open}
      popoverTarget={id}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
        event.preventDefault();
        popup.current?.showPopover();
        const choices = items();
        (event.key === "ArrowDown" ? choices[0] : choices.at(-1))?.focus();
      }}
    >
      {visibleLabel ?? icon}
    </button>
  );
  return (
    <>
      {portal ? <span ref={attachPortal}>{trigger}</span> : trigger}
      {portal ? host && createPortal(panel, host) : panel}
    </>
  );
}
