import type { Root, RootContent, PhrasingContent, Nodes } from "mdast";
import type {
  Content,
  ContentText,
  ContentAnchor,
  ContentStack,
  CustomTableLayout,
  TDocumentDefinitions,
} from "pdfmake/interfaces";
import { codeFontFallback } from "./note-pdf-fonts";

// Intersection of glyph coverage in pdfmake 0.3.12's four bundled Roboto fonts.
// Unsupported characters are explicit, searchable codes rather than missing glyphs.
const coverage = [
  [32, 126],
  [160, 383],
  [399, 399],
  [402, 402],
  [416, 417],
  [431, 432],
  [496, 496],
  [506, 511],
  [536, 539],
  [567, 567],
  [601, 601],
  [700, 700],
  [710, 711],
  [713, 713],
  [728, 733],
  [755, 755],
  [768, 769],
  [771, 771],
  [777, 777],
  [783, 783],
  [803, 803],
  [900, 906],
  [908, 908],
  [910, 929],
  [931, 974],
  [977, 978],
  [982, 982],
  [1024, 1158],
  [1160, 1299],
  [7680, 7681],
  [7742, 7743],
  [7808, 7813],
  [7838, 7838],
  [7840, 7929],
  [8013, 8013],
  [8192, 8203],
  [8208, 8209],
  [8211, 8213],
  [8215, 8222],
  [8224, 8226],
  [8229, 8231],
  [8240, 8240],
  [8242, 8243],
  [8249, 8250],
  [8252, 8252],
  [8260, 8260],
  [8304, 8304],
  [8308, 8334],
  [8355, 8356],
  [8358, 8364],
  [8369, 8369],
  [8377, 8378],
  [8380, 8381],
  [8385, 8385],
  [8453, 8453],
  [8467, 8467],
  [8470, 8470],
  [8482, 8482],
  [8486, 8486],
  [8494, 8494],
  [8539, 8542],
  [8706, 8706],
  [8710, 8710],
  [8719, 8719],
  [8721, 8722],
  [8730, 8730],
  [8734, 8734],
  [8747, 8747],
  [8776, 8776],
  [8800, 8800],
  [8804, 8805],
  [9632, 9632],
  [9674, 9675],
  [9679, 9679],
  [60929, 60930],
  [63171, 63171],
  [64257, 64260],
  [65279, 65279],
  [65532, 65533],
];

const ink = "#262626";
const muted = "#666666";
const rule = "#dedede";
const inset = 54;
const pageWidth = { portrait: 595.28, landscape: 841.89 };

const tableLayout: CustomTableLayout = {
  hLineWidth: (row, node) =>
    row === node.table.headerRows ? 0.7 : row === 0 ? 0 : 0.35,
  hLineColor: (row, node) => (row === node.table.headerRows ? "#a3a3a3" : rule),
  vLineWidth: () => 0,
  paddingLeft: (column) => (column === 0 ? 0 : 8),
  paddingRight: (column, node) =>
    column === node.table.widths!.length - 1 ? 0 : 8,
  paddingTop: () => 7,
  paddingBottom: () => 7,
};

function plainText(node: Nodes): string {
  if (node.type === "html") return "";
  if ("value" in node) return node.value;
  if ("alt" in node) return node.alt ?? "";
  return "children" in node ? node.children.map(plainText).join("") : "";
}

export function notePdfDocument(root: Root, title: string, origin: string) {
  const definitions = new Map<string, string>();
  function collect(node: Nodes) {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
    if ("children" in node) node.children.forEach(collect);
  }
  collect(root);
  const first = root.children.find(
    (node) => !["definition", "html"].includes(node.type),
  );
  const titleNode =
    first?.type === "heading" && first.depth === 1 ? first : undefined;
  const outline: { depth: number; id: string }[] = [];
  let headingNumber = 0;
  let substituted = false;
  let usesCode = false;
  // Let the renderer measure and wrap words. Inserting zero-width spaces here
  // damages search/copy and breaks words well before the actual page edge.
  const text = (value: string) =>
    Array.from(value.replace(/\r\n?/g, "\n"))
      .map((char) => {
        const point = char.codePointAt(0)!;
        if (
          char === "\n" ||
          char === "\t" ||
          coverage.some(([start, end]) => point >= start && point <= end)
        )
          return char;
        substituted = true;
        return `[U+${point.toString(16).toUpperCase().padStart(4, "0")}]`;
      })
      .join("");

  function code(value: string): ContentText[] {
    usesCode = true;
    const runs: ContentText[] = [];
    for (const char of text(value.replace(/\t/g, "    "))) {
      const font = codeFontFallback(char.codePointAt(0)!)
        ? "Roboto"
        : "JetBrainsMono";
      const last = runs.at(-1);
      if (last?.font === font) last.text += char;
      else runs.push({ text: char, font });
    }
    return runs;
  }
  function link(value: string | undefined) {
    if (!value) return undefined;
    try {
      const url = new URL(value, origin);
      return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol)
        ? url.href
        : undefined;
    } catch {
      return undefined;
    }
  }
  function linked(
    parts: ContentText[],
    url: string | undefined,
  ): ContentText[] {
    const target = link(url);
    return parts.map((part) => ({
      ...part,
      link: target,
      ...(target ? { decoration: "underline" as const } : {}),
    }));
  }
  function inline(nodes: PhrasingContent[]): ContentText[] {
    return nodes.flatMap((node): ContentText[] => {
      switch (node.type) {
        case "text":
          // Markdown soft line endings flow as prose; explicit break nodes and
          // code retain their authored line endings.
          return [{ text: text(node.value.replace(/\r?\n/g, " ")) }];
        case "inlineCode":
          return code(node.value).map((part) => ({
            ...part,
            fontSize: 9.5,
            background: "#f3f3f3",
          }));
        case "break":
          return [{ text: "\n" }];
        case "strong":
          return inline(node.children).map((part) => ({ ...part, bold: true }));
        case "emphasis":
          return inline(node.children).map((part) => ({
            ...part,
            italics: true,
          }));
        case "delete":
          return inline(node.children).map((part) => ({
            ...part,
            decoration: "lineThrough",
          }));
        case "link":
          return linked(inline(node.children), node.url);
        case "linkReference":
          return linked(
            inline(node.children),
            definitions.get(node.identifier),
          );
        case "image":
        case "imageReference":
          return linked(
            [
              {
                text: text(`Image: ${node.alt || "Open image"}`),
                color: muted,
              },
            ],
            node.type === "image" ? node.url : definitions.get(node.identifier),
          );
        default:
          return [];
      }
    });
  }
  type Context = { width: number; compact?: boolean };
  function block(node: RootContent, context: Context): Content[] {
    const children = (nodes: RootContent[], next = context) =>
      nodes.flatMap((child) => block(child, next));
    switch (node.type) {
      case "heading": {
        const id = `heading-${++headingNumber}`;
        while (outline.length && outline.at(-1)!.depth >= node.depth)
          outline.pop();
        const parent = outline.at(-1)?.id;
        outline.push({ id, depth: node.depth });
        const heading: ContentText & Pick<ContentAnchor, "id"> = {
          text: inline(node.children),
          bold: true,
          fontSize:
            node === titleNode
              ? 25
              : [18, 14, 12, 11, 10.5, 10.5][node.depth - 1],
          lineHeight: 1.15,
          margin: [0, node === first ? 0 : 18, 0, node === titleNode ? 16 : 7],
          headlineLevel: node.depth,
          id,
          outline: true,
          outlineText: text(plainText(node)),
          outlineParentId: parent,
        };
        return [heading];
      }
      case "paragraph":
        return [
          {
            text: inline(node.children),
            margin: [0, 0, 0, context.compact ? 2 : 10],
          },
        ];
      case "blockquote":
        return [
          {
            table: {
              widths: [context.width - 13],
              body: [
                [
                  {
                    stack: children(node.children, {
                      width: context.width - 13,
                      compact: true,
                    }),
                    color: muted,
                  },
                ],
              ],
            },
            layout: {
              hLineWidth: () => 0,
              vLineWidth: (column) => (column === 0 ? 1 : 0),
              vLineColor: "#bdbdbd",
              paddingLeft: () => 12,
              paddingRight: () => 0,
              paddingTop: () => 2,
              paddingBottom: () => 2,
            },
            margin: [0, 3, 0, 12],
          },
        ];
      case "code":
        return [
          {
            table: {
              widths: [context.width - 24],
              body: [
                [
                  {
                    text: code(node.value),
                    fontSize: 9,
                    lineHeight: 1.35,
                    preserveLeadingSpaces: true,
                    preserveTrailingSpaces: true,
                  },
                ],
              ],
            },
            layout: {
              hLineWidth: () => 0,
              vLineWidth: () => 0,
              paddingLeft: () => 12,
              paddingRight: () => 12,
              paddingTop: () => 10,
              paddingBottom: () => 10,
              fillColor: "#f6f6f6",
            },
            margin: [0, 3, 0, 12],
          },
        ];
      case "thematicBreak":
        return [
          {
            canvas: [
              {
                type: "line",
                x1: 0,
                y1: 0,
                x2: context.width,
                y2: 0,
                lineWidth: 0.5,
                lineColor: rule,
              },
            ],
            margin: [0, 10, 0, 16],
          },
        ];
      case "list":
        return [
          {
            stack: node.children.map(
              (item, index): Content => ({
                columns: [
                  typeof item.checked === "boolean"
                    ? {
                        width: 19,
                        canvas: [
                          {
                            type: "rect",
                            x: 1,
                            y: 3,
                            w: 8,
                            h: 8,
                            lineWidth: 0.7,
                            lineColor: muted,
                          },
                          ...(item.checked
                            ? [
                                {
                                  type: "polyline" as const,
                                  points: [
                                    { x: 2.5, y: 6.8 },
                                    { x: 4.5, y: 9 },
                                    { x: 7.5, y: 4.8 },
                                  ],
                                  lineWidth: 0.9,
                                  lineColor: ink,
                                },
                              ]
                            : []),
                        ],
                      }
                    : {
                        text: node.ordered
                          ? `${(node.start ?? 1) + index}.`
                          : "•",
                        width: 19,
                        fontSize: 10,
                        color: muted,
                      },
                  {
                    stack: children(item.children, {
                      width: context.width - 19,
                      compact: !node.spread,
                    }),
                    width: context.width - 19,
                  },
                ],
                margin: [0, 0, 0, 3],
              }),
            ),
            margin: [0, 1, 0, context.compact ? 2 : 8],
          },
        ];
      case "table": {
        const headings = node.children[0]?.children ?? [];
        if (!headings.length) return [];
        // Extremely wide records remain readable as two-column label/value pairs.
        if (headings.length > 8)
          return node.children.slice(1).flatMap((row, index): Content[] => [
            {
              text: `Row ${index + 1}`,
              bold: true,
              fontSize: 10,
              margin: [0, 10, 0, 4],
              headlineLevel: 7,
            },
            {
              table: {
                widths: [128, context.width - 144],
                body: headings.map((heading, column) => [
                  { text: inline(heading.children), bold: true },
                  { text: inline(row.children[column]?.children ?? []) },
                ]),
              },
              layout: tableLayout,
              fontSize: 9.5,
              lineHeight: 1.25,
              margin: [0, 0, 0, 10],
            },
          ]);
        const weights = headings.map((_, column) =>
          Math.min(
            36,
            Math.max(
              10,
              ...node.children.map(
                (row) =>
                  plainText(
                    row.children[column] ?? { type: "tableCell", children: [] },
                  ).length,
              ),
            ),
          ),
        );
        const sum = weights.reduce((total, weight) => total + weight, 0);
        const available = context.width - (headings.length - 1) * 16;
        const widths = weights.map((weight) => (available * weight) / sum);
        // Keep ordinary records intact. A conservative upper bound leaves room
        // for the repeated header; exceptionally tall cells must be splittable.
        const keepRows = node.children.every((row) =>
          headings.every((_, column) => {
            const value = text(
              plainText(
                row.children[column] ?? { type: "tableCell", children: [] },
              ),
            );
            const lines = value
              .split(/\r?\n/)
              .reduce(
                (total, line) =>
                  total +
                  Math.max(1, Math.ceil((line.length * 12) / widths[column])),
                0,
              );
            return lines * 16 + 14 < 240;
          }),
        );
        return [
          {
            table: {
              headerRows: 1,
              dontBreakRows: keepRows,
              keepWithHeaderRows: keepRows && node.children.length > 1 ? 1 : 0,
              // Fixed, content-weighted widths let the renderer hard-wrap a long
              // token instead of allowing its minimum width to overflow the page.
              widths,
              body: node.children.map((row, rowIndex) =>
                headings.map((_, column) => ({
                  text: inline(row.children[column]?.children ?? []),
                  bold: rowIndex === 0,
                  fontSize: rowIndex === 0 ? 9 : 9.5,
                  alignment: node.align?.[column] ?? "left",
                })),
              ),
            },
            layout: tableLayout,
            lineHeight: 1.25,
            margin: [0, 2, 0, 12],
          },
        ];
      }
      default:
        return [];
    }
  }
  const content: Content[] = [];
  let orientation: "portrait" | "landscape" = "portrait";
  let initialOrientation: "portrait" | "landscape" = orientation;
  const orientations: ("portrait" | "landscape")[] = [];
  let nextOrientation: "portrait" | "landscape" = "portrait";
  for (let index = root.children.length - 1; index >= 0; index--) {
    const node = root.children[index];
    // Keep a table's introductory heading on the same sheet as the table,
    // including runs of headings and invisible reference definitions.
    if (!["heading", "definition", "html"].includes(node.type)) {
      const columns =
        node.type === "table" ? (node.children[0]?.children.length ?? 0) : 0;
      nextOrientation = columns > 5 && columns <= 8 ? "landscape" : "portrait";
    }
    orientations[index] = nextOrientation;
  }
  for (const [index, node] of root.children.entries()) {
    const next = orientations[index];
    const stack = block(node, { width: pageWidth[next] - inset * 2 });
    if (!stack.length) continue;
    const section: ContentStack = { stack };
    if (!content.length) initialOrientation = next;
    else if (next !== orientation) {
      section.pageBreak = "before";
      section.pageOrientation = next;
    }
    orientation = next;
    content.push(section);
  }
  const document: TDocumentDefinitions = {
    info: { title: titleNode ? plainText(titleNode) : title, creator: "Grove" },
    pageSize: "A4",
    pageMargins: [inset, 50, inset, 50],
    pageOrientation: initialOrientation,
    content: content.length
      ? content
      : [{ text: "This note contains no printable Markdown content." }],
    defaultStyle: {
      font: "Roboto",
      fontSize: 10.5,
      lineHeight: 1.35,
      color: ink,
    },
    footer: (page, pages) =>
      pages === 1
        ? { text: "" }
        : {
            text: `${page} / ${pages}`,
            alignment: "right",
            margin: [inset, 17, inset, 0],
            fontSize: 8,
            color: muted,
          },
    pageBreakBefore: (node, queries) =>
      !!node.headlineLevel &&
      node.pageNumbers.length === 1 &&
      queries
        .getPreviousNodesOnPage()
        .some(
          (previous) => previous.text || previous.table || previous.canvas,
        ) &&
      !queries
        .getFollowingNodesOnPage()
        .some(
          (next) =>
            !next.headlineLevel && (next.text || next.table || next.canvas),
        ) &&
      queries.getNodesOnNextPage().length > 0,
  };
  return { document, substituted, usesCode };
}
