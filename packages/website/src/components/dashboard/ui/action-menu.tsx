"use client";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MoreHorizontal } from "lucide-react";

/** Native popover gives all action menus light-dismiss, Escape and focus return. */
export function ActionMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
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
      const left = (viewport?.offsetLeft ?? 0) + edge;
      const top = (viewport?.offsetTop ?? 0) + edge;
      const right = left + (viewport?.width ?? window.innerWidth) - edge * 2;
      const bottom = top + (viewport?.height ?? window.innerHeight) - edge * 2;
      const rect = trigger.getBoundingClientRect();
      element.style.maxWidth = `${Math.max(0, right - left)}px`;
      element.style.maxHeight = `${Math.max(0, bottom - top)}px`;
      const menu = element.getBoundingClientRect();
      const y =
        rect.bottom + 4 + menu.height <= bottom
          ? rect.bottom + 4
          : rect.top - menu.height - 4;
      element.style.left = `${Math.max(left, Math.min(rect.right - menu.width, right - menu.width))}px`;
      element.style.top = `${Math.max(top, Math.min(y, bottom - menu.height))}px`;
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    observer.observe(trigger);
    // Capture scrolls from nested readers and notebook explorers too.
    document.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [open]);
  const items = () =>
    [
      ...popup.current!.querySelectorAll<HTMLElement>(
        "button:not(:disabled), a[href]",
      ),
    ].filter((item) => item.getClientRects().length);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="app-icon"
        aria-label={label}
        title={label}
        popoverTarget={id}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
          event.preventDefault();
          popup.current?.showPopover();
          const choices = items();
          (event.key === "ArrowDown" ? choices[0] : choices.at(-1))?.focus();
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      <div
        ref={popup}
        id={id}
        popover="auto"
        className="action-menu"
        role="group"
        aria-label={label}
        onToggle={(event) => setOpen(event.newState === "open")}
        onClickCapture={(event) => {
          // Close before the action runs so a child dialog remembers its opener.
          if (
            (event.target as HTMLElement).closest(
              "button:not(:disabled), a[href]",
            )
          )
            popup.current?.hidePopover();
        }}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          event.stopPropagation();
          const choices = items();
          const current = choices.indexOf(
            document.activeElement as HTMLElement,
          );
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
    </>
  );
}
