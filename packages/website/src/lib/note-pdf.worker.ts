import pdfMake from "pdfmake/build/pdfmake";
import fonts from "pdfmake/build/vfs_fonts";
import { notePdfDocument } from "./note-pdf-document";
import type { Root } from "mdast";

pdfMake.addVirtualFileSystem(fonts);
self.onmessage = async (
  event: MessageEvent<{ root: Root; title: string; origin: string }>,
) => {
  try {
    const { document, substituted, usesCode } = notePdfDocument(
      event.data.root,
      event.data.title,
      event.data.origin,
    );
    if (usesCode) {
      // The TTF is same-origin and loaded only for PDFs containing code. WOFF2
      // web subsets cannot reliably be subset again by the PDF font renderer.
      const font = `${self.location.origin}/brand-kit/fonts/jetbrains-mono-regular.ttf`;
      pdfMake.addFonts({
        JetBrainsMono: {
          normal: font,
          bold: font,
          italics: font,
          bolditalics: font,
        },
      });
    }
    const blob = await pdfMake.createPdf(document).getBlob();
    self.postMessage({ blob, substituted });
  } catch {
    // Never forward document text or renderer exception payloads into diagnostics.
    self.postMessage({ error: "PDF generation failed" });
  }
};
