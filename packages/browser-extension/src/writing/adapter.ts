import { PROOFING_CONTENT_MAX } from "@lib/shared/limits";
import { isWritingEditor } from "./editor.ts";

type Point = { node: Node; offset: number };
const excluded =
  "script,style,template,noscript,code,pre,input,textarea,select,button,img,video,audio,[hidden],[inert],[aria-hidden='true'],[readonly],[disabled],[aria-readonly='true'],[aria-disabled='true'],[contenteditable='false'],[contenteditable='true'],[role='textbox'],[role='search'],[role='searchbox'],[spellcheck='false']";
export type EditorSnapshot = {
  text: string;
  complete: boolean;
  range: (from: number, to: number) => Range | null;
  rects?: () => DOMRect[];
};
export class WritingAdapter {
  constructor(readonly element: HTMLElement) {}
  get control() {
    return this.element instanceof HTMLTextAreaElement ||
      this.element instanceof HTMLInputElement
      ? this.element
      : null;
  }
  read(): EditorSnapshot {
    if (!isWritingEditor(this.element))
      return { text: "", complete: false, range: () => null };
    if (this.control) {
      const value = this.control.value;
      return { text: value, complete: true, range: () => null };
    }
    let text = "",
      budget = 4096,
      complete = true;
    const points: Point[] = [];
    const skipped: HTMLElement[] = [];
    const rendered: Range[] = [];
    const append = (value: string, node: Node, offset = 0, literal = false) => {
      const bounded = value.slice(0, PROOFING_CONTENT_MAX + 1 - text.length);
      if (bounded.length < value.length) complete = false;
      if (literal && bounded.length) {
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, bounded.length);
        rendered.push(range);
      }
      for (let index = 0; index < bounded.length; index++)
        points[text.length + index] = {
          node,
          offset: literal ? index : offset,
        };
      text += bounded;
      points[text.length] = { node, offset: literal ? bounded.length : offset };
    };
    const visit = (node: Node, depth: number) => {
      if (--budget < 0 || depth > 64 || text.length > PROOFING_CONTENT_MAX) {
        complete = false;
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        append(node.nodeValue ?? "", node, 0, true);
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      const skip = () => {
        skipped.push(node);
        if (text && !text.endsWith("\n"))
          append(
            "\n",
            node.parentNode!,
            Array.prototype.indexOf.call(node.parentNode!.childNodes, node) + 1,
          );
      };
      if (node !== this.element) {
        if (node.matches(excluded)) {
          skip();
          return;
        }
        const style = getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        ) {
          skip();
          return;
        }
      }
      if (node.tagName === "BR") {
        append(
          "\n",
          node.parentNode!,
          Array.prototype.indexOf.call(node.parentNode!.childNodes, node),
        );
        return;
      }
      const block =
        /^(DIV|P|LI|BLOCKQUOTE|H[1-6])$/.test(node.tagName) &&
        node !== this.element;
      if (block && text && !text.endsWith("\n")) append("\n", node, 0);
      for (const child of node.childNodes) {
        if (budget < 0 || text.length > PROOFING_CONTENT_MAX) {
          complete = false;
          break;
        }
        visit(child, depth + 1);
      }
      if (block && text && !text.endsWith("\n"))
        append("\n", node, node.childNodes.length);
    };
    visit(this.element, 0);
    if (text.endsWith("\n")) text = text.slice(0, -1);
    return {
      text,
      complete,
      rects: () => rendered.flatMap((range) => [...range.getClientRects()]),
      range: (from, to) => {
        if (!points[from] || !points[to] || from < 0 || to > text.length)
          return null;
        const range = document.createRange();
        range.setStart(points[from].node, points[from].offset);
        range.setEnd(points[to].node, points[to].offset);
        if (skipped.some((node) => range.intersectsNode(node))) return null;
        return range;
      },
    };
  }
  selection(snapshot: EditorSnapshot) {
    if (this.control)
      return {
        from: this.control.selectionStart ?? 0,
        to: this.control.selectionEnd ?? 0,
      };
    const selection =
      (this.element.getRootNode() as Document).getSelection?.() ??
      document.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (
      !this.element.contains(range.startContainer) ||
      !this.element.contains(range.endContainer)
    )
      return null;
    // Compare mapped positions without reading ancestor/page text.
    let from = -1,
      to = -1;
    const start = range.cloneRange();
    start.collapse(true);
    const end = range.cloneRange();
    end.collapse(false);
    for (let at = 0; at <= snapshot.text.length; at++) {
      const point = snapshot.range(at, at);
      if (point?.compareBoundaryPoints(Range.START_TO_START, start) === 0)
        from = at;
      if (point?.compareBoundaryPoints(Range.START_TO_START, end) === 0)
        to = at;
    }
    return from < 0 ? null : { from, to: to < 0 ? from : to };
  }
  replace(
    snapshot: EditorSnapshot,
    from: number,
    to: number,
    replacement: string,
  ) {
    if (!isWritingEditor(this.element)) return false;
    const current = this.read();
    if (current.text !== snapshot.text) return false;
    const expected =
      snapshot.text.slice(0, from) + replacement + snapshot.text.slice(to);
    if (
      this.control &&
      this.control.maxLength >= 0 &&
      expected.length > this.control.maxLength
    )
      return false;
    if (!this.control && !snapshot.complete) return false;
    this.element.focus({ preventScroll: true });
    if (this.control) this.control.setSelectionRange(from, to);
    else {
      const range = current.range(from, to);
      if (
        !range ||
        !this.element.contains(range.startContainer) ||
        !this.element.contains(range.endContainer)
      )
        return false;
      // A plain-text projection must never authorize deleting an excluded island.
      for (const node of this.element.querySelectorAll(excluded))
        if (range.intersectsNode(node)) return false;
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    document.execCommand("insertText", false, replacement);
    return this.read().text === expected;
  }
}
