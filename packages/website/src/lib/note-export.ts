/** Portable names use authored content, never stale enrichment or internal IDs. */
export function noteExportTitle(content: string) {
  const first = content.trim().split(/\r?\n/)[0] ?? "";
  return (
    first
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/\s+#+\s*$/, "")
      .trim() || "Untitled note"
  );
}

export function noteExportFilename(content: string, extension: "md" | "pdf") {
  let name = noteExportTitle(content)
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .replace(/(?:\.(?:md|pdf))+$/i, "");
  name = Array.from(name)
    .slice(0, 80)
    .join("")
    .replace(/[. ]+$/g, "");
  if (!name || /^[-. ]+$/.test(name) || name === "Untitled note")
    name = "untitled-note";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    name = `note-${name}`;
  return `${name}.${extension}`;
}

/** Keep the URL alive long enough for WebKit to consume an initiated download. */
export function downloadNote(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
