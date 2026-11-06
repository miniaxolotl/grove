import { z } from "zod";
import { rememberSchema, uuidSchema } from "@lib/shared/contracts";
import {
  formatWebCapture,
  webCaptureSchema,
  type WebCapture,
} from "@lib/shared/web-capture";

export const captureDraftLifetimeMs = 24 * 60 * 60 * 1000;
const timestamp = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - captureDraftLifetimeMs);
const scopeSchema = z
  .object({
    origin: z
      .string()
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" && url.origin === value;
        } catch {
          return false;
        }
      }),
    accountId: uuidSchema,
    connectionId: uuidSchema,
  })
  .strict();
export type CaptureScope = z.infer<typeof scopeSchema>;

// A local command snapshot separate from later edits, not a supported HTTP body.
const requestSchema = z
  .object({
    operationId: uuidSchema,
    content: rememberSchema.shape.content,
    projectId: uuidSchema.nullable(),
    capture: z.literal("explicit"),
    provenance: webCaptureSchema.optional(),
  })
  .strict();
const receiptSchema = z
  .object({
    status: z.literal("saved"),
    noteId: uuidSchema,
    version: z.number().int().positive(),
    indexing: z.enum(["disabled", "pending", "ready", "failed"]),
  })
  .strict();
const outcomeSchema = z.union([
  receiptSchema,
  z.object({ status: z.enum(["failed", "uncertain"]) }).strict(),
]);
const saveSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.enum(["saving", "failed", "uncertain"]),
      request: requestSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("saved"),
      request: requestSchema,
      receipt: receiptSchema,
    })
    .strict(),
]);
const draftSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: scopeSchema,
    text: z.string().max(6000),
    source: webCaptureSchema.optional(),
    projectId: uuidSchema.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: timestamp,
    save: saveSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.expiresAt === value.createdAt + captureDraftLifetimeMs &&
      value.updatedAt >= value.createdAt &&
      value.updatedAt < value.expiresAt,
  );
export type CaptureDraft = z.infer<typeof draftSchema>;
export type CaptureSaveOutcome = z.infer<typeof outcomeSchema>;
const changesSchema = z
  .object({
    text: z.string().max(6000).optional(),
    source: webCaptureSchema.nullable().optional(),
    projectId: uuidSchema.nullable().optional(),
  })
  .strict();

export function createCaptureDraft(input: {
  scope: CaptureScope;
  text: string;
  projectId: string | null;
  source?: z.infer<typeof webCaptureSchema>;
  now: number;
}): CaptureDraft {
  const now = timestamp.parse(input.now);
  return draftSchema.parse({
    schemaVersion: 1,
    scope: input.scope,
    text: input.text,
    projectId: input.projectId,
    ...(input.source ? { source: input.source } : {}),
    createdAt: now,
    updatedAt: now,
    expiresAt: now + captureDraftLifetimeMs,
  });
}

/** Read on every access; callers remove invalid/expired values from session storage. */
export function readCaptureDraft(
  value: unknown,
  scope: CaptureScope,
  now: number,
): CaptureDraft | null {
  const parsed = draftSchema.safeParse(value);
  const owner = scopeSchema.safeParse(scope);
  if (!parsed.success || !owner.success || !timestamp.safeParse(now).success)
    return null;
  const draft = parsed.data;
  if (
    now < draft.updatedAt ||
    now >= draft.expiresAt ||
    draft.scope.origin !== owner.data.origin ||
    draft.scope.accountId !== owner.data.accountId ||
    draft.scope.connectionId !== owner.data.connectionId
  )
    return null;
  return draft;
}

function activeDraft(
  value: CaptureDraft,
  scope: CaptureScope,
  now: number,
): CaptureDraft {
  const draft = readCaptureDraft(value, scope, now);
  if (!draft)
    throw new Error("Capture draft expired or changed account/connection");
  return draft;
}

export function editCaptureDraft(
  value: CaptureDraft,
  scope: CaptureScope,
  changes: z.infer<typeof changesSchema>,
  now: number,
): CaptureDraft {
  const draft = activeDraft(value, scope, now);
  const update = changesSchema.parse(changes);
  const result = { ...draft, updatedAt: now };
  if (update.text !== undefined) result.text = update.text;
  if (update.projectId !== undefined) result.projectId = update.projectId;
  if (update.source === null) delete result.source;
  else if (update.source !== undefined) result.source = update.source;
  return draftSchema.parse(result);
}

/** Persist this draft before I/O. Unresolved saves may only replay identical arguments. */
export function prepareCaptureSave(
  value: CaptureDraft,
  scope: CaptureScope,
  operationId: string,
  now: number,
  automaticSource?: WebCapture | null,
): CaptureDraft {
  const draft = activeDraft(value, scope, now);
  uuidSchema.parse(operationId);
  if (draft.save && draft.save.status !== "saved") {
    if (draft.save.request.operationId !== operationId)
      throw new Error(
        "Reconcile the pending operation before starting another save",
      );
    return {
      ...draft,
      updatedAt: now,
      save: { status: "saving", request: draft.save.request },
    };
  }
  if (draft.save?.request.operationId === operationId)
    throw new Error("A new save requires a new operation ID");
  const request = requestSchema.parse({
    operationId,
    content: formatWebCapture(draft),
    projectId: draft.projectId,
    capture: "explicit",
    ...(draft.source || automaticSource
      ? { provenance: draft.source ?? automaticSource }
      : {}),
  });
  return { ...draft, updatedAt: now, save: { status: "saving", request } };
}

export function settleCaptureSave(
  value: CaptureDraft,
  scope: CaptureScope,
  operationId: string,
  outcome: CaptureSaveOutcome,
  now: number,
): CaptureDraft {
  const draft = activeDraft(value, scope, now);
  if (!draft.save || draft.save.request.operationId !== operationId)
    throw new Error("Capture operation does not match the pending save");
  const result = outcomeSchema.parse(outcome);
  if (draft.save.status === "saved") {
    if (JSON.stringify(draft.save.receipt) === JSON.stringify(result))
      return draft;
    throw new Error("Capture operation already completed");
  }
  return {
    ...draft,
    updatedAt: now,
    save:
      result.status === "saved"
        ? { status: "saved", request: draft.save.request, receipt: result }
        : { status: result.status, request: draft.save.request },
  };
}
