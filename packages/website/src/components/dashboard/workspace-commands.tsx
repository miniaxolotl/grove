"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { Command, Keyboard } from "lucide-react";
import { Dialog } from "./dialog";
import { useCurrentNotebook } from "./notebooks-provider";
import { isActiveSurface, isTyping } from "@/lib/workspace-keyboard";
import {
  commandDefinitions,
  workspaceCommand,
  type WorkspaceCommand,
} from "@/lib/workspace-commands";
import {
  matchesShortcut,
  shortcuts,
  shortcutHint,
} from "@/lib/workspace-shortcuts";
import { Shortcut } from "./ui/shortcut";
import { CommandMenu } from "./command-menu";
type Registration = {
  root: RefObject<HTMLElement | null>;
  commands: WorkspaceCommand[];
  context?: string;
};
const Context = createContext<{
  register: (id: string, value?: Registration) => void;
  open: () => void;
  help: () => void;
} | null>(null);

export function useWorkspaceCommands(
  commands: WorkspaceCommand[],
  root: RefObject<HTMLElement | null>,
  contextLabel?: string,
) {
  const context = useContext(Context);
  const id = useId();
  const run = useEffectEvent((command: string) =>
    commands.find((item) => item.id === command && !item.disabled)?.run(),
  );
  const metadata = JSON.stringify(
    commands.map(({ run: _, ...command }) => command),
  );
  const register = context?.register;
  useEffect(() => {
    const items = JSON.parse(metadata) as WorkspaceCommand[];
    register?.(id, {
      root,
      context: contextLabel,
      commands: items.map((item) => ({ ...item, run: () => run(item.id) })),
    });
    return () => register?.(id);
  }, [register, id, metadata, root, contextLabel]);
}

export function WorkspaceCommands({ children }: { children: ReactNode }) {
  const router = useRouter();
  const notebook = useCurrentNotebook();
  const [registry, setRegistry] = useState(
    () => new Map<string, Registration>(),
  );
  const register = useCallback((id: string, value?: Registration) => {
    setRegistry((current) => {
      const next = new Map(current);
      if (value) next.set(id, value);
      else next.delete(id);
      return next;
    });
  }, []);
  const [opened, setOpened] = useState<"commands" | "help">();
  const [commandScope, setCommandScope] = useState<Element | null>(null);
  const global: WorkspaceCommand[] = [
    workspaceCommand("new", () =>
      router.push(
        `/app/notes/new${notebook ? `?notebook=${encodeURIComponent(notebook)}` : ""}`,
      ),
    ),
    workspaceCommand("today", () =>
      router.push(
        `/app/notes/new?from=journal${notebook ? `&notebook=${encodeURIComponent(notebook)}` : ""}`,
      ),
    ),
    workspaceCommand("notes", () => router.push("/app")),
    workspaceCommand("ask", () => router.push("/app/ask")),
    workspaceCommand("archive", () => router.push("/app/archive")),
    workspaceCommand("settings", () => router.push("/app/settings")),
    workspaceCommand("help", () => setOpened("help")),
  ];
  const getCommands = (scope?: Element | null) => [
    ...[...registry.values()]
      .filter(({ root }) =>
        scope === undefined
          ? isActiveSurface(root.current)
          : root.current?.isConnected &&
            root.current.closest("dialog") === scope,
      )
      .flatMap(({ commands, context }) =>
        commands.map((command) => ({ ...command, context })),
      ),
    ...global.filter(
      (command) =>
        !(scope === undefined
          ? document.querySelector("dialog[open]")
          : scope) || command.id === "help",
    ),
  ];
  const open = (mode: "commands" | "help") => {
    // Follow the underlying workspace if its first autosave changes the route.
    setCommandScope(
      [...document.querySelectorAll("dialog[open]")].at(-1) ?? null,
    );
    setOpened(mode);
  };
  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    const help = matchesShortcut(event, shortcuts.help);
    if (help || matchesShortcut(event, shortcuts.commands)) {
      event.preventDefault();
      if (!opened) open(help ? "help" : "commands");
      return;
    }
    if (opened) return;
    const command = getCommands().find(
      (item) => item.shortcut && matchesShortcut(event, item.shortcut),
    );
    if (!command) return;
    // Native text shortcuts remain local; explicit app chords work in editors.
    if (
      isTyping(event.target) &&
      ![
        "note-save",
        "note-mode",
        "note-focus",
        "note-outline",
        "settings",
        "new",
      ].includes(command.id)
    )
      return;
    event.preventDefault();
    if (!command.disabled) command.run();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKey(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
  return (
    <Context.Provider
      value={{
        register,
        open: () => open("commands"),
        help: () => open("help"),
      }}
    >
      {children}
      {opened === "commands" && (
        <CommandMenu
          commands={getCommands(commandScope)}
          close={() => setOpened(undefined)}
        />
      )}
      {opened === "help" && (
        <Dialog title="Keyboard shortcuts" close={() => setOpened(undefined)}>
          <p className="shortcut-intro">
            Use ⌘ on Mac or Ctrl on Windows and Linux.
          </p>
          <dl className="shortcut-list">
            {[
              ["Command menu", shortcuts.commands],
              ["Search notes", shortcuts.search],
              ...(
                ["new", "settings", "help", "note-save", "note-focus"] as const
              ).map((id) => [
                commandDefinitions[id].label,
                commandDefinitions[id].shortcut,
              ]),
              ["Edit / preview note", shortcuts.mode],
              ["Jump to heading", shortcuts.outline],
              ["Previous / next note in drawer", "← / →"],
              ["Navigate note list or commands", "↑ / ↓"],
              ["Open focused note or command", "Enter"],
              ["Delete note (with confirmation)", "Delete"],
              ["Close menu, drawer or focus mode", "Esc"],
              [
                "Undo / redo note changes",
                `${shortcuts.undo} / ${shortcuts.redo}`,
              ],
              ["Bold / italic", "Mod B / Mod I"],
              ["Insert link while writing", "Mod K"],
            ].map(([label, keys]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <Shortcut>{keys}</Shortcut>
                </dd>
              </div>
            ))}
          </dl>
          <p className="shortcut-intro">
            Arrow and Delete actions apply when you’re browsing notes. While
            writing, they edit your text. Drag handles keep their Space and
            arrow controls.
          </p>
        </Dialog>
      )}
    </Context.Provider>
  );
}

export function CommandMenuButton({
  menuItem = false,
}: {
  menuItem?: boolean;
}) {
  const context = useContext(Context);
  return (
    <button
      className={
        menuItem ? "note-mobile-menu-item" : "workspace-command-launcher"
      }
      type="button"
      aria-label="Commands"
      title={`Commands (${shortcutHint(shortcuts.commands)})`}
      onClick={context?.open}
    >
      <Command size={16} aria-hidden="true" />
      <span>Commands</span>
      {!menuItem && <Shortcut>{shortcuts.commands}</Shortcut>}
    </button>
  );
}
export function ShortcutHelpButton({ compact = false }: { compact?: boolean }) {
  const context = useContext(Context);
  return (
    <button
      type="button"
      onClick={context?.help}
      className={compact ? "app-icon" : undefined}
      aria-label="Keyboard shortcuts"
      title={`Keyboard shortcuts (${shortcutHint(shortcuts.help)})`}
    >
      <Keyboard size={15} /> {!compact && "Keyboard shortcuts"}
    </button>
  );
}
