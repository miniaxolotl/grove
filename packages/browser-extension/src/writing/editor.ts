import { eligibleEditor, type EditorMetadata } from "./core.ts";

/** Read bounded static label nodes only, never a descendant editor's contents. */
function editorLabel(element: HTMLElement, control: boolean) {
  const parts: string[] = [];
  let nodes = 128,
    characters = 512,
    complete = true;
  const append = (text: string | null) => {
    if (!text) return;
    if (text.length > characters) {
      complete = false;
      return;
    }
    characters -= text.length;
    parts.push(text);
  };
  const visit = (node: Node) => {
    if (--nodes < 0) {
      complete = false;
      return;
    }
    if (
      node instanceof Element &&
      node.matches(
        "input, textarea, select, button, script, style, template, [contenteditable], [role='textbox']",
      )
    )
      return;
    if (node.nodeType === Node.TEXT_NODE) append(node.nodeValue);
    else
      for (
        let child = node.firstChild;
        child && complete;
        child = child.nextSibling
      )
        visit(child);
  };
  append(element.getAttribute("aria-label"));
  append(element.getAttribute("name"));
  append(element.id);
  const references = element.getAttribute("aria-labelledby") ?? "";
  if (references.length > 512) complete = false;
  else {
    const ids = references.trim().split(/\s+/).filter(Boolean);
    if (ids.length > 8) complete = false;
    else
      for (const id of ids) {
        const label = (
          element.getRootNode() as Document | ShadowRoot
        ).getElementById(id);
        if (label) visit(label);
        else complete = false;
      }
  }
  if (control) {
    const labels = (element as HTMLTextAreaElement | HTMLInputElement).labels;
    if ((labels?.length ?? 0) > 8) complete = false;
    else for (const label of labels ?? []) visit(label);
  }
  return { label: parts.join(" "), labelComplete: complete };
}

export function editorMetadata(element: HTMLElement): EditorMetadata {
  const style = getComputedStyle(element);
  const textarea = element instanceof HTMLTextAreaElement;
  const input = element instanceof HTMLInputElement;
  const ancestors: HTMLElement[] = [];
  for (
    let node: HTMLElement | null = element;
    node && ancestors.length < 64;
  ) {
    ancestors.push(node);
    node =
      node.parentElement ??
      ((node.getRootNode() as ShadowRoot).host as HTMLElement | undefined) ??
      null;
  }
  const within = (selector: string) =>
    ancestors.some((node) => node.matches(selector));
  return {
    tag: element.tagName,
    type: input ? element.type : undefined,
    inputmode: element.getAttribute("inputmode") ?? "",
    visible:
      element.isConnected &&
      !!element.getClientRects().length &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      style.opacity !== "0",
    rows: textarea ? element.rows : undefined,
    editable: element.isContentEditable,
    multiline: element.hasAttribute("aria-multiline")
      ? element.getAttribute("aria-multiline") === "true"
      : undefined,
    disabled: within("[disabled], [aria-disabled='true']"),
    readonly: within("[readonly], [aria-readonly='true']"),
    inert:
      within(
        "[inert], [hidden], [aria-hidden='true'], [data-grove-writing-ui]",
      ) ||
      ancestors.length >= 64 ||
      ancestors.some((node) => {
        const style = getComputedStyle(node);
        return (
          style.visibility === "hidden" ||
          style.display === "none" ||
          style.opacity === "0"
        );
      }),
    spellcheck: element.spellcheck && !within("[spellcheck='false']"),
    autocomplete: element.getAttribute("autocomplete") ?? "",
    ...editorLabel(element, textarea || input),
    name: element.getAttribute("name") ?? "",
    code: within(
      ".monaco-editor, .CodeMirror, .cm-editor, [data-language], [role='search'], [role='searchbox'], pre, code",
    ),
  };
}

export function isWritingEditor(element: HTMLElement) {
  if (!element.isConnected) return false;
  return eligibleEditor(editorMetadata(element), { proseFields: true });
}

/** Resolve only the focused editing root, not arbitrary page text. */
export function writingEditorFrom(
  target: EventTarget | null,
): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement
  )
    return target;
  if (!target.isContentEditable) return null;
  let root = target;
  while (root.parentElement?.isContentEditable) root = root.parentElement;
  return root;
}
