import type { Nodes } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';

/** Coordinates always refer to the raw source, including whitespace in code.
 * Never infer protected spans by comparing space-padded strings. */
export function projectWritingText(source: string) {
  const ranges: {from:number;to:number}[] = [];
  const mark = (from:number,to:number) => { if (to>from) ranges.push({from,to}); };
  for(const match of source.matchAll(/^(?: {4}|\t)[^\r\n]*/gm)) mark(match.index,match.index+match[0].length);
  if (/[`~[<]/.test(source)) {
    const bom = Number(source.startsWith('\uFEFF'));
    const pending: Nodes[] = [fromMarkdown(source)];
    while (pending.length) {
      const node = pending.pop()!;
      const from=node.position!.start.offset!+bom,to=node.position!.end.offset!+bom;
      if (['code','inlineCode','html','definition'].includes(node.type)) { mark(from,to);continue; }
      if(node.type==='link'||node.type==='linkReference') {
        const first=node.children[0]?.position, last=node.children.at(-1)?.position;
        if(!first||!last||source[from]==='<') {mark(from,to);continue;}
        mark(from,first.start.offset!+bom);mark(last.end.offset!+bom,to);
      }
      if(node.type==='image'||node.type==='imageReference') {
        const label=/^!\[((?:\\.|[^\]\\])*)\]/.exec(source.slice(from,to));
        if(!label) mark(from,to);else {mark(from,from+2);mark(from+2+label[1].length,to);}
      }
      if('children' in node) for(const child of node.children) pending.push(child);
    }
  }
  for(const match of source.matchAll(/https?:\/\/[^\s<>]+|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b[\p{L}\d]+(?:[_/][\p{L}\d]+)+\b/giu)) mark(match.index,match.index+match[0].length);
  const protectedSpans: typeof ranges=[];
  for(const span of ranges.sort((a,b)=>a.from-b.from)) {
    const prev=protectedSpans.at(-1);
    if(prev&&prev.to>=span.from) prev.to=Math.max(prev.to,span.to);else protectedSpans.push(span);
  }
  let text='',cursor=0;
  for(const {from,to} of protectedSpans) {text+=source.slice(cursor,from)+source.slice(from,to).replace(/[^\r\n]/g,' ');cursor=to;}
  return {text:text+source.slice(cursor),protectedSpans};
}
