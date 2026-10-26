import { z } from "zod";
import {
  rememberSchema,
  recallSchema,
  listSchema,
  forgetSchema,
  versionSchema,
  operationSchema,
  uuidSchema,
  kindSchema,
  sourceSchema,
  captureSchema,
  expectedVersionSchema,
} from "./contracts.ts";
import { noteContentDescription } from "@lib/shared/note-writing";

export const memoryUpdateSchema = z
  .object({
    operationId: operationSchema,
    id: uuidSchema,
    expectedVersion: expectedVersionSchema,
    content: z
      .string()
      .trim()
      .min(1)
      .max(6000)
      .describe(noteContentDescription)
      .optional(),
    kind: kindSchema.optional(),
    autoKind: z.boolean().optional(),
    projectId: uuidSchema
      .nullable()
      .optional()
      .describe(
        "Destination notebook UUID; null moves to Personal. Omit to preserve the current notebook. Filing changes require user direction.",
      ),
    taskId: z.string().min(1).max(128).nullable().optional(),
    retentionDays: z.number().int().min(1).max(365).nullable().optional(),
    source: sourceSchema.optional(),
    capture: captureSchema,
  })
  .strict()
  .refine(
    (input) =>
      [
        "content",
        "kind",
        "autoKind",
        "projectId",
        "taskId",
        "retentionDays",
        "source",
      ].some((key) => key in input),
    "Supply a field to update",
  );
export type MemoryUpdate = z.infer<typeof memoryUpdateSchema>;
export const moveMemoriesSchema = forgetSchema
  .extend({ projectId: uuidSchema.nullable() })
  .refine(
    (input) =>
      new Set(input.items.map((item) => item.id)).size === input.items.length,
    "Duplicate note IDs",
  );
export type MoveMemories = z.infer<typeof moveMemoriesSchema>;
export const notebookListSchema = z
  .object({
    status: z.enum(["active", "archived"]).default("active"),
    parentId: uuidSchema.nullable().optional(),
    query: z.string().trim().max(120).optional(),
    cursor: z.string().max(2048).optional(),
    limit: z.number().int().min(1).max(100).default(30),
  })
  .strict();
export type NotebookList = z.infer<typeof notebookListSchema>;
export const notebookCreateSchema = z
  .object({
    operationId: operationSchema,
    name: z.string().trim().min(1).max(120),
    parentId: uuidSchema.nullable().default(null),
  })
  .strict();
export const notebookUpdateSchema = z
  .object({
    operationId: operationSchema,
    id: uuidSchema,
    expectedVersion: expectedVersionSchema,
    name: z.string().trim().min(1).max(120).optional(),
    parentId: uuidSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (input) => input.name !== undefined || input.parentId !== undefined,
    "Supply a name or parent",
  );
export const notebookToolLifecycleSchema = z
  .object({
    id: uuidSchema,
    action: z.enum(["preview", "archive", "restore", "delete"]),
    operationId: operationSchema.optional(),
    expectedVersion: expectedVersionSchema.optional(),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.action === "preview" ||
      !!(input.operationId && input.expectedVersion && input.fingerprint),
    "Changes require operationId, expectedVersion and the preview fingerprint",
  );

/** One contract for remote MCP, the stdio bridge and HTTP tool calls. */
export const memoryTools = {
  remember: {
    title: "Save a memory",
    schema: rememberSchema,
    description:
      "Save a focused, human-readable Markdown memory. Optional id/expectedVersion corrections replace the complete body and replace metadata too, not just supplied fields. Reuse operationId on retries. Handoffs default to 30 days; expired records are hidden and later soft-deleted.",
  },
  recall: {
    title: "Recall saved context",
    schema: recallSchema,
    readOnly: true,
    description:
      "Recall bounded relevant active memories in the explicit project/personal scope. Without query, retrieve a compact profile and selected task handoff.",
  },
  memories: {
    title: "Find memories",
    schema: listSchema,
    readOnly: true,
    description:
      "Search and list notes with IDs, versions, provenance, status/tag filters and cursor pagination. Omit projectId to inspect all granted scopes; null means Personal.",
  },
  forget: {
    title: "Delete selected memories",
    schema: forgetSchema,
    destructive: true,
    description:
      "Soft-delete exact note IDs at their expectedVersion. Retained authored history is hidden, not physically erased. There is no ordinary restore/Undo for deletion. Inspect each outcome; previously delivered text cannot be retracted.",
  },
  get_memory: {
    title: "Read a memory",
    schema: z
      .object({
        id: uuidSchema,
        revision: z.number().int().positive().optional(),
      })
      .strict(),
    readOnly: true,
    description:
      "Read one exact note by ID, optionally at a historical revision. Current scope, deletion and historical-source expiry checks still apply.",
  },
  memory_history: {
    title: "Read memory history",
    schema: z.object({ id: uuidSchema }).strict(),
    readOnly: true,
    description:
      "Read up to 100 most recent revisions of an accessible note, including revision numbers and authored content.",
  },
  update_memory: {
    title: "Update a memory",
    schema: memoryUpdateSchema,
    description:
      "Partially update note fields at expectedVersion. Supplied content replaces the complete body: use human-readable Markdown and preserve unrequested details. Omitted content, scope, kind, provenance and lifetime are preserved. projectId moves the note; null means Personal. Reuse operationId on retry.",
  },
  move_memories: {
    title: "Move memories",
    schema: moveMemoriesSchema,
    description:
      "Atomically move up to 50 exact ID/version notes into an existing notebook (projectId) or Personal (null). Preserve content and metadata; source and destination must be granted. Reuse operationId.",
  },
  archive_memory: {
    title: "Archive a memory",
    schema: z
      .object({
        id: uuidSchema,
        operationId: operationSchema,
        expectedVersion: expectedVersionSchema,
      })
      .strict(),
    description:
      "Archive an exact note at expectedVersion, removing it from recall. Content/history remain available; archiving is reversible. Reuse operationId.",
  },
  restore_memory: {
    title: "Restore a memory",
    schema: versionSchema.extend({ id: uuidSchema }),
    description:
      "Restore an archived/expired note or a historical revision at expectedVersion. Deleted notes cannot be restored. Optional revision selects history; durable removes expiry. Reuse operationId.",
  },
  notebooks: {
    title: "Find notebooks",
    schema: notebookListSchema,
    readOnly: true,
    description:
      "List/search granted notebooks (folders) with IDs, names, parentId, versions and cursor pagination. Follow every page to build a tree. Archived notebooks require an owner website session.",
  },
  create_notebook: {
    title: "Create a notebook",
    schema: notebookCreateSchema,
    description:
      "Create a notebook, optionally under parentId. Requires all-project write access or an owner session. Reuse operationId for retry-safe creation.",
  },
  update_notebook: {
    title: "Update a notebook",
    schema: notebookUpdateSchema,
    description:
      "Rename and/or move an existing notebook at expectedVersion. Omitted fields are preserved; parentId=null moves to root. Source and parent must be granted; cycles are rejected. Reuse operationId.",
  },
  notebook_lifecycle: {
    title: "Manage notebook lifecycle",
    schema: notebookToolLifecycleSchema,
    destructive: true,
    description:
      "Owner website session only: preview a notebook subtree, then archive/restore/soft-delete using its fingerprint, expectedVersion and operationId. Agent OAuth/API keys cannot administer subtrees. Deletion hides retained history and has no ordinary Undo.",
  },
} as const;
export type MemoryToolName = keyof typeof memoryTools;
