import type { Root, RootContent, PhrasingContent } from "mdast";
import type {
  Content,
  ContentText,
  TDocumentDefinitions,
} from "pdfmake/interfaces";

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

export function notePdfDocument(root: Root, title: string, origin: string) {
  const definitions = new Map(
    root.children
      .filter((node) => node.type === "definition")
      .map((node) => [node.identifier, node.url]),
  );
  let substituted = false;
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
      .join("")
      .replace(/\S{18}/gu, "$&\u200b");
  const link = (value: string | undefined) => {
    if (!value) return undefined;
    try {
      const url = new URL(value, origin);
      return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol)
        ? url.href
        : undefined;
    } catch {
      return undefined;
    }
  };
  function inline(nodes: PhrasingContent[]): ContentText[] {
    return nodes.flatMap((node): ContentText[] => {
      switch (node.type) {
        case "text":
          return [{ text: text(node.value) }];
        case "inlineCode":
          return [{ text: text(node.value), background: "#f1f3ef" }];
        case "break":
          return [{ text: "\n" }];
        case "strong":
          return inline(node.children).map((item) => ({ ...item, bold: true }));
        case "emphasis":
          return inline(node.children).map((item) => ({
            ...item,
            italics: true,
          }));
        case "delete":
          return inline(node.children).map((item) => ({
            ...item,
            decoration: "lineThrough",
          }));
        case "link":
          return inline(node.children).map((item) => ({
            ...item,
            link: link(node.url),
            color: "#315e44",
            decoration: "underline",
          }));
        case "linkReference":
          return inline(node.children).map((item) => ({
            ...item,
            link: link(definitions.get(node.identifier)),
          }));
        case "image":
          return [
            {
              text: text(`Image: ${node.alt || "Open image"}`),
              link: link(node.url),
              decoration: "underline",
            },
          ];
        case "imageReference":
          return [
            {
              text: text(`Image: ${node.alt || "Open image"}`),
              link: link(definitions.get(node.identifier)),
            },
          ];
        default:
          return [];
      }
    });
  }
  function block(node: RootContent): Content[] {
    switch (node.type) {
      case "heading":
        return [
          {
            text: inline(node.children),
            bold: true,
            fontSize: [24, 20, 16, 14, 12, 11][node.depth - 1],
            margin: [0, 12, 0, 8],
            headlineLevel: node.depth,
          },
        ];
      case "paragraph":
        return [{ text: inline(node.children), margin: [0, 0, 0, 9] }];
      case "blockquote":
        return [
          {
            stack: node.children.flatMap(block),
            margin: [14, 4, 0, 8],
            color: "#556059",
            italics: true,
          },
        ];
      case "code":
        return [
          {
            text: text(node.value.replace(/\t/g, "    ")),
            fontSize: 9,
            background: "#f1f3ef",
            margin: [8, 6, 8, 12],
            preserveLeadingSpaces: true,
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
                x2: 200,
                y2: 0,
                lineColor: "#a2afa6",
              },
            ],
            margin: [0, 4, 0, 8],
          },
        ];
      case "list":
        return node.children.flatMap((item, index) => [
          {
            columns: [
              {
                text:
                  item.checked !== null && item.checked !== undefined
                    ? item.checked
                      ? "[x]"
                      : "[ ]"
                    : node.ordered
                      ? `${(node.start ?? 1) + index}.`
                      : "•",
                width: 26,
              },
              { stack: item.children.flatMap(block), width: "*" },
            ],
            margin: [8, 0, 0, 3],
          } satisfies Content,
        ]);
      case "table":
        return [
          {
            table: {
              headerRows: 1,
              widths: node.children[0].children.map(() => "*"),
              body: node.children.map((row, rowIndex) =>
                row.children.map((cell, index) => ({
                  text: inline(cell.children),
                  bold: rowIndex === 0,
                  fillColor: rowIndex === 0 ? "#edf2eb" : undefined,
                  alignment: node.align?.[index] ?? "left",
                  margin: [2, 4, 2, 4],
                })),
              ),
            },
            layout: "lightHorizontalLines",
            fontSize: 9,
            margin: [0, 4, 0, 12],
          },
        ];
      default:
        return [];
    }
  }
  const content = root.children.flatMap(block);
  const document: TDocumentDefinitions = {
    info: { title: text(title), creator: "Grove" },
    pageSize: "A4",
    pageMargins: [40, 36, 40, 42],
    pageOrientation: root.children.some(
      (node) => node.type === "table" && node.children[0].children.length > 5,
    )
      ? "landscape"
      : "portrait",
    content: content.length
      ? content
      : [{ text: "This note contains no printable Markdown content." }],
    defaultStyle: {
      font: "Roboto",
      fontSize: 11,
      lineHeight: 1.3,
      color: "#26352c",
    },
    footer: (page, pages) => ({
      text: `${page} / ${pages}`,
      alignment: "right",
      margin: [40, 12, 40, 0],
      fontSize: 9,
      color: "#69756d",
    }),
    pageBreakBefore: (node, queries) =>
      !!node.headlineLevel && queries.getFollowingNodesOnPage().length === 0,
  };
  return { document, substituted };
}
