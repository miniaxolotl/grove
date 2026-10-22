"use client";

import { useRef } from "react";
import { Archive, ArchiveRestore, FolderInput, X } from "lucide-react";

/** Selection shares the list's header so checking a note never moves its row. */
export function LibrarySelection({
  count,
  allSelected,
  limited,
  busy,
  archive,
  onSelectAll,
  onClear,
  onMove,
  onArchive,
}: {
  count: number;
  allSelected: boolean;
  limited: boolean;
  busy: boolean;
  archive: boolean;
  onSelectAll: (selected: boolean) => void;
  onClear: () => void;
  onMove: () => void;
  onArchive: () => void;
}) {
  const checkbox = useRef<HTMLInputElement>(null);
  function clear() {
    checkbox.current?.focus({ preventScroll: true });
    onClear();
  }
  return (
    <div
      className="library-selection-header"
      data-active={count > 0 || undefined}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !event.nativeEvent.isComposing &&
          count > 0 &&
          !busy
        ) {
          event.preventDefault();
          event.stopPropagation();
          clear();
        }
      }}
    >
      <label className="select-loaded">
        <input
          ref={(element) => {
            checkbox.current = element;
            if (element) element.indeterminate = count > 0 && !allSelected;
          }}
          type="checkbox"
          disabled={busy}
          checked={allSelected}
          aria-label={`Select these notes${limited ? " (first 50)" : ""}`}
          onChange={(event) => onSelectAll(event.target.checked)}
        />
        <span role="status" aria-live="polite" aria-atomic="true">
          {count > 0
            ? `${count} selected`
            : `Select these notes${limited ? " (first 50)" : ""}`}
        </span>
      </label>
      {count > 0 && (
        <div
          className="selection-toolbar"
          role="group"
          aria-label="Selected notes"
        >
          <button
            type="button"
            disabled={busy}
            onClick={onMove}
            aria-label="Move"
            title="Move selected notes"
          >
            <FolderInput size={16} />
            <span>Move</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onArchive}
            aria-label={archive ? "Restore" : "Archive"}
            title={
              archive ? "Restore selected notes" : "Archive selected notes"
            }
          >
            {archive ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            <span>{archive ? "Restore" : "Archive"}</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={clear}
            aria-label="Clear selection"
            title="Clear selection (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
