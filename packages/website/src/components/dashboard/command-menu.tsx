"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { CornerDownLeft, FileText } from "lucide-react";
import {
  commandGroups,
  normalizeCommandQuery,
  rankCommands,
  type WorkspaceCommand,
} from "@/lib/workspace-commands";
import { PaletteDialog } from "./ui/palette-dialog";
import { CommandIcon } from "./ui/command-icon";
import { Shortcut } from "./ui/shortcut";

function MatchLabel({ label, query }: { label: string; query: string }) {
  const words = normalizeCommandQuery(query).split(" ").filter(Boolean);
  // Preserve the original label and punctuation; aliases need no invented highlight.
  return label
    .split(/(\s+)/)
    .map((part, index) =>
      words.some((word) => normalizeCommandQuery(part).includes(word)) ? (
        <mark key={index}>{part}</mark>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      ),
    );
}

export function CommandMenu({
  commands,
  close,
}: {
  commands: WorkspaceCommand[];
  close: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = rankCommands(commands, query);
  const active =
    items.find((item) => item.id === selected && !item.disabled) ??
    items.find((item) => !item.disabled);
  const context = commands.find((command) => command.context)?.context;
  const searching = !!normalizeCommandQuery(query);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active?.id, query]);

  function execute(command: WorkspaceCommand) {
    if (command.disabled) return;
    close();
    command.run();
  }
  const groups = searching
    ? [{ id: "results", label: "Results", items }]
    : Object.entries(commandGroups).map(([id, label]) => ({
        id,
        label,
        items: items.filter((command) => command.group === id),
      }));

  return (
    <PaletteDialog
      title="Command menu"
      close={close}
      search={{
        label: "Search commands",
        placeholder: "Search commands…",
        value: query,
        onChange: (value) => {
          setQuery(value);
          setSelected(undefined);
        },
        role: "combobox",
        "aria-expanded": true,
        "aria-controls": id,
        "aria-autocomplete": "list",
        "aria-activedescendant": active ? `${id}-${active.id}` : undefined,
        onKeyDown: (event) => {
          if (event.nativeEvent.isComposing) return;
          // Home/End and modified arrows retain native text-editing behavior.
          if (
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.shiftKey &&
            ["ArrowDown", "ArrowUp"].includes(event.key)
          ) {
            event.preventDefault();
            const enabled = items.filter((item) => !item.disabled);
            const index = enabled.findIndex((item) => item.id === active?.id);
            setSelected(
              enabled[
                (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  enabled.length) %
                  (enabled.length || 1)
              ]?.id,
            );
          }
          if (event.key === "Enter" && !event.repeat && active) {
            event.preventDefault();
            execute(active);
          }
        },
      }}
      footer={
        <>
          <span className="palette-keyboard-hint">
            <Shortcut>↑ ↓</Shortcut> Navigate <Shortcut>Enter</Shortcut> Run
          </span>
          <span className="palette-touch-hint">Tap a command to run it</span>
          <span
            className="palette-result-count"
            aria-live={items.length ? "polite" : "off"}
            aria-atomic="true"
          >
            {items.length} {items.length === 1 ? "command" : "commands"}
          </span>
        </>
      }
    >
      {context && (
        <div className="palette-context">
          <FileText size={14} aria-hidden="true" />
          <span>{context}</span>
        </div>
      )}
      <div className="command-results-frame">
        <div
          ref={list}
          id={id}
          role="listbox"
          aria-label="Commands"
          className="command-results"
        >
          {groups
            .filter((group) => group.items.length)
            .map((group) => (
              <div
                role="group"
                aria-labelledby={`${id}-${group.id}-heading`}
                key={group.id}
              >
                <div
                  id={`${id}-${group.id}-heading`}
                  className="palette-group-heading"
                >
                  {group.label}
                </div>
                {group.items.map((command) => (
                  <div
                    key={command.id}
                    id={`${id}-${command.id}`}
                    role="option"
                    aria-selected={active?.id === command.id}
                    aria-disabled={command.disabled || undefined}
                    className={`palette-option${command.danger ? " palette-option-danger" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onPointerMove={(event) => {
                      if (
                        event.pointerType === "mouse" &&
                        (event.movementX || event.movementY) &&
                        !command.disabled
                      )
                        setSelected(command.id);
                    }}
                    onClick={() => execute(command)}
                  >
                    <CommandIcon name={command.icon} />
                    <span className="palette-option-copy">
                      <MatchLabel label={command.label} query={query} />
                      {command.disabled && command.disabledReason && (
                        <small>{command.disabledReason}</small>
                      )}
                    </span>
                    {command.shortcut ? (
                      <Shortcut>{command.shortcut}</Shortcut>
                    ) : (
                      <CornerDownLeft
                        className="palette-enter"
                        size={14}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                ))}
              </div>
            ))}
        </div>
        {!items.length && (
          <div className="command-empty">
            <p role="status">No matching commands.</p>
            <p>Try “create”, “journal”, or “settings”.</p>
          </div>
        )}
      </div>
    </PaletteDialog>
  );
}
