import pdfMake from "pdfmake/build/pdfmake";
import fonts from "pdfmake/build/vfs_fonts";
import { notePdfDocument } from "./note-pdf-document";
import type { Root } from "mdast";

pdfMake.addVirtualFileSystem(fonts);
self.onmessage = async (
  event: MessageEvent<{ root: Root; title: string; origin: string }>,
) => {
  try {
    const { document, substituted } = notePdfDocument(
      event.data.root,
      event.data.title,
      event.data.origin,
    );
    const blob = await pdfMake.createPdf(document).getBlob();
    self.postMessage({ blob, substituted });
  } catch {
    // Never forward document text or renderer exception payloads into diagnostics.
    self.postMessage({ error: "PDF generation failed" });
  }
};
