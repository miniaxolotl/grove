import { noteExportTitle } from "./note-export";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export function createNotePdf(
  content: string,
  signal: AbortSignal,
): Promise<{ blob: Blob; substituted: boolean }> {
  signal.throwIfAborted();
  if (content.length > 100_000)
    return Promise.reject(new Error("Document too large"));
  // The parser's browser entity decoder needs the DOM. Only the small AST parse
  // runs here; font loading, layout and PDF serialization run in the worker.
  const root = fromMarkdown(content, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./note-pdf.worker.ts", import.meta.url));
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
      clearTimeout(timeout);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Export cancelled", "AbortError"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("PDF generation timed out"));
    }, 30_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (
      event: MessageEvent<{
        blob?: Blob;
        substituted: boolean;
        error?: string;
      }>,
    ) => {
      cleanup();
      if (event.data.blob)
        resolve({ blob: event.data.blob, substituted: event.data.substituted });
      else reject(new Error("PDF generation failed"));
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("PDF worker unavailable"));
    };
    worker.postMessage({
      root,
      title: noteExportTitle(content),
      origin: location.origin,
    });
  });
}
