"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { Keyboard, Search } from "lucide-react";
import { Dialog } from "./dialog";
import { useCurrentNotebook } from "./notebooks-provider";
import { isActiveSurface, isTyping } from "@/lib/workspace-keyboard";

export type WorkspaceCommand = {
  id: string;
  label: string;
  shortcut?: string;
  key?: string;
  shift?: boolean;
  alt?: boolean;
  disabled?: boolean;
  run: () => void;
};
type Registration = {
  root: RefObject<HTMLElement | null>;
  commands: WorkspaceCommand[];
};
const Context = createContext<{
  register: (id: string, value?: Registration) => void;
  open: () => void;
  help: () => void;
} | null>(null);

export function useWorkspaceCommands(
  commands: WorkspaceCommand[],
  root: RefObject<HTMLElement | null>,
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
      commands: items.map((item) => ({ ...item, run: () => run(item.id) })),
    });
    return () => register?.(id);
  }, [register, id, metadata, root]);
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
    {
      id: "new",
      label: "New note",
      shortcut: "Mod Alt N",
      key: "n",
      alt: true,
      run: () =>
        router.push(
          `/app/notes/new${notebook ? `?notebook=${encodeURIComponent(notebook)}` : ""}`,
        ),
    },
    {
      id: "today",
      label: "Today’s note",
      run: () =>
        router.push(
          `/app/notes/new?from=journal${notebook ? `&notebook=${encodeURIComponent(notebook)}` : ""}`,
        ),
    },
    { id: "notes", label: "Go to Notes", run: () => router.push("/app") },
    { id: "ask", label: "Ask Grove", run: () => router.push("/app/ask") },
    {
      id: "archive",
      label: "Open Archive",
      run: () => router.push("/app/archive"),
    },
    {
      id: "settings",
      label: "Open Settings",
      shortcut: "Mod ,",
      key: ",",
      run: () => router.push("/app/settings"),
    },
    {
      id: "help",
      label: "Keyboard shortcuts",
      shortcut: "Mod /",
      key: "/",
      run: () => setOpened("help"),
    },
  ];
  const getCommands = (scope?: Element | null) => [
    ...[...registry.values()]
      .filter(({ root }) =>
        scope === undefined
          ? isActiveSurface(root.current)
          : root.current?.isConnected &&
            root.current.closest("dialog") === scope,
      )
      .flatMap(({ commands }) => commands),
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
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.repeat ||
      event.getModifierState("AltGraph")
    )
      return;
    const mod = event.metaKey || event.ctrlKey;
    const key =
      event.altKey && event.code === "KeyN" ? "n" : event.key.toLowerCase();
    if (
      mod &&
      !event.altKey &&
      ((key === "p" && event.shiftKey) || key === "/")
    ) {
      event.preventDefault();
      if (!opened) open(key === "/" ? "help" : "commands");
      return;
    }
    if (opened || !mod) return;
    const command = getCommands().find(
      (item) =>
        item.key === key &&
        !!item.shift === event.shiftKey &&
        !!item.alt === event.altKey,
    );
    if (!command) return;
    // Native text shortcuts remain local; explicit app chords work in editors.
    if (isTyping(event.target) && !["s", "e", "f", ",", "n"].includes(key))
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
              ["Command menu", "Mod Shift P"],
              ["Search notes", "Mod K"],
              ["New note", "Mod Alt N"],
              ["Settings", "Mod ,"],
              ["Shortcut help", "Mod /"],
              ["Edit / preview note", "Mod E"],
              ["Save note", "Mod S"],
              ["Focus mode", "Mod Shift F"],
              ["Previous / next note in drawer", "← / →"],
              ["Navigate note list or commands", "↑ / ↓"],
              ["Open focused note or command", "Enter"],
              ["Delete note (with confirmation)", "Delete"],
              ["Close menu, drawer or focus mode", "Esc"],
              ["Undo / redo writing", "Mod Z / Mod Shift Z"],
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

const subscribePlatform = () => () => {};
export function Shortcut({ children }: { children: string }) {
  const mac = useSyncExternalStore(
    subscribePlatform,
    () => /Mac|iPhone|iPad/.test(navigator.platform + navigator.userAgent),
    () => false,
  );
  return <kbd>{children.replaceAll("Mod", mac ? "⌘" : "Ctrl")}</kbd>;
}

export function CommandMenuButton() {
  const context = useContext(Context);
  return (
    <button
      className="workspace-command-launcher"
      type="button"
      onClick={context?.open}
    >
      <Search size={15} /> Commands <Shortcut>Mod Shift P</Shortcut>
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
      title="Keyboard shortcuts (⌘ / Ctrl /)"
    >
      <Keyboard size={15} /> {!compact && "Keyboard shortcuts"}
    </button>
  );
}

function CommandMenu({
  commands,
  close,
}: {
  commands: WorkspaceCommand[];
  close: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = commands.filter(
    (command) =>
      !command.disabled &&
      query
        .toLowerCase()
        .split(/\s+/)
        .every((word) => command.label.toLowerCase().includes(word)),
  );
  const active = Math.min(index, Math.max(items.length - 1, 0));
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, query]);
  function execute(command: WorkspaceCommand) {
    close();
    command.run();
  }
  return (
    <Dialog title="Command menu" close={close}>
      <div className="command-menu">
        <input
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-controls={id}
          aria-autocomplete="list"
          aria-activedescendant={items.length ? `${id}-${active}` : undefined}
          placeholder="What would you like to do?"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              setIndex(
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? Math.max(items.length - 1, 0)
                    : (active +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      (items.length || 1),
              );
            }
            if (event.key === "Enter" && items[active]) {
              event.preventDefault();
              execute(items[active]);
            }
          }}
        />
        <div
          ref={list}
          id={id}
          role="listbox"
          aria-label="Commands"
          className="command-results"
        >
          {items.map((command, i) => (
            <div
              key={command.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setIndex(i)}
              onClick={() => execute(command)}
            >
              <span>{command.label}</span>
              {command.shortcut && <Shortcut>{command.shortcut}</Shortcut>}
            </div>
          ))}
        </div>
        {!items.length && <p role="status">No matching commands.</p>}
        <p className="command-hint">
          ↑ ↓ to choose · Enter to run · Esc to close
        </p>
      </div>
    </Dialog>
  );
}
