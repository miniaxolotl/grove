import { GroveError } from "@lib/shared/contracts";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

export type DocumentPage = { page: number; text: string };
export type DocumentSegment = {
  content: string;
  start: number;
  end: number;
  pageStart: number;
  pageEnd: number;
};

export function decodeDocumentText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GroveError("document_encoding", "Choose a UTF-8 text file", 422);
  }
  // eslint-disable-next-line no-control-regex -- binary controls must not enter authored text
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))
    throw new GroveError("document_binary", "This file is not plain text", 422);
  text = text.replace(/\r\n?/g, "\n");
  if (!text.trim())
    throw new GroveError(
      "document_empty",
      "This file has no readable text",
      422,
    );
  return text;
}

/** Deterministic, lossless UTF-16 ranges; never cut a surrogate pair. */
export function segmentDocument(pages: DocumentPage[]): DocumentSegment[] {
  if (!pages.length || pages.length > 100)
    throw new GroveError(
      "document_pages",
      "PDFs must have at most 100 pages",
      422,
    );
  const text = pages.map((p) => p.text).join("\n\n");
  if (Buffer.byteLength(text) > 1024 * 1024)
    throw new GroveError(
      "document_text_limit",
      "Extracted text exceeds 1 MiB",
      422,
    );
  if (!text.trim())
    throw new GroveError(
      "document_empty",
      "No readable text; scanned PDFs need OCR",
      422,
    );
  let offset = 0;
  const ranges = pages.map((p) => {
    const range = { page: p.page, start: offset, end: offset + p.text.length };
    offset = range.end + 2;
    return range;
  });
  const parts: DocumentSegment[] = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(text.length, start + 6000);
    if (end < text.length) {
      const candidate = text.lastIndexOf("\n\n", end - 2);
      if (candidate >= start + 3000) end = candidate + 2;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    const touched = ranges.filter((p) => p.start < end && p.end >= start);
    parts.push({
      content: text.slice(start, end),
      start,
      end,
      pageStart: touched[0]?.page ?? pages[0].page,
      pageEnd: touched.at(-1)?.page ?? pages.at(-1)!.page,
    });
    start = end;
  }
  return parts;
}

// Input is data, never a path/URL. No rendering, scripting, actions or attachments.
// Node's permission boundary denies application/source files, writes, subprocesses
// and native addons. A hard process deadline and output cap bound decompression.
const parser = `
  console.log = console.warn = console.error = () => {};
  const { getDocument } = await import(process.argv[1]);
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 3145728) process.exit(2);
    chunks.push(chunk);
  }
  try {
    const task = getDocument({ data: new Uint8Array(Buffer.concat(chunks)),
      isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
      useWorkerFetch: false, disableAutoFetch: true, stopAtErrors: true,
      isOffscreenCanvasSupported: false, maxImageSize: 0, verbosity: 0 });
    const pdf = await task.promise;
    if (await pdf.getPermissions() !== null) process.exit(5);
    if (pdf.numPages > 100) process.exit(3);
    const pages = []; let length = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      const source = await pdf.getPage(page);
      const content = await source.getTextContent();
      const text = content.items.map(i => "str" in i ? i.str + (i.hasEOL ? "\\n" : " ") : "").join("").trim();
      length += Buffer.byteLength(text);
      if (length > 1048576) process.exit(4);
      pages.push({ page, text }); source.cleanup();
    }
    await task.destroy();
    process.stdout.write(JSON.stringify(pages));
  } catch (error) {
    process.exit(error?.name === "PasswordException" ? 5 : 6);
  }
`;

const docxParser = `
  const {unzipSync,strFromU8}=await import(process.argv[1]);
  const {SaxesParser}=await import(process.argv[2]);
  const chunks=[];let input=0;
  for await(const chunk of process.stdin){input+=chunk.length;if(input>3145728)process.exit(2);chunks.push(chunk);}
  try{
    let entries=0,expanded=0;const names=new Set();
    const files=unzipSync(new Uint8Array(Buffer.concat(chunks)),{filter(file){
      if(++entries>256 || names.has(file.name) || file.name.includes('..') || file.name.includes('\\\\') || file.name.startsWith('/') || /vba|encrypted|\\.bin$/i.test(file.name))throw Error('invalid_package');
      names.add(file.name);expanded+=file.originalSize;
      if(file.originalSize>8388608 || expanded>16777216)throw Error('expanded_limit');
      return file.name==='word/document.xml' || file.name==='[Content_Types].xml';
    }});
    if(!files['word/document.xml'] || !files['[Content_Types].xml'])throw Error('invalid_docx');
    const types=strFromU8(files['[Content_Types].xml']);
    if(!types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') || /macroEnabled|vbaProject/i.test(types))throw Error('invalid_docx');
    let text='',depth=0,inText=false;
    const parser=new SaxesParser({xmlns:true});
    const add=value=>{text+=value;if(Buffer.byteLength(text)>1048576)throw Error('text_limit');};
    parser.on('doctype',()=>{throw Error('doctype_disabled');});
    parser.on('opentag',tag=>{
      if(++depth>128)throw Error('depth_limit');
      if(tag.uri==='http://schemas.openxmlformats.org/wordprocessingml/2006/main'){
        if(tag.local==='t')inText=true;
        if(tag.local==='tab')add('\\t');
        if(tag.local==='br')add('\\n');
      }
    });
    parser.on('text',value=>{if(inText)add(value);});
    parser.on('closetag',tag=>{depth--;if(tag.uri==='http://schemas.openxmlformats.org/wordprocessingml/2006/main'){
      if(tag.local==='t')inText=false;
      if(tag.local==='p')add('\\n\\n');
    }});
    parser.write(new TextDecoder('utf-8',{fatal:true}).decode(files['word/document.xml'])).close();
    process.stdout.write(JSON.stringify([{page:1,text:text.trim()}]));
  }catch{process.exit(6);}
`;

async function pdfPages(
  bytes: Buffer,
  signal: AbortSignal,
  kind: "pdf" | "docx" = "pdf",
): Promise<DocumentPage[]> {
  signal.throwIfAborted();
  const module = await realpath(
    fileURLToPath(
      import.meta.resolve(
        kind === "pdf" ? "pdfjs-dist/legacy/build/pdf.mjs" : "fflate/browser",
      ),
    ),
  );
  const modules = [module],
    roots = [resolve(dirname(module), kind === "pdf" ? "../.." : "..")];
  if (kind === "docx") {
    const saxes = await realpath(fileURLToPath(import.meta.resolve("saxes")));
    const xmlchars = await realpath(
      createRequire(saxes).resolve("xmlchars/xml/1.0/ed5"),
    );
    modules.push(saxes);
    roots.push(
      dirname(saxes),
      resolve(dirname(saxes), "../xmlchars"),
      resolve(dirname(xmlchars), "../.."),
    );
  }
  const controller = new AbortController();
  const deadline = AbortSignal.any([
    signal,
    controller.signal,
    AbortSignal.timeout(15000),
  ]);
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=128",
        "--permission",
        ...roots.map((root) => `--allow-fs-read=${root}`),
        "--input-type=module",
        "--eval",
        kind === "pdf" ? parser : docxParser,
        ...modules.map((path) => pathToFileURL(path).href),
      ],
      { stdio: ["pipe", "pipe", "ignore"], env: {} },
    );
    const output: Buffer[] = [];
    let size = 0;
    const stop = () => child.kill("SIGKILL");
    deadline.addEventListener("abort", stop, { once: true });
    if (deadline.aborted) stop();
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) controller.abort();
      else output.push(chunk);
    });
    child.once("error", fail);
    child.once("close", (code) => {
      deadline.removeEventListener("abort", stop);
      if (signal.aborted) return fail(signal.reason);
      if (deadline.aborted || code !== 0)
        return fail(
          new GroveError(
            kind === "pdf" ? "document_pdf" : "document_docx",
            code === 5
              ? "Password-protected PDFs are not supported"
              : "Document could not be read within the format, text or processing limits",
            422,
          ),
        );
      try {
        done(JSON.parse(Buffer.concat(output).toString("utf8")));
      } catch {
        fail(new GroveError("document_pdf", "PDF could not be read", 422));
      }
    });
    child.stdin.end(bytes);
  });
}

export async function extractDocument(
  bytes: Buffer,
  filename: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!bytes.length || bytes.length > 3 * 1024 * 1024)
    throw new GroveError(
      "document_size",
      "Choose a file no larger than 3 MiB",
      413,
    );
  const isPdf = /\.pdf$/i.test(filename);
  const isDocx = /\.docx$/i.test(filename);
  const signature = bytes.subarray(0, 5).toString() === "%PDF-";
  if (
    (!isPdf && !isDocx && !/\.(md|markdown|txt)$/i.test(filename)) ||
    isPdf !== signature ||
    (isDocx && !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])))
  )
    throw new GroveError(
      "document_type",
      "Choose Markdown, plain text, DOCX or a valid PDF",
      422,
    );
  const pages = isPdf
    ? await pdfPages(bytes, signal)
    : isDocx
      ? await pdfPages(bytes, signal, "docx")
      : [{ page: 1, text: decodeDocumentText(bytes) }];
  const segments = segmentDocument(pages);
  return {
    mime: isPdf
      ? ("application/pdf" as const)
      : isDocx
        ? ("application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const)
        : ("text/plain" as const),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    pages,
    segments,
    emptyPages: pages.filter((p) => !p.text.trim()).map((p) => p.page),
  };
}
