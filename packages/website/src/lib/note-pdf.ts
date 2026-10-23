import { noteExportTitle } from "./note-export";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { mediaReferenceId } from "@lib/shared/media";

export async function createNotePdf(
  content: string,
  signal: AbortSignal,
  note?: { id: string; version: number },
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
  const images: Record<string, string> = {};
  const ids = [
    ...new Set(
      [...content.matchAll(/grove-media:([0-9a-f-]{36})/g)]
        .map((match) => mediaReferenceId(match[0]))
        .filter((id): id is string => !!id),
    ),
  ];
  if (ids.length && !note)
    throw new Error("Save the note before exporting its images");
  let total = 0;
  for (const id of ids) {
    const response = await fetch(
      `/api/grove/memories/${note!.id}/media/${id}?version=${note!.version}`,
      { cache: "no-store", signal },
    );
    if (!response.ok) throw new Error("Image unavailable");
    const blob = await response.blob();
    total += blob.size;
    if (total > 30 * 1024 * 1024)
      throw new Error("Images exceed the PDF budget; use the portable archive");
    signal.throwIfAborted();
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      images[`grove-media:${id}`] = canvas.toDataURL("image/png");
    } finally {
      bitmap.close();
    }
  }
  signal.throwIfAborted();
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
      images,
    });
  });
}
