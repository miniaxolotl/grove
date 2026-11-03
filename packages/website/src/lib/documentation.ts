import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { documentation } from "@/content/documentation";

export async function loadDocumentation(slug: string) {
  const document = documentation.find((item) => item.slug === slug);
  if (!document) return null;
  // The workspace build runs in packages/website. Only allowlisted committed files
  // are read during static generation, never a filename supplied by a request.
  const markdown = await readFile(
    resolve(process.cwd(), "../../documentation", document.source),
    "utf8",
  );
  return { ...document, markdown: markdown.replace(/^# [^\r\n]+\r?\n/, "") };
}
