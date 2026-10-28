import { passageParts, searchPassage } from "@/lib/search-passage";
import type { SearchMatch, SearchText } from "@lib/shared/search";

function MarkedText({
  value,
  length = 500,
}: {
  value: SearchText;
  length?: number;
}) {
  let end = 0;
  const parts = [];
  const boundary = /[\uD800-\uDBFF]/.test(value.text[length - 1] ?? "")
    ? length - 1
    : length;
  const text = value.text.slice(0, boundary);
  for (const range of value.ranges) {
    const [from, to] = range;
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < end ||
      to <= from ||
      to > text.length
    )
      continue;
    parts.push(text.slice(end, from));
    parts.push(
      <mark className="search-match" key={from}>
        {text.slice(from, to)}
      </mark>,
    );
    end = to;
  }
  parts.push(text.slice(end), value.text.length > text.length ? "…" : "");
  return parts;
}

export function SearchTitle({
  title,
  query,
  version,
  evidence,
}: {
  title: string;
  query: string;
  version: number;
  evidence?: SearchMatch;
}) {
  return evidence?.query === query &&
    evidence.version === version &&
    evidence.title.text === title ? (
    <MarkedText value={evidence.title} />
  ) : (
    title
  );
}

export function SearchPassage({
  content,
  query,
  length = 180,
  version,
  evidence,
}: {
  content: string;
  query: string;
  length?: number;
  version?: number;
  evidence?: SearchMatch;
}) {
  if (evidence?.query === query && evidence.version === version)
    return <MarkedText value={evidence.snippet} length={length} />;
  return passageParts(searchPassage(content, query, length), query).map(
    (part, index) =>
      part.match ? (
        <mark className="search-match" key={index}>
          {part.text}
        </mark>
      ) : (
        part.text
      ),
  );
}
