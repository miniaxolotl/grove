import { shortcuts } from "./workspace-shortcuts";

export const commandGroups = {
  note: "This note",
  create: "Create",
  navigate: "Navigate",
  help: "Help",
  manage: "Manage note",
} as const;

type CommandDefinition = {
  label: string;
  menuLabel?: string;
  group: keyof typeof commandGroups;
  icon:
    | "edit"
    | "save"
    | "focus"
    | "properties"
    | "share"
    | "history"
    | "move"
    | "export"
    | "archive"
    | "restore"
    | "delete"
    | "new"
    | "today"
    | "notes"
    | "ask"
    | "settings"
    | "help";
  order: number;
  keywords: string;
  shortcut?: string;
  danger?: boolean;
};

// Serializable metadata stays lightweight; feature owners supply live actions/state.
export const commandDefinitions = {
  "note-mode": {
    label: "Preview note",
    group: "note",
    icon: "edit",
    order: 10,
    keywords: "read writing edit preview",
    shortcut: shortcuts.mode,
  },
  "note-save": {
    label: "Save note",
    group: "note",
    icon: "save",
    order: 11,
    keywords: "persist changes",
    shortcut: shortcuts.save,
  },
  "note-focus": {
    label: "Focus mode",
    group: "note",
    icon: "focus",
    order: 12,
    keywords: "distraction free fullscreen",
    shortcut: shortcuts.focus,
  },
  "note-properties": {
    label: "Show note properties",
    group: "note",
    icon: "properties",
    order: 13,
    keywords: "details kind notebook",
  },
  "note-share": {
    label: "Share note",
    group: "note",
    icon: "share",
    order: 14,
    keywords: "public link publish",
  },
  "note-history": {
    label: "Revision history",
    group: "note",
    icon: "history",
    order: 15,
    keywords: "versions previous changes",
  },
  "note-export": {
    label: "Export note…",
    menuLabel: "Export…",
    group: "note",
    icon: "export",
    order: 16,
    keywords: "download pdf markdown copy",
  },
  new: {
    label: "New note",
    group: "create",
    icon: "new",
    order: 20,
    keywords: "create write add",
    shortcut: shortcuts.new,
  },
  today: {
    label: "Today’s note",
    group: "create",
    icon: "today",
    order: 21,
    keywords: "journal daily today",
  },
  notes: {
    label: "Go to Notes",
    group: "navigate",
    icon: "notes",
    order: 30,
    keywords: "home library browse",
  },
  ask: {
    label: "Ask Grove",
    group: "navigate",
    icon: "ask",
    order: 31,
    keywords: "chat question conversation",
  },
  archive: {
    label: "Open Archive",
    group: "navigate",
    icon: "archive",
    order: 32,
    keywords: "browse archived notes",
  },
  settings: {
    label: "Open Settings",
    group: "navigate",
    icon: "settings",
    order: 33,
    keywords: "preferences account models connections",
    shortcut: shortcuts.settings,
  },
  help: {
    label: "Keyboard shortcuts",
    group: "help",
    icon: "help",
    order: 40,
    keywords: "help hotkeys commands",
    shortcut: shortcuts.help,
  },
  "note-move": {
    label: "Move note",
    menuLabel: "Move",
    group: "manage",
    icon: "move",
    order: 50,
    keywords: "organize notebook file",
  },
  "note-archive": {
    label: "Archive note",
    menuLabel: "Archive",
    group: "manage",
    icon: "archive",
    order: 51,
    keywords: "set aside",
  },
  "note-restore": {
    label: "Restore note",
    menuLabel: "Restore",
    group: "manage",
    icon: "restore",
    order: 51,
    keywords: "unarchive recover",
  },
  "note-delete": {
    label: "Delete note…",
    group: "manage",
    icon: "delete",
    order: 52,
    keywords: "remove trash erase",
    danger: true,
  },
} satisfies Record<string, CommandDefinition>;

export type CommandId = keyof typeof commandDefinitions;
export type WorkspaceCommand = CommandDefinition & {
  id: CommandId;
  disabled?: boolean;
  disabledReason?: string;
  context?: string;
  run: () => void;
};

export function workspaceCommand(
  id: CommandId,
  run: () => void,
  state: Partial<
    Pick<WorkspaceCommand, "label" | "disabled" | "disabledReason">
  > = {},
): WorkspaceCommand {
  return { ...commandDefinitions[id], id, run, ...state };
}

export const normalizeCommandQuery = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Label matches outrank aliases; definition order breaks ties predictably. */
export function rankCommands(commands: WorkspaceCommand[], query: string) {
  const search = normalizeCommandQuery(query);
  const words = search.split(" ").filter(Boolean);
  return commands
    .map((command) => {
      const label = normalizeCommandQuery(command.label);
      const aliases = normalizeCommandQuery(command.keywords);
      const scores = words.map((word) =>
        label.split(" ").some((part) => part.startsWith(word))
          ? 4
          : label.includes(word)
            ? 2
            : aliases.split(" ").some((part) => part.startsWith(word))
              ? 1
              : 0,
      );
      const score = scores.some((value) => !value)
        ? -1
        : scores.reduce<number>((sum, value) => sum + value, 0) +
          (label === search ? 20 : label.startsWith(search) ? 8 : 0);
      return { command, score };
    })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.command.order - b.command.order)
    .map(({ command }) => command);
}
