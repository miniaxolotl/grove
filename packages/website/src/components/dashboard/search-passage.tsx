import { passageParts, searchPassage } from "@/lib/search-passage";

export function SearchPassage({
  content,
  query,
  length = 180,
}: {
  content: string;
  query: string;
  length?: number;
}) {
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
