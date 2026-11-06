import { parseNoteMarkdown, type MarkdownNode } from "@lib/shared/markdown";

export function noteSummary(source: string) {
  const text = (node: MarkdownNode): string => {
    if (node.type === "definition" || node.type === "html") return "";
    if ("value" in node) return node.value;
    if ("alt" in node) return node.alt ?? "";
    return "children" in node ? node.children.map(text).join(" ") : "";
  };
  const blocks = parseNoteMarkdown(source)
    .children.map((node) => text(node).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const first = blocks.shift() ?? "Untitled note";
  return {
    title: first.slice(0, 90),
    excerpt: [first.slice(90), ...blocks].filter(Boolean).join(" "),
  };
}

/** DOM allowlist: note HTML is text; images/media never make remote requests. */
export function renderNote(
  source: string,
  siteOrigin: string,
  dom: Document = document,
) {
  const root = parseNoteMarkdown(source);
  const definitions = new Map(
    root.children
      .filter((node) => node.type === "definition")
      .map((node) => [node.identifier.toUpperCase(), node]),
  );
  function render(node: MarkdownNode): Node {
    const fragment = () => {
      const result = dom.createDocumentFragment();
      if ("children" in node)
        for (const child of node.children) result.append(render(child));
      return result;
    };
    const element = (name: string) => {
      const el = dom.createElement(name);
      el.append(fragment());
      return el;
    };
    switch (node.type) {
      case "root":
        return fragment();
      case "text":
      case "html":
        return dom.createTextNode(node.value);
      case "paragraph":
        return element("p");
      case "heading":
        return element(`h${Math.min(node.depth + 1, 6)}`);
      case "emphasis":
        return element("em");
      case "strong":
        return element("strong");
      case "delete":
        return element("del");
      case "blockquote":
        return element("blockquote");
      case "break":
        return dom.createElement("br");
      case "thematicBreak":
        return dom.createElement("hr");
      case "inlineCode":
      case "code": {
        const code = dom.createElement("code");
        code.textContent = node.value;
        if (node.type === "inlineCode") return code;
        const pre = dom.createElement("pre");
        pre.append(code);
        return pre;
      }
      case "list": {
        const list = element(node.ordered ? "ol" : "ul");
        if (node.ordered && node.start != null)
          list.setAttribute("start", String(node.start));
        return list;
      }
      case "listItem": {
        const item = element("li");
        if (node.checked != null) {
          const mark = dom.createElement("input");
          mark.type = "checkbox";
          mark.disabled = true;
          mark.checked = node.checked;
          mark.setAttribute(
            "aria-label",
            node.checked ? "Completed task" : "Incomplete task",
          );
          item.className = "reader-task";
          item.prepend(mark);
        }
        return item;
      }
      case "link":
      case "linkReference": {
        const target =
          node.type === "link"
            ? node.url
            : definitions.get(node.identifier.toUpperCase())?.url;
        try {
          if (!target) return fragment();
          const url = new URL(target, siteOrigin);
          if (
            !["https:", "http:"].includes(url.protocol) ||
            url.username ||
            url.password
          )
            return fragment();
          const link = element("a") as HTMLAnchorElement;
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noreferrer noopener";
          return link;
        } catch {
          return fragment();
        }
      }
      case "image":
      case "imageReference":
        return dom.createTextNode(
          node.alt ? `[Image: ${node.alt}]` : "[Image — open in Grove]",
        );
      case "table": {
        const table = dom.createElement("table");
        const head = dom.createElement("thead"),
          body = dom.createElement("tbody");
        node.children.forEach((row, index) => {
          const tr = dom.createElement("tr");
          row.children.forEach((cell, column) => {
            const el = dom.createElement(index === 0 ? "th" : "td");
            if (index === 0) el.setAttribute("scope", "col");
            if (node.align?.[column]) el.dataset.align = node.align[column]!;
            for (const child of cell.children) el.append(render(child));
            tr.append(el);
          });
          (index === 0 ? head : body).append(tr);
        });
        table.append(head, body);
        const wrapper = dom.createElement("div");
        wrapper.className = "reader-table";
        wrapper.tabIndex = 0;
        wrapper.setAttribute("role", "region");
        wrapper.setAttribute("aria-label", "Note table");
        wrapper.append(table);
        return wrapper;
      }
      case "definition":
        return dom.createDocumentFragment();
      default:
        return fragment();
    }
  }
  return render(root);
}
