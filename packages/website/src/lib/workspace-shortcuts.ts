/** Shared by keyboard matching, launchers, command rows and shortcut help. */
export const shortcuts = {
  commands: "Mod Shift P",
  search: "Mod K",
  new: "Mod Alt N",
  settings: "Mod ,",
  help: "Mod /",
  mode: "Mod E",
  save: "Mod S",
  focus: "Mod Shift F",
  outline: "Mod Alt O",
  undo: "Mod Z",
  redo: "Mod Shift Z",
} as const;

export const shortcutHint = (shortcut: string) =>
  shortcut.replaceAll("Mod", "⌘ / Ctrl");

export function matchesShortcut(event: KeyboardEvent, shortcut: string) {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.getModifierState("AltGraph")
  )
    return false;
  const keys = shortcut.toLowerCase().split(" ");
  const key = keys.at(-1);
  // Option can produce a different printable character on Apple keyboards.
  const actual =
    event.altKey && event.code.startsWith("Key")
      ? event.code.slice(3).toLowerCase()
      : event.key.toLowerCase();
  return (
    (event.metaKey || event.ctrlKey) === keys.includes("mod") &&
    event.shiftKey === keys.includes("shift") &&
    event.altKey === keys.includes("alt") &&
    actual === key
  );
}
