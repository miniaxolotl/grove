import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import type { Nodes, Definition } from "mdast";
import {
  followsGroveTitle,
  parseGroveLink,
  type GroveLink,
} from "./internal-links.ts";

export type ParsedGroveLink = {
  resource: GroveLink;
  label: string;
  title?: string | null;
  followTitle: boolean;
  from: number;
  to: number;
};

/** Editor-only source parsing: keep it outside the lightweight navigation contract. */
export function findGroveLinks(
  source: string,
  origin?: string,
): ParsedGroveLink[] {
  const root = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const definitions = new Map<string, Definition>();
  function walk(node: Nodes, visit: (node: Nodes) => void) {
    visit(node);
    if ("children" in node)
      for (const child of node.children) walk(child, visit);
  }
  function text(node: Nodes): string {
    if ("value" in node) return node.value;
    return "children" in node ? node.children.map(text).join("") : "";
  }
  walk(root, (node) => {
    if (node.type === "definition") definitions.set(node.identifier, node);
  });
  const links: ParsedGroveLink[] = [];
  walk(root, (node) => {
    if (node.type !== "link" && node.type !== "linkReference") return;
    const target =
      node.type === "link" ? node : definitions.get(node.identifier);
    if (!target) return;
    const resource = parseGroveLink(target.url, origin);
    const from = node.position?.start.offset,
      to = node.position?.end.offset;
    if (!resource || from === undefined || to === undefined) return;
    const label = text(node);
    const syntax = source.slice(from, to);
    const autolink =
      node.type === "link" &&
      (syntax === target.url || syntax === `<${target.url}>`);
    links.push({
      resource,
      label,
      title: target.title,
      followTitle: followsGroveTitle(label, target.url, target.title, autolink),
      from,
      to,
    });
  });
  return links;
}
