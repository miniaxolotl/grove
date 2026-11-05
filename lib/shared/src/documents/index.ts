export {
  documentLimits,
  DocumentError,
  documentSchema,
  blockSchema,
  patchSchema,
  editScopeSchema,
  operationSchema,
  type StructuredDocument,
  type DocumentBlock,
  type DocumentOperation,
  type DocumentPatch,
  type DocumentEditScope,
  type DocumentAnchor,
  type DocumentDiff,
  type DocumentChange,
  type DocumentTextDiff,
  type TextDiffPart,
} from "./schema.ts";
export {
  createDocument,
  validateDocument,
  serializeDocument,
} from "./document.ts";
export { applyDocumentPatch } from "./patch.ts";
export { compareDocuments, diffDocumentText } from "./diff.ts";
