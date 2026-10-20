"use client";
import { useId, useRef, useState, type ReactNode } from "react";
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
  const [position, setPosition] = useState({ top: 0, left: 0 });
  return (
    <>
      <button
        type="button"
        className="app-icon"
        aria-label={label}
        title={label}
        popoverTarget={id}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({
            top: Math.min(rect.bottom + 4, window.innerHeight - 220),
            left: Math.max(
              8,
              Math.min(rect.right - 200, window.innerWidth - 208),
            ),
          });
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      <div
        ref={popup}
        id={id}
        popover="auto"
        className="action-menu"
        style={position}
        aria-label={label}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, a"))
            popup.current?.hidePopover();
        }}
      >
        {children}
      </div>
    </>
  );
}
