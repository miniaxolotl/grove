import { z } from "zod";

const text = z
  .string()
  .max(6000)
  .refine((s) => !/[\uD800-\uDFFF]/u.test(s));
export const sourceEditSchema = z
  .object({
    from: z.number().int().min(0).max(6000),
    to: z.number().int().min(0).max(6000),
    oldText: text,
    text,
  })
  .strict();
export const sourceEditsSchema = z.array(sourceEditSchema).min(1).max(50);
export type SourceEdit = z.infer<typeof sourceEditSchema>;
export function applySourceEdits(source: string, raw: unknown): string {
  const edits = sourceEditsSchema.parse(raw);
  let inserted = 0;
  for (const edit of edits) {
    inserted += edit.text.length;
    if (
      inserted > 6000 ||
      edit.from > edit.to ||
      edit.to > source.length ||
      source.slice(edit.from, edit.to) !== edit.oldText
    )
      throw new Error(
        "The selected text changed. Read the note and review your edit again.",
      );
    const next = source.slice(0, edit.from) + edit.text + source.slice(edit.to);
    if (!next.trim() || next.length > 6000 || /[\uD800-\uDFFF]/u.test(next))
      throw new Error("Invalid note edit");
    source = next;
  }
  return source;
}

/** Smallest contiguous splice, including code-point-safe boundaries. No whole-body resend. */
export function sourceEditsBetween(
  before: string,
  after: string,
): SourceEdit[] {
  if (before === after) return [];
  let from = 0,
    end = 0;
  const a = Array.from(before),
    b = Array.from(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start])
    from += a[start++].length;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - end - 1] === b[b.length - end - 1]
  )
    end++;
  const suffix = end ? a.slice(a.length - end).join("").length : 0;
  return [
    {
      from,
      to: before.length - suffix,
      oldText: before.slice(from, before.length - suffix),
      text: after.slice(from, after.length - suffix),
    },
  ];
}
