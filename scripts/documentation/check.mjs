import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import process from "node:process";
import console from "node:console";

// Reuse the website's declared Markdown parser and heading-slug dependency.
// No network access, additional install or independent Markdown dialect.
const require = createRequire(
  new URL("../../packages/website/package.json", import.meta.url),
);
const { fromMarkdown } = await import(
  require.resolve("mdast-util-from-markdown")
);
const { gfm } = await import(require.resolve("micromark-extension-gfm"));
const { gfmFromMarkdown } = await import(require.resolve("mdast-util-gfm"));
const slugRequire = createRequire(require.resolve("rehype-slug"));
const { default: Slugger } = await import(
  slugRequire.resolve("github-slugger")
);

function visit(node, fn) {
  fn(node);
  for (const child of node.children ?? []) visit(child, fn);
}
function text(node) {
  if (["text", "inlineCode"].includes(node.type)) return node.value;
  return (node.children ?? []).map(text).join("");
}
function parse(source) {
  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const anchors = new Set();
  const links = [];
  const slugger = new Slugger();
  visit(tree, (node) => {
    if (node.type === "heading") anchors.add(slugger.slug(text(node)));
    if (["link", "image", "definition"].includes(node.type))
      links.push({ url: node.url, line: node.position.start.line });
    if (node.type === "html") {
      for (const match of node.value.matchAll(
        /\b(?:id|name)=["']([^"']+)["']/g,
      ))
        anchors.add(match[1]);
      for (const match of node.value.matchAll(
        /\b(?:href|src)=["']([^"']+)["']/g,
      ))
        links.push({ url: match[1], line: node.position.start.line });
    }
  });
  return { anchors, links };
}
async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files.sort();
}
function contained(root, path) {
  const value = relative(root, path);
  return value !== ".." && !value.startsWith(`..${sep}`);
}

export async function checkDocumentation(
  root = fileURLToPath(new URL("../../", import.meta.url)),
) {
  root = await realpath(root);
  const files = await markdownFiles(resolve(root, "documentation"));
  for (const name of ["README.md", "AGENTS.md"]) {
    const path = resolve(root, name);
    try {
      if ((await stat(path)).isFile()) files.push(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const cache = new Map();
  async function document(path) {
    if (!cache.has(path)) cache.set(path, parse(await readFile(path, "utf8")));
    return cache.get(path);
  }
  const errors = [];
  let links = 0;
  for (const file of files) {
    for (const link of (await document(file)).links) {
      // Root-relative URLs are application routes, not filesystem links.
      if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(link.url)) continue;
      links++;
      const error = (code) =>
        errors.push({
          file: relative(root, file),
          line: link.line,
          url: link.url,
          code,
        });
      let path, fragment;
      try {
        const url = new URL(link.url, "https://reference.invalid/");
        const rawPath = link.url.split(/[?#]/, 1)[0];
        path = rawPath
          ? resolve(dirname(file), decodeURIComponent(rawPath))
          : file;
        fragment = decodeURIComponent(url.hash.slice(1));
      } catch {
        error("invalid-url");
        continue;
      }
      if (!contained(root, path)) {
        error("outside-repository");
        continue;
      }
      try {
        if (!contained(root, await realpath(path))) {
          error("outside-repository");
          continue;
        }
        if (!(await stat(path)).isFile()) continue;
      } catch {
        error("missing-file");
        continue;
      }
      if (
        fragment &&
        extname(path) === ".md" &&
        !(await document(path)).anchors.has(fragment)
      )
        error("missing-anchor");
    }
  }
  return { files: files.length, links, errors };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await checkDocumentation();
  for (const e of result.errors)
    console.error(`${e.file}:${e.line}: ${e.code}: ${e.url}`);
  console.log(
    `Documentation: ${result.files} Markdown files, ${result.links} local links, ${result.errors.length} errors.`,
  );
  if (result.errors.length) process.exitCode = 1;
}
