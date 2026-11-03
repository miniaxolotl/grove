import { createHash, randomUUID } from "node:crypto";
import { InferenceError } from "@lib/ai";
import { tenant, type Knex } from "@lib/database";
import { GroveError, type Principal } from "@lib/shared/contracts";
import {
  documentAcceptanceSchema,
  documentConversionSchema,
  type DocumentList,
  type DocumentEvidence,
  type DocumentSource,
  type ConversationDocument,
} from "@lib/shared/conversation-documents";
import { mediaObjectKey } from "@lib/shared/media";
import type { ConversationReply } from "@lib/shared/conversations";
import type { MemoryService } from "./index.ts";
import {
  DocumentImports,
  type DocumentExtraction,
  type DocumentSourceStore,
} from "./document-imports.ts";
import { taskTransaction, TaskError, type TaskHandler } from "./task-runner.ts";

type DocumentRow = {
  id: string;
  conversationId: string;
  filename: string;
  bytes: number;
  sha256: string;
  staging: Buffer | null;
  mime: DocumentExtraction["mime"];
  status: string;
  version: number;
  taskId: string;
  accepted: boolean;
  objectKey: string | null;
  removedAt: Date | null;
  expiresAt: Date;
  acceptLease: string | null;
  acceptUntil: Date | null;
};
const missing = () =>
  new GroveError("not_found", "Document is unavailable", 404);
const changed = () =>
  new GroveError(
    "documents_changed",
    "Documents changed. Review the attachments and try again.",
    409,
  );
/** Retained turn JSON is not an alternate access path to revoked evidence. */
export function maskDocumentReply<
  T extends Pick<
    ConversationReply,
    | "documentContext"
    | "documentSources"
    | "documentStatements"
    | "message"
    | "proposal"
    | "organization"
    | "lifecycle"
  >,
>(result: T, active: { id: string; version: number }[]): T {
  if (
    !result.documentContext ||
    result.documentContext.documents.every((ref) =>
      active.some((doc) => doc.id === ref.id && doc.version === ref.version),
    )
  )
    return result;
  return {
    ...result,
    message: "The attached document sources are no longer available.",
    documentStatements: [],
    documentSources: [],
    proposal: result.proposal?.status === "proposed" ? null : result.proposal,
    organization:
      result.organization?.status === "proposed"
        ? undefined
        : result.organization,
    lifecycle:
      result.lifecycle?.status === "proposed" ? undefined : result.lifecycle,
  };
}
export async function documentChat(trx: Knex.Transaction, id: string) {
  const chat = await trx("conversations").where({ id }).first();
  if (!chat) throw missing();
  return chat;
}
const available = (q: Knex.QueryBuilder) =>
  q
    .whereNull("removedAt")
    .where((sub) =>
      sub
        .where("accepted", true)
        .orWhere("expiresAt", ">", q.client.raw("now()")),
    );
export async function expireConversationDocuments(trx: Knex.Transaction) {
  const docs = await trx("conversation_documents")
    .where({ accepted: false })
    .whereNull("removedAt")
    .where("expiresAt", "<=", trx.fn.now())
    .orderBy("id")
    .limit(25)
    .select("id", "conversationId");
  if (!docs.length) return;
  await trx("conversation_document_chunks")
    .whereIn(
      "documentId",
      docs.map((d) => d.id),
    )
    .update({ content: "[Upload expired]" });
  await trx("conversation_documents")
    .whereIn(
      "id",
      docs.map((d) => d.id),
    )
    .update({
      staging: null,
      removedAt: trx.fn.now(),
      acceptLease: null,
      acceptUntil: null,
    });
  await trx("conversations")
    .whereIn(
      "id",
      docs.map((d) => d.conversationId),
    )
    .increment("documentsVersion", 1);
}
export async function documentSnapshot(
  trx: Knex.Transaction,
  conversationId: string,
  query: string,
): Promise<DocumentEvidence> {
  const chat = await documentChat(trx, conversationId);
  if (
    await trx("conversation_documents")
      .where({ conversationId, accepted: false })
      .modify(available)
      .first("id")
  )
    throw new GroveError(
      "documents_not_ready",
      "Accept ready attachments or remove them before sending",
      409,
    );
  const docs: DocumentRow[] = await trx("conversation_documents")
    .where({ conversationId, accepted: true, status: "ready" })
    .modify(available)
    .orderBy("createdAt")
    .orderBy("id");
  const tokens = [...new Set(query.match(/[\p{L}\p{N}]{2,}/gu) ?? [])]
    .slice(0, 32)
    .join(" OR ");
  const ranked = trx("conversation_document_chunks as p")
    .join("conversation_documents as d", function () {
      this.on("d.accountId", "p.accountId").andOn("d.id", "p.documentId");
    })
    .whereIn(
      "p.documentId",
      docs.map((d) => d.id),
    )
    .select(
      "p.id",
      "p.documentId",
      "p.ordinal",
      "p.content",
      "p.pageStart",
      "p.pageEnd",
      "p.sourceStart",
      "p.sourceEnd",
      "d.filename",
      "d.version",
    );
  const first = await ranked
    .clone()
    .distinctOn("p.documentId")
    .orderBy("p.documentId")
    .orderBy("p.ordinal");
  const hits = await ranked
    .clone()
    .orderByRaw("ts_rank_cd(p.search,websearch_to_tsquery('english',?)) DESC", [
      tokens,
    ])
    .orderBy("p.documentId")
    .orderBy("p.ordinal")
    .limit(24);
  const total = Number(
    (
      await trx("conversation_document_chunks")
        .whereIn(
          "documentId",
          docs.map((d) => d.id),
        )
        .count("id as total")
        .first()
    )?.total ?? 0,
  );
  const ordered = [
    ...new Map(
      [
        ...hits.filter(
          (p) =>
            tokens &&
            (p.content.toLowerCase().includes(query.toLowerCase()) ||
              tokens
                .split(" OR ")
                .some((t) =>
                  p.content.toLowerCase().includes(t.toLowerCase()),
                )),
        ),
        ...first,
        ...hits,
      ].map((p) => [p.id, p]),
    ).values(),
  ];
  let chars = 0;
  let truncated = false;
  const sources: DocumentSource[] = [];
  for (const p of ordered) {
    if (sources.length >= 12 || chars >= 24000) break;
    let content = p.content.slice(0, 24000 - chars);
    if (/[\uD800-\uDBFF]$/.test(content)) content = content.slice(0, -1);
    if (content.length < p.content.length) truncated = true;
    chars += content.length;
    sources.push({ ...p, content, sourceEnd: p.sourceStart + content.length });
  }
  return {
    version: chat.documentsVersion,
    sources,
    documents: docs.map((d) => ({ id: d.id, version: d.version })),
    shown: sources.length,
    total,
    partial: sources.length < total || truncated,
  };
}
export async function validateDocumentSnapshot(
  trx: Knex.Transaction,
  conversationId: string,
  version: number,
  refs: { id: string; version: number }[],
) {
  const chat = await documentChat(trx, conversationId);
  if (chat.documentsVersion !== version) throw changed();
  const rows = await trx("conversation_documents")
    .where({ conversationId, accepted: true, status: "ready" })
    .whereNull("removedAt");
  if (
    refs.some(
      (ref) =>
        !rows.some((row) => row.id === ref.id && row.version === ref.version),
    )
  )
    throw changed();
}
export function validateDocumentStatements(
  statements: { sources: { id: string; version: number; quote: string }[] }[],
  sources: DocumentSource[],
) {
  if (
    statements.some((statement) =>
      statement.sources.some(
        (ref) =>
          !sources.some(
            (s) =>
              s.id === ref.id &&
              s.version === ref.version &&
              s.content.includes(ref.quote),
          ),
      ),
    )
  )
    throw new InferenceError("generation_invalid_document_citation", false);
}
export async function bindConversationDocuments(
  trx: Knex.Transaction,
  accountId: string,
  notes: { id: string; version: number }[],
  sources: DocumentSource[],
  statements: { sources: { id: string; quote: string }[] }[],
) {
  const refs = [
    ...new Map(
      statements.flatMap((s) => s.sources).map((ref) => [ref.id, ref]),
    ).values(),
  ];
  const rows = notes.flatMap((note) =>
    refs.map((ref) => ({
      accountId,
      memoryId: note.id,
      version: note.version,
      documentId: sources.find((s) => s.id === ref.id)!.documentId,
      chunkId: ref.id,
      quote: ref.quote,
    })),
  );
  if (rows.length)
    await trx("conversation_document_bindings")
      .insert(rows)
      .onConflict(["accountId", "memoryId", "version", "chunkId"])
      .ignore();
}
export class ConversationDocuments {
  constructor(private service: MemoryService) {}
  async list(
    principal: Principal,
    conversationId: string,
  ): Promise<DocumentList> {
    return this.service.access(principal, "admin", async ({ trx }) => {
      const chat = await documentChat(trx, conversationId);
      const documents: ConversationDocument[] = await trx(
        "conversation_documents",
      )
        .where({ conversationId })
        .modify(available)
        .select(
          "id",
          "filename",
          "bytes",
          "status",
          "error",
          "pages",
          "emptyPages",
          "accepted",
          "taskId",
        )
        .orderBy("createdAt")
        .orderBy("id");
      const tasks = await trx("background_tasks")
        .whereIn(
          "id",
          documents.map((doc) => doc.taskId),
        )
        .select("id", "status");
      for (const doc of documents) {
        const failed =
          doc.status === "pending" &&
          tasks.some(
            (task) => task.id === doc.taskId && task.status === "failed",
          );
        if (failed) {
          doc.status = "failed";
          doc.retryable = true;
          doc.error = "document_worker_failed";
        }
      }
      return { version: chat.documentsVersion, documents };
    });
  }
  async upload(
    principal: Principal,
    conversationId: string,
    id: string,
    filename: string,
    bytes: Buffer,
  ) {
    // eslint-disable-next-line no-control-regex -- filenames are untrusted data
    const invalid = /[\x00-\x1f/\\]/.test(filename);
    if (
      invalid ||
      filename.length > 200 ||
      !/\.(pdf|md|markdown|txt|docx)$/i.test(filename)
    )
      throw new GroveError(
        "document_type",
        "Choose PDF, DOCX, Markdown or text",
        422,
      );
    if (!bytes.length || bytes.length > 3 * 1024 * 1024)
      throw new GroveError(
        "document_size",
        "Files must be 3 MiB or smaller",
        413,
      );
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      await documentChat(trx, conversationId);
      const old = await trx("conversation_documents").where({ id }).first();
      if (old) {
        if (!old.accepted && new Date(old.expiresAt) <= new Date())
          throw new GroveError(
            "document_expired",
            "Upload expired. Choose the file again.",
            410,
          );
        if (
          old.conversationId !== conversationId ||
          old.sha256 !== sha256 ||
          old.filename !== filename ||
          old.removedAt
        )
          throw changed();
        return { id, taskId: old.taskId };
      }
      const count = Number(
        (
          await trx("conversation_documents")
            .where({ conversationId })
            .modify(available)
            .count("id as n")
            .first()
        )?.n ?? 0,
      );
      if (count >= 25)
        throw new GroveError(
          "document_limit",
          "Keep at most 25 documents in a conversation",
          429,
        );
      const { rows } = await trx.raw(
        `SELECT COALESCE((SELECT sum(octet_length(staging)) FROM conversation_documents),0)+COALESCE((SELECT sum(octet_length(staging)) FROM document_import_files),0) AS bytes`,
      );
      if (Number(rows[0].bytes) + bytes.length > 75 * 1024 * 1024)
        throw new GroveError(
          "document_staging_limit",
          "Finish or remove pending uploads before adding more",
          429,
        );
      const taskId = randomUUID();
      await trx("background_tasks").insert({
        id: taskId,
        accountId: account.id,
        kind: "conversation_document",
        dedupeKey: taskId,
        payload: JSON.stringify({ conversationId, documentId: id }),
        total: 1,
      });
      await trx("conversation_documents").insert({
        id,
        accountId: account.id,
        conversationId,
        filename,
        bytes: bytes.length,
        sha256,
        staging: bytes,
        taskId,
      });
      await trx("conversations")
        .where({ id: conversationId })
        .increment("documentsVersion", 1);
      return { id, taskId };
    });
  }
  async accept(
    principal: Principal,
    conversationId: string,
    raw: unknown,
    store: DocumentSourceStore,
    signal: AbortSignal,
  ) {
    const { expectedVersion } = documentAcceptanceSchema.parse(raw);
    if (!store.writeDocument)
      throw new GroveError(
        "documents_unavailable",
        "Document storage is unavailable",
        503,
      );
    for (let index = 0; index < 25; index++) {
      const claim = await this.service.access(
        principal,
        "admin",
        async ({ trx, account }) => {
          const chat = await documentChat(trx, conversationId);
          if (chat.documentsVersion !== expectedVersion) throw changed();
          const docs: DocumentRow[] = await trx<DocumentRow>(
            "conversation_documents",
          )
            .where({ conversationId })
            .modify(available)
            .orderBy("createdAt")
            .orderBy("id");
          if (docs.some((d) => d.status !== "ready"))
            throw new GroveError(
              "documents_not_ready",
              "Remove unreadable documents or wait for reading to finish",
              409,
            );
          const doc = docs.find((d) => !d.accepted);
          if (!doc) return null;
          if (
            doc.acceptLease &&
            doc.acceptUntil &&
            new Date(doc.acceptUntil) > new Date()
          )
            throw new GroveError(
              "documents_busy",
              "These documents are still being attached. Retry shortly.",
              409,
            );
          const quota = await trx("accounts")
            .where({ id: account.id })
            .first("mediaBytes", "mediaAttempts");
          if (
            Number(quota.mediaBytes) + doc.bytes > 1024 * 1024 * 1024 ||
            quota.mediaAttempts >= 1000
          )
            throw new GroveError(
              "media_quota",
              "Original document storage allowance reached",
              429,
            );
          const lease = randomUUID(),
            key = mediaObjectKey(account.id, doc.id, lease);
          await trx("conversation_document_attempts").insert({
            accountId: account.id,
            documentId: doc.id,
            id: lease,
            objectKey: key,
          });
          await trx("accounts")
            .where({ id: account.id })
            .increment({ mediaBytes: doc.bytes, mediaAttempts: 1 });
          await trx("conversation_documents")
            .where({ id: doc.id })
            .update({
              acceptLease: lease,
              acceptUntil: trx.raw("clock_timestamp()+interval '120 seconds'"),
            });
          return { doc, lease, key };
        },
      );
      if (!claim) break;
      try {
        await store.writeDocument(
          claim.key,
          {
            bytes: claim.doc.staging!,
            sha256: claim.doc.sha256,
            mime: claim.doc.mime,
          },
          signal,
        );
        await this.service.access(principal, "admin", async ({ trx }) => {
          signal.throwIfAborted();
          const chat = await documentChat(trx, conversationId);
          if (chat.documentsVersion !== expectedVersion) throw changed();
          const doc = await trx("conversation_documents")
            .where({
              id: claim.doc.id,
              acceptLease: claim.lease,
              accepted: false,
            })
            .whereNull("removedAt")
            .where("acceptUntil", ">", trx.fn.now())
            .where("expiresAt", ">", trx.fn.now())
            .first();
          if (!doc) throw changed();
          await trx("conversation_documents").where({ id: doc.id }).update({
            accepted: true,
            objectKey: claim.key,
            staging: null,
            acceptLease: null,
            acceptUntil: null,
          });
          // Acceptance changes exported visibility, not the attachment identity
          // used by the pending Send operation. The normal chat trigger fences exports.
          await trx("conversations")
            .where({ id: conversationId })
            .update({ updatedAt: trx.fn.now() });
        });
      } catch (error) {
        await this.service
          .access(principal, "admin", async ({ trx }) => {
            await trx("conversation_documents")
              .where({ id: claim.doc.id, acceptLease: claim.lease })
              .update({ acceptLease: null, acceptUntil: null });
          })
          .catch(() => {});
        throw error;
      }
    }
    return this.list(principal, conversationId);
  }
  async remove(principal: Principal, conversationId: string, id: string) {
    return this.service.access(principal, "admin", async ({ trx }) => {
      await documentChat(trx, conversationId);
      const doc = await trx("conversation_documents")
        .where({ id, conversationId })
        .first();
      if (!doc) throw missing();
      if (!doc.removedAt) {
        if (!doc.accepted) {
          await trx("conversation_document_chunks")
            .where({ documentId: id })
            .update({ content: "[Upload unavailable]" });
          await trx("conversation_documents")
            .where({ id })
            .update({ staging: null });
        }
        await trx("conversation_documents").where({ id }).update({
          removedAt: trx.fn.now(),
          acceptLease: null,
          acceptUntil: null,
        });
        await trx("conversations")
          .where({ id: conversationId })
          .increment("documentsVersion", 1);
      }
      return { removed: true };
    });
  }
  async original(principal: Principal, conversationId: string, id: string) {
    return this.service.access(principal, "admin", async ({ trx }) => {
      await documentChat(trx, conversationId);
      const doc = await trx("conversation_documents")
        .where({ id, conversationId, accepted: true })
        .whereNull("removedAt")
        .first();
      if (!doc) throw missing();
      return {
        key: doc.objectKey,
        filename: doc.filename,
        mime: doc.mime,
        bytes: doc.bytes,
        sha256: doc.sha256,
      };
    });
  }
  async noteOriginal(principal: Principal, memoryId: string, id: string) {
    return this.service.access(principal, "admin", async ({ trx }) => {
      const memory = await trx("memories").where({ id: memoryId }).first("id");
      const binding = await trx("conversation_document_bindings")
        .where({ memoryId, documentId: id })
        .first("chunkId");
      if (!memory || !binding) throw missing();
      const doc = await trx("conversation_documents")
        .where({ id, accepted: true })
        .first();
      if (!doc) throw missing();
      return {
        key: doc.objectKey,
        filename: doc.filename,
        mime: doc.mime,
        bytes: doc.bytes,
        sha256: doc.sha256,
      };
    });
  }
  async noteSources(principal: Principal, memoryId: string) {
    return this.service.access(principal, "admin", async ({ trx }) => {
      if (!(await trx("memories").where({ id: memoryId }).first("id")))
        throw missing();
      return trx("conversation_document_bindings as b")
        .join("conversation_documents as d", function () {
          this.on("d.accountId", "b.accountId").andOn("d.id", "b.documentId");
        })
        .where("b.memoryId", memoryId)
        .select("d.id", "d.filename", "b.version", "b.quote")
        .orderBy("b.version", "desc")
        .orderBy("d.id")
        .limit(50);
    });
  }
  async fromImport(principal: Principal, batchId: string, raw: unknown) {
    const input = documentConversionSchema.parse(raw);
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const old = await trx("conversation_document_handoffs")
        .where({ id: input.id })
        .first();
      if (old) {
        if (old.batchId !== batchId || old.version !== input.expectedVersion)
          throw changed();
        return this.service
          .inTransaction(trx)
          .conversations.get(principal, input.id);
      }
      const batch = await trx("document_import_batches")
        .where({ id: batchId, status: "ready", version: input.expectedVersion })
        .where("expiresAt", ">", trx.fn.now())
        .first();
      if (!batch) throw changed();
      const files = await trx("document_import_files").where({ batchId });
      if (
        !files.length ||
        files.some((f) => !f.staging || f.status !== "ready")
      )
        throw new GroveError(
          "documents_not_ready",
          "Only readable, unconfirmed uploads can continue in Ask",
          409,
        );
      const { rows } = await trx.raw(
        `SELECT COALESCE((SELECT sum(octet_length(staging)) FROM conversation_documents),0)+COALESCE((SELECT sum(octet_length(staging)) FROM document_import_files),0) AS bytes`,
      );
      if (
        Number(rows[0].bytes) + files.reduce((n, f) => n + f.bytes, 0) >
        75 * 1024 * 1024
      )
        throw new GroveError(
          "document_staging_limit",
          "Finish or remove pending uploads before adding more",
          429,
        );
      const service = this.service.inTransaction(trx),
        docs = new ConversationDocuments(service);
      await service.conversations.create(principal, {
        id: input.id,
        includePersonal: false,
      });
      for (const file of files)
        await docs.upload(
          principal,
          input.id,
          randomUUID(),
          file.filename,
          file.staging,
        );
      await trx("conversation_document_handoffs").insert({
        accountId: account.id,
        id: input.id,
        batchId,
        version: input.expectedVersion,
      });
      return service.conversations.get(principal, input.id);
    });
  }
  async passages(
    principal: Principal,
    conversationId: string,
    id: string,
    after = 0,
  ) {
    return this.service.access(principal, "admin", async ({ trx }) => {
      await documentChat(trx, conversationId);
      const doc = await trx("conversation_documents")
        .where({ id, conversationId, accepted: true })
        .whereNull("removedAt")
        .first();
      if (!doc) throw missing();
      return trx("conversation_document_chunks")
        .where({ documentId: id })
        .where("ordinal", ">=", after)
        .orderBy("ordinal")
        .select("id", "content", "ordinal", "pageStart", "pageEnd")
        .limit(10);
    });
  }
  async import(principal: Principal, conversationId: string, raw: unknown) {
    const input = documentConversionSchema.parse(raw);
    return this.service.access(principal, "admin", async ({ trx, account }) => {
      const chat = await documentChat(trx, conversationId),
        old = await trx("conversation_document_imports")
          .where({ id: input.id })
          .first();
      if (old) {
        if (
          old.conversationId !== conversationId ||
          old.version !== input.expectedVersion
        )
          throw changed();
        return { id: old.batchId };
      }
      if (chat.documentsVersion !== input.expectedVersion) throw changed();
      const docs = await trx<DocumentRow>("conversation_documents")
        .where({ conversationId, accepted: true, status: "ready" })
        .whereNull("removedAt");
      if (!docs.length) throw missing();
      await new DocumentImports(this.service.inTransaction(trx)).create(
        principal,
        { id: input.id },
      );
      const chunks = await trx("conversation_document_chunks")
        .whereIn(
          "documentId",
          docs.map((d) => d.id),
        )
        .orderBy("documentId")
        .orderBy("ordinal");
      if (chunks.length > 500)
        throw new GroveError(
          "import_note_limit",
          "Select fewer documents: at most 500 notes per import",
          422,
        );
      const files = new Map(docs.map((d) => [d.id, randomUUID()]));
      await trx("document_import_files").insert(
        docs.map((d) => ({
          accountId: account.id,
          batchId: input.id,
          id: files.get(d.id),
          filename: d.filename,
          bytes: d.bytes,
          sha256: d.sha256,
          mime: d.mime,
          status: "ready",
          pages: (d as unknown as { pages: number }).pages,
          objectKey: d.objectKey,
          originalReady: true,
        })),
      );
      await trx("document_import_notes").insert(
        chunks
          .filter((p) => p.content.trim())
          .map((p) => ({
            accountId: account.id,
            batchId: input.id,
            id: randomUUID(),
            fileId: files.get(p.documentId),
            ordinal: p.ordinal,
            content: p.content,
            pageStart: p.pageStart,
            pageEnd: p.pageEnd,
            sourceStart: p.sourceStart,
            sourceEnd: p.sourceEnd,
          })),
      );
      await trx("document_import_batches")
        .where({ id: input.id })
        .update({ status: "ready" });
      await trx("conversation_document_imports").insert({
        accountId: account.id,
        id: input.id,
        conversationId,
        version: input.expectedVersion,
        batchId: input.id,
      });
      return { id: input.id };
    });
  }
}
export function conversationDocumentHandlers(
  service: MemoryService,
  extract: (
    bytes: Buffer,
    filename: string,
    signal: AbortSignal,
  ) => Promise<DocumentExtraction>,
): { conversation_document: TaskHandler } {
  return {
    conversation_document: async (task, signal) => {
      const documentId = String(task.payload.documentId),
        conversationId = String(task.payload.conversationId);
      const doc = await tenant(service.db, task.accountId!, async (trx) => {
        await documentChat(trx, conversationId);
        return trx<DocumentRow>("conversation_documents")
          .where({ id: documentId, conversationId, status: "pending" })
          .whereNull("removedAt")
          .where("expiresAt", ">", trx.fn.now())
          .first();
      });
      if (!doc) throw new TaskError("document_unavailable", false);
      let result: DocumentExtraction | undefined, error: string | undefined;
      try {
        result = await extract(doc.staging!, doc.filename, signal);
      } catch (failure) {
        signal.throwIfAborted();
        error =
          failure instanceof GroveError ? failure.code : "document_unreadable";
      }
      await taskTransaction(service.db, task, async (trx) => {
        signal.throwIfAborted();
        await documentChat(trx, conversationId);
        if (
          !(await trx("conversation_documents")
            .where({ id: documentId, status: "pending" })
            .whereNull("removedAt")
            .where("expiresAt", ">", trx.fn.now())
            .first())
        )
          throw new TaskError("document_unavailable", false);
        if (result) {
          await trx("conversation_document_chunks").insert(
            result.segments.map((p, ordinal) => ({
              accountId: task.accountId,
              documentId,
              id: randomUUID(),
              ordinal,
              content: p.content,
              pageStart: p.pageStart,
              pageEnd: p.pageEnd,
              sourceStart: p.start,
              sourceEnd: p.end,
            })),
          );
          await trx("conversation_documents")
            .where({ id: documentId })
            .update({
              status: "ready",
              mime: result.mime,
              pages: result.pages.length,
              emptyPages: JSON.stringify(result.emptyPages),
            });
        } else
          await trx("conversation_documents")
            .where({ id: documentId })
            .update({ status: "failed", staging: null, error });
        return { complete: true, processed: 1 };
      });
    },
  };
}
