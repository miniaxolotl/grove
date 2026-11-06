import { eligibleEditor, type EditorMetadata } from "./core.ts";

/** Read bounded static label nodes only, never a descendant editor's contents. */
function editorLabel(element: HTMLElement, textarea: boolean) {
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
        const label = element.ownerDocument.getElementById(id);
        if (label) visit(label);
        else complete = false;
      }
  }
  if (textarea) {
    const labels = (element as HTMLTextAreaElement).labels;
    if ((labels?.length ?? 0) > 8) complete = false;
    else for (const label of labels ?? []) visit(label);
  }
  return { label: parts.join(" "), labelComplete: complete };
}

export function editorMetadata(element: HTMLElement): EditorMetadata {
  const style = getComputedStyle(element);
  const textarea = element instanceof HTMLTextAreaElement;
  return {
    tag: element.tagName,
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
    disabled:
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true",
    readonly:
      element.hasAttribute("readonly") ||
      element.getAttribute("aria-readonly") === "true",
    inert: !!element.closest("[inert], [hidden], [aria-hidden='true']"),
    spellcheck: element.spellcheck,
    autocomplete: element.getAttribute("autocomplete") ?? "",
    ...editorLabel(element, textarea),
    name: element.getAttribute("name") ?? "",
    code: !!element.closest(
      ".monaco-editor, .CodeMirror, .cm-editor, [data-language], [role='search'], pre, code",
    ),
  };
}

export function isWritingEditor(element: HTMLElement) {
  return eligibleEditor(editorMetadata(element));
}
