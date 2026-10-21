export function isTyping(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      "input, textarea, select, [contenteditable=true], [role=combobox], [role=listbox], [role=menu], [role=slider]",
    )
  );
}

export function isActiveSurface(element: HTMLElement | null) {
  if (!element) return false;
  const modal = [...document.querySelectorAll("dialog[open]")].at(-1);
  return !modal || modal.contains(element);
}
