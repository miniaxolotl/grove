"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type HTMLAttributes,
  type RefObject,
} from "react";

/** Reveal actions without taking vertical scrolling, pinch or a second contact. */
export function useRowSwipe(
  element: RefObject<HTMLDivElement | null>,
  disabled: boolean,
  reveal: () => void,
) {
  const pointer = useRef<{
    id: number;
    x: number;
    y: number;
    horizontal: boolean;
  } | null>(null);
  const consumed = useRef<{ id: number; until: number } | null>(null);
  const cancel = useCallback(() => {
    const start = pointer.current;
    if (!start) return;
    pointer.current = null;
    if (start && element.current?.hasPointerCapture(start.id))
      element.current.releasePointerCapture(start.id);
    if (element.current) {
      element.current.style.removeProperty("transform");
      element.current.removeAttribute("data-swiping");
    }
  }, [element]);
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);
  useEffect(() => {
    const interrupt = (event: PointerEvent) => {
      if (pointer.current && event.pointerId !== pointer.current.id) cancel();
    };
    document.addEventListener("pointerdown", interrupt, true);
    document.addEventListener("scroll", cancel, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      cancel();
      document.removeEventListener("pointerdown", interrupt, true);
      document.removeEventListener("scroll", cancel, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, [cancel]);
  const handlers: HTMLAttributes<HTMLDivElement> = {
    onPointerDown(event) {
      if (!event.isPrimary) {
        cancel();
        return;
      }
      consumed.current = null;
      if (
        disabled ||
        event.pointerType !== "touch" ||
        event.button !== 0 ||
        event.clientX < 24 ||
        event.clientX > window.innerWidth - 24 ||
        (event.target as Element).closest(
          "input, label, a, .drag-handle, .memory-actions, .memory-tags, .row-controls",
        ) ||
        window.getSelection()?.isCollapsed === false
      )
        return;
      pointer.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        horizontal: false,
      };
    },
    onPointerMove(event) {
      const start = pointer.current;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!start.horizontal) {
        if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx) / 1.5) {
          cancel();
          return;
        }
        if (Math.abs(dx) <= 16 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
        start.horizontal = true;
        event.currentTarget.setPointerCapture(start.id);
        event.currentTarget.dataset.swiping = "true";
      }
      consumed.current = { id: start.id, until: performance.now() + 700 };
      event.currentTarget.style.transform = `translateX(${Math.max(-80, Math.min(80, dx * 0.5))}px)`;
    },
    onPointerUp(event) {
      const start = pointer.current;
      if (!start || start.id !== event.pointerId) return;
      if (
        !disabled &&
        start.horizontal &&
        Math.abs(event.clientX - start.x) > 64
      )
        reveal();
      cancel();
    },
    onPointerCancel: cancel,
    onLostPointerCapture(event) {
      // Transferring implicit title capture to the row isn't cancellation.
      if (
        event.target === event.currentTarget &&
        !event.currentTarget.hasPointerCapture(event.pointerId)
      )
        cancel();
    },
    onClickCapture(event) {
      const click = consumed.current;
      const id = (event.nativeEvent as PointerEvent).pointerId;
      if (
        click &&
        event.detail > 0 &&
        performance.now() < click.until &&
        (id === undefined || id === click.id)
      ) {
        consumed.current = null;
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
  return handlers;
}
