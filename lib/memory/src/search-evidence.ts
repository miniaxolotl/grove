import { randomUUID } from "node:crypto";
import type { Knex } from "@lib/database";
import { GroveError, type Memory } from "@lib/shared/contracts";
import {
  noteTitle,
  plainExcerpt,
  searchExpansion,
  type SearchMatches,
  type SearchText,
} from "@lib/shared/search";
import type { SearchRow } from "./lexical.ts";

/** Return only inert text and UTF-16 ranges. Never return headline HTML. */
export async function searchEvidence(
  trx: Knex.Transaction,
  items: Memory[],
  query: string,
  rows: SearchRow[],
): Promise<SearchMatches> {
  if (!items.length) return {};
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const note of items) {
    const selected = byId.get(note.id);
    if (
      selected &&
      (selected.version !== note.version ||
        (selected.searchTitle !== undefined &&
          selected.searchTitle !==
            noteTitle(note.content, note.enrichment?.title)))
    )
      throw new GroveError(
        "stale_search",
        "Search sources changed. Start this search again.",
        409,
      );
  }
  const sources = items.map((note) => ({
    id: note.id,
    version: note.version,
    tier: byId.get(note.id)?.searchTier ?? 6,
    title: noteTitle(note.content, note.enrichment?.title),
    body: plainExcerpt(note.content.replaceAll("_", " "), 100_000),
  }));
  let marker: string;
  do {
    marker = randomUUID().replaceAll("-", "");
  } while (
    sources.some(
      (row) => row.title.includes(marker) || row.body.includes(marker),
    )
  );
  const start = `grove${marker}start`,
    stop = `grove${marker}stop`;
  const options = `StartSel=${start},StopSel=${stop},MaxFragments=1,MinWords=8,MaxWords=32`;
  const expansion = searchExpansion(query);
  const result = await trx.raw(
    `SELECT s.*,
    CASE WHEN tier<4 THEN ts_headline('english',title,q,?) ELSE title END AS marked_title,
    CASE WHEN tier<4 THEN ts_headline('english',body,q,?) ELSE body END AS marked_body
    FROM jsonb_to_recordset(?::jsonb) AS s(id text,version integer,tier integer,title text,body text)
    CROSS JOIN LATERAL (SELECT CASE WHEN tier IN (1,3) THEN to_tsquery('english',?)
      ELSE websearch_to_tsquery('english',?) END AS q) queries`,
    [
      `StartSel=${start},StopSel=${stop},HighlightAll=true`,
      options,
      JSON.stringify(sources),
      expansion?.prefix ?? "",
      query,
    ],
  );
  function text(marked: string, max: number, whole = false): SearchText {
    const ranges: [number, number][] = [];
    let value = "",
      opening: number | undefined;
    for (const part of marked.split(new RegExp(`(${start}|${stop})`, "g"))) {
      if (part === start) opening = value.length;
      else if (part === stop) {
        if (opening !== undefined && value.length > opening)
          ranges.push([opening, value.length]);
        opening = undefined;
      } else value += part;
    }
    // Keep the first proven hit in view even if a long headline exceeds the UI window.
    let from = whole ? 0 : Math.max(0, (ranges[0]?.[0] ?? 0) - 45);
    if (from && value[from - 1] !== " ") {
      const boundary = value.indexOf(" ", from);
      if (boundary >= 0 && boundary < (ranges[0]?.[0] ?? 0))
        from = boundary + 1;
    }
    const leading = from ? "…" : "";
    let to = Math.min(value.length, from + max);
    if (to < value.length && /[\uD800-\uDBFF]/.test(value[to - 1])) to--;
    const visible = value.slice(from, to);
    return {
      text: leading + visible + (to < value.length ? "…" : ""),
      ranges: ranges
        .filter(([a, b]) => a >= from && b <= to)
        .map(([a, b]) => [
          a - from + leading.length,
          b - from + leading.length,
        ]),
    };
  }
  return Object.fromEntries(
    result.rows.map(
      (row: {
        id: string;
        version: number;
        tier: number;
        marked_title: string;
        marked_body: string;
      }) => [
        row.id,
        {
          query,
          version: row.version,
          kind:
            row.tier === 0
              ? "title"
              : row.tier === 1 || row.tier === 3
                ? "prefix"
                : row.tier === 2
                  ? "body"
                  : row.tier < 6
                    ? "fuzzy"
                    : "semantic",
          title: text(row.marked_title, 120, true),
          snippet: text(row.marked_body, 220),
        },
      ],
    ),
  );
}
