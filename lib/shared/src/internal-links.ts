/** Opt-in only: ordinary authored labels and historical source remain literal. */
export const groveTitleMarker = "grove:title:v1";
export type GroveLink = {
  kind: "note" | "notebook";
  id: string;
  href: string;
  revision?: number;
};
const cloudOrigins = new Set([
  "https://grovenote.app",
  "https://usegrove.cloud",
]);

export type LinkPreviewRequest = {
  kind: "note" | "notebook";
  id: string;
  revision?: number;
};
export type GroveLinkPreview = {
  kind: "note" | "notebook";
  id: string;
  title: string;
  excerpt: string | null;
  version: number;
  expiresAt: string | null;
};

/** Resource recognition is not authority to resolve another installation's ID. */
export function isLocalGroveLink(href: string, origin: string) {
  if (!parseGroveLink(href, origin)) return false;
  try {
    const current = new URL(origin).origin;
    const target = new URL(href, current).origin;
    return (
      current === target ||
      (cloudOrigins.has(current) && cloudOrigins.has(target))
    );
  } catch {
    return false;
  }
}

/** Recognize navigation destinations, never arbitrary URL-fetch instructions. */
export function parseGroveLink(
  href: string,
  origin?: string,
): GroveLink | null {
  if (
    !href ||
    href.length > 4096 ||
    href.includes("\\") ||
    Array.from(href).some((character) => character.charCodeAt(0) <= 32)
  )
    return null;
  if (!href.startsWith("/app/") && !/^https?:\/\//i.test(href)) return null;
  try {
    const base = origin ? new URL(origin).origin : "https://grovenote.app";
    const url = new URL(href, base);
    if (
      url.username ||
      url.password ||
      (!cloudOrigins.has(url.origin) && url.origin !== base)
    )
      return null;
    if (!/^https?:$/.test(url.protocol)) return null;
    const match =
      /^\/app\/(memories|projects)\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(
        url.pathname,
      );
    if (!match) return null;
    const revisions = url.searchParams.getAll("revision");
    let revision: number | undefined;
    if (match[1].toLowerCase() === "memories" && revisions.length) {
      if (revisions.length !== 1 || !/^[1-9]\d*$/.test(revisions[0]))
        return null;
      revision = Number(revisions[0]);
      if (!Number.isSafeInteger(revision) || revision > 2147483647) return null;
    }
    return {
      kind: match[1].toLowerCase() === "memories" ? "note" : "notebook",
      id: match[2].toLowerCase(),
      href,
      ...(revision !== undefined ? { revision } : {}),
    };
  } catch {
    return null;
  }
}

export function followsGroveTitle(
  label: string,
  href: string,
  title?: string | null,
  autolink = false,
) {
  return title === groveTitleMarker || (autolink && !title && label === href);
}

export function createGroveLink(
  href: string,
  label: string,
  followTitle: boolean,
  origin?: string,
) {
  if (!parseGroveLink(href, origin))
    throw new Error("Choose a supported Grove note or notebook link");
  if (!label.trim() || label.length > 500 || /[\r\n]/.test(label))
    throw new Error(
      "Choose a single-line Grove link label of up to 500 characters",
    );
  const text = label.replace(/[\\`*_[\]<>]/g, "\\$&");
  const target = href.replace(/[<>"]/g, (character) =>
    encodeURIComponent(character),
  );
  return `[${text}](<${target}>${followTitle ? ` "${groveTitleMarker}"` : ""})`;
}
