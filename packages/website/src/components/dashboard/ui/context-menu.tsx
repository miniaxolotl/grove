"use client";

import { useEffectEvent, useLayoutEffect, useRef, type ReactNode } from "react";
import { overlayViewport } from "./overlay-focus";

export type ContextAction = {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  separator?: boolean;
  danger?: boolean;
  run: () => void;
};

/** A point-anchored menu using the same top layer and styling as ActionMenu. */
export function ContextMenu({
  x,
  y,
  label,
  actions,
  close,
  restoreFocus,
  surface,
}: {
  x: number;
  y: number;
  label: string;
  actions: ContextAction[];
  close: () => void;
  restoreFocus: () => void;
  surface: HTMLElement;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const restore = useEffectEvent(restoreFocus);
  const dismiss = () => {
    popup.current?.hidePopover();
    restoreFocus();
    close();
  };
  useLayoutEffect(() => {
    const element = popup.current!;
    element.showPopover();
    const place = () => {
      const bounds = overlayViewport();
      const left = bounds.left + 8;
      const top = bounds.top + 8;
      const right = bounds.left + bounds.width - 8;
      const bottom = bounds.top + bounds.height - 8;
      element.style.maxWidth = `${Math.max(0, right - left)}px`;
      element.style.maxHeight = `${Math.max(0, bottom - top)}px`;
      const rect = element.getBoundingClientRect();
      element.style.left = `${Math.max(left, Math.min(x, right - rect.width))}px`;
      element.style.top = `${Math.max(top, Math.min(y, bottom - rect.height))}px`;
    };
    place();
    element
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    observer.observe(element);
    const viewport = window.visualViewport;
    window.addEventListener("resize", place);
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    // A context belongs to the point clicked, not to content scrolled underneath it.
    const positions = new Map<Element, { top: number; left: number }>();
    for (
      let parent: Element | null = surface;
      parent;
      parent = parent.parentElement
    )
      positions.set(parent, { top: parent.scrollTop, left: parent.scrollLeft });
    const scroll = (event: Event) => {
      const target =
        event.target === document ? document.scrollingElement : event.target;
      if (!(target instanceof Element)) return;
      const previous = positions.get(target);
      // A queued pre-open scroll event must not dismiss a newly opened menu.
      if (
        previous &&
        (previous.top !== target.scrollTop ||
          previous.left !== target.scrollLeft)
      )
        element.hidePopover();
    };
    document.addEventListener("scroll", scroll, true);
    // Contextmenu fires before pointerup in WebKit. An auto popover opened in
    // that gesture is immediately light-dismissed by the same pointerup.
    // Manual top-layer placement plus pointerdown dismissal avoids that race.
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) element.hidePopover();
    };
    const blur = () => element.hidePopover();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", blur);
    return () => {
      if (element.contains(document.activeElement)) restore();
      observer.disconnect();
      window.removeEventListener("resize", place);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", blur);
    };
  }, [x, y, surface]);
  return (
    <div
      ref={popup}
      popover="manual"
      role="menu"
      aria-label={label}
      className="action-menu note-context-menu"
      onContextMenu={(event) => event.preventDefault()}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          popup.current?.hidePopover();
      }}
      onToggle={(event) => {
        if (event.newState === "closed") {
          if (event.currentTarget.contains(document.activeElement))
            restoreFocus();
          close();
        }
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          dismiss();
          return;
        }
        const choices = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        ];
        const index = choices.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? choices.length - 1
              : event.key === "ArrowDown"
                ? (index + 1) % choices.length
                : event.key === "ArrowUp"
                  ? (index - 1 + choices.length) % choices.length
                  : choices.findIndex(
                      (item, offset) =>
                        offset > index &&
                        item.textContent
                          ?.trim()
                          .toLowerCase()
                          .startsWith(event.key.toLowerCase()),
                    );
        if (
          ["Home", "End", "ArrowDown", "ArrowUp"].includes(event.key) ||
          (event.key.length === 1 && next >= 0)
        ) {
          event.preventDefault();
          choices[next]?.focus();
        }
      }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={action.disabled}
          className={
            `${action.separator ? "action-group-start" : ""} ${action.danger ? "action-danger" : ""}`.trim() ||
            undefined
          }
          onClick={() => {
            dismiss();
            action.run();
          }}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>
  );
}
