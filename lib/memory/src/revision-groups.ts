import { sourceEditsBetween } from "@lib/shared/document-edits";
import type { StructuredDocument } from "@lib/shared/documents";

export type RevisionEdit = {
  session: string;
  writer: string;
  checkpoint?: boolean;
  eligible: boolean;
};
type RevisionGroup = {
  start: number;
  number: number;
  startedAt: string;
  size: number;
  open: boolean;
  session: string | null;
  writer: string | null;
};
export type PreviousRevision = {
  version: number;
  content: string;
  createdAt: Date;
  revisionGroup: RevisionGroup | null;
};

/** Logical history only. Every atomic save keeps its immutable source version. */
export function revisionGroup(
  version: number,
  document: StructuredDocument,
  now: Date,
  previous?: PreviousRevision,
  previousDocument?: StructuredDocument,
  edit?: RevisionEdit,
): RevisionGroup {
  const content = document.blocks.map((b) => b.source).join("");
  const splices = previous ? sourceEditsBetween(previous.content, content) : [];
  const size = splices.reduce(
    (sum, splice) => sum + splice.oldText.length + splice.text.length,
    0,
  );
  const small = !!(
    edit?.eligible &&
    previous &&
    previousDocument &&
    size > 0 &&
    size <= 256 &&
    splices.every(
      (s) =>
        !/[\r\n]/.test(s.oldText + s.text) &&
        Math.max(s.oldText.length, s.text.length) <=
          Math.max(32, Math.floor(previous.content.length / 4)),
    ) &&
    document.blocks.length === previousDocument.blocks.length &&
    document.blocks.every(
      (b, i) =>
        b.id === previousDocument.blocks[i].id &&
        b.kind === previousDocument.blocks[i].kind,
    )
  );
  const prior = previous?.revisionGroup;
  const elapsed = previous
    ? now.getTime() - new Date(previous.createdAt).getTime()
    : Infinity;
  const age = prior
    ? now.getTime() - new Date(prior.startedAt).getTime()
    : Infinity;
  if (
    small &&
    !edit?.checkpoint &&
    prior?.open &&
    prior.session === edit?.session &&
    prior.writer === edit?.writer &&
    elapsed >= 0 &&
    elapsed <= 30_000 &&
    age >= 0 &&
    age <= 120_000 &&
    prior.size + size <= 1000
  )
    return { ...prior, size: prior.size + size };
  return {
    start: version,
    number: (prior?.number ?? previous?.version ?? 0) + 1,
    startedAt: now.toISOString(),
    size,
    open: small && !edit?.checkpoint,
    session: edit?.session ?? null,
    writer: edit?.writer ?? null,
  };
}
