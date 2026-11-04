import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createGenerationProvider } from "@lib/ai";
import { generationConfigSchema } from "@lib/shared/models";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createDatabase, tenant, type Knex } from "@lib/database";
import { MemoryService, sessionPrincipal, runTask } from "@lib/memory";
import {
  conversationTurnSchema,
  conversationPlanSchema,
} from "@lib/shared/conversations";
import { localMedia } from "../../packages/api/src/media-store.ts";
import { extractDocument } from "../../packages/api/src/document-extraction.ts";
import { createApp } from "../../packages/api/src/app.ts";
import {
  DocumentImports,
  cleanupHandlers,
  scheduleCleanup,
  Tasks,
  exportHandlers,
} from "@lib/memory";
import { localArtifacts } from "../../packages/api/src/artifacts.ts";
import { configureBillingQuotas } from "../../lib/memory/src/billing-quotas.ts";

import * as documents from "../../lib/memory/src/conversation-documents.ts";
const url = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(url && new URL(url).pathname.endsWith("_test"));
const authority = createDatabase(url),
  name = `grove_chat_docs_${randomUUID().replaceAll("-", "")}_test`;
let owner: Knex, api: Knex, worker: Knex, directory: string;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = (source: string) => {
    const u = new URL(source);
    u.pathname = `/${name}`;
    return u.href;
  };
  owner = createDatabase(target(url));
  await owner.migrate.latest();
  api = createDatabase(target(process.env.TEST_DATABASE_URL!));
  worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  await mkdir("/tmp/opencode", { recursive: true });
  directory = await mkdtemp("/tmp/opencode/chat-docs-");
});
after(async () => {
  await Promise.all([owner?.destroy(), api?.destroy(), worker?.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
  await authority.destroy();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  assert.equal(
    typeof documents.ConversationDocuments,
    "function",
    "chat document service is missing",
  );
  const subject = `docs_${randomUUID()}`,
    account = (await api.raw("SELECT * FROM grove_account(?)", [subject]))
      .rows[0];
  const principal = sessionPrincipal(account.id, subject),
    service = new MemoryService(api, "test-secret".repeat(4));
  const store = localMedia(directory);
  await store.ready();
  const docs = new documents.ConversationDocuments(service),
    chat = await service.conversations.create(principal, {
      id: randomUUID(),
      includePersonal: false,
    });
  const drain = async (id: string) => {
    for (let i = 0; i < 20; i++) {
      const task = await owner("background_tasks").where({ id }).first();
      if (["succeeded", "failed", "cancelled"].includes(task.status))
        return task;
      await runTask(
        worker,
        documents.conversationDocumentHandlers(
          new MemoryService(worker, "test-secret".repeat(4)),
          extractDocument,
        ),
        { id },
      );
    }
    throw new Error("unfinished task");
  };
  return { principal, service, store, docs, chat, drain };
}
test("upload/extraction stays chat-only and explicit acceptance retains private originals", async () => {
  const f = await fixture(),
    id = randomUUID(),
    bytes = Buffer.from("# Botany\n\nOak seedlings need damp mulch.");
  const upload = await f.docs.upload(
    f.principal,
    f.chat.id,
    id,
    "botany.md",
    bytes,
  );
  assert.equal((await f.drain(upload.taskId)).status, "succeeded");
  let list = await f.docs.list(f.principal, f.chat.id);
  assert.equal(list.documents[0].status, "ready");
  assert.equal(list.documents[0].accepted, false);
  assert.equal((await owner("memories")).length, 0);
  assert.equal((await owner("projects")).length, 0);
  await assert.rejects(f.docs.original(f.principal, f.chat.id, id));
  await f.docs.accept(
    f.principal,
    f.chat.id,
    { expectedVersion: list.version },
    f.store,
    new AbortController().signal,
  );
  list = await f.docs.list(f.principal, f.chat.id);
  assert.equal(list.documents[0].accepted, true);
  const original = await f.docs.original(f.principal, f.chat.id, id),
    chunks = [];
  for await (const chunk of await f.store.read(
    original.key,
    new AbortController().signal,
  ))
    chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), bytes);
  const other = await fixture();
  await assert.rejects(other.docs.list(other.principal, f.chat.id));
  assert.equal(
    (
      await tenant(api, other.principal.accountId, (trx) =>
        trx("conversation_documents").where({ id }),
      )
    ).length,
    0,
  );
  await assert.rejects(
    f.docs.list(
      { ...f.principal, type: "oauth", connectionId: randomUUID() },
      f.chat.id,
    ),
  );
});
test("answers cite chat passages, retain follow-ups, and removal masks old evidence", async () => {
  const f = await fixture(),
    id = randomUUID(),
    upload = await f.docs.upload(
      f.principal,
      f.chat.id,
      id,
      "botany.txt",
      Buffer.from("Oak seedlings need damp mulch."),
    );
  await f.drain(upload.taskId);
  let list = await f.docs.list(f.principal, f.chat.id);
  await f.docs.accept(
    f.principal,
    f.chat.id,
    { expectedVersion: list.version },
    f.store,
    new AbortController().signal,
  );
  list = await f.docs.list(f.principal, f.chat.id);
  let calls = 0;
  f.service.providers.generation = {
    profile: "document-test",
    generate: async (schema, _instructions, _sources, options) => {
      if (Object.is(schema, conversationPlanSchema))
        return schema.parse({
          query: "oak mulch",
          intent: "answer",
          references: [],
          research: [],
          organizeAfter: null,
        });
      const evidence = options?.context?.documents;
      assert(evidence?.sources.length);
      calls++;
      const source = evidence.sources[0];
      return schema.parse({
        message: "",
        statements: [],
        webStatements: [],
        proposals: [],
        documentStatements: [
          {
            text: "The seedlings need damp mulch.",
            sources: [
              { id: source.id, version: source.version, quote: "damp mulch" },
            ],
          },
        ],
      });
    },
  };
  const chat = await f.service.conversations.turn(
    f.principal,
    f.chat.id,
    conversationTurnSchema.parse({
      id: randomUUID(),
      expectedVersion: 0,
      query: "What do the seedlings need?",
      documentsVersion: list.version,
    }),
  );
  assert.equal(chat.turns[0].result!.documentSources?.[0].documentId, id);
  await f.service.conversations.turn(
    f.principal,
    f.chat.id,
    conversationTurnSchema.parse({
      id: randomUUID(),
      expectedVersion: 1,
      query: "What about mulch?",
      documentsVersion: list.version,
    }),
  );
  assert.equal(calls, 2);
  await f.docs.remove(f.principal, f.chat.id, id);
  const reopened = await f.service.conversations.get(f.principal, f.chat.id);
  assert.equal(reopened.turns[0].result!.documentStatements?.length, 0);
  await assert.rejects(f.docs.original(f.principal, f.chat.id, id));
});

async function readyDocument(accept = true) {
  const f = await fixture(),
    id = randomUUID();
  const upload = await f.docs.upload(
    f.principal,
    f.chat.id,
    id,
    "oak.txt",
    Buffer.from("Oak roots need damp mulch."),
  );
  await f.drain(upload.taskId);
  const list = await f.docs.list(f.principal, f.chat.id);
  if (accept)
    await f.docs.accept(
      f.principal,
      f.chat.id,
      { expectedVersion: list.version },
      f.store,
      new AbortController().signal,
    );
  return { ...f, id, upload, list };
}

async function selectedDocumentIntegration() {
  const f = await readyDocument();
  const note = randomUUID();
  await owner("memories").insert({
    id: note,
    accountId: f.principal.accountId,
    kind: "fact",
    content: "Selected astronomy note",
    source: {},
  });
  const list = await f.docs.list(f.principal, f.chat.id);
  let strict = true;
  configureBillingQuotas(api, { enabled: async () => true, priceIds: [] });
  f.service.providers.generation = {
    profile: "document-context-integration",
    generate: async (schema, _instructions, sources, options) => {
      if (strict) {
        assert.equal(
          options?.context?.documents,
          undefined,
          "strict source selection must not transmit attachment evidence to either provider phase",
        );
        assert.deepEqual(options?.context?.conversation, []);
      } else assert(options?.context?.documents?.sources.length);
      if (Object.is(schema, conversationPlanSchema))
        return schema.parse({
          query: "astronomy",
          intent: "answer",
          references: [],
          research: [],
          organizeAfter: null,
        });
      assert(sources.some((source) => source.id === note));
      const document = options?.context?.documents?.sources[0];
      return schema.parse({
        message: "",
        statements: [
          {
            text: "Selected astronomy note",
            sources: [{ id: note, version: 1 }],
          },
        ],
        webStatements: [],
        proposals: [],
        documentStatements: document
          ? [
              {
                text: "Oak roots need damp mulch.",
                sources: [
                  {
                    id: document.id,
                    version: document.version,
                    quote: "damp mulch",
                  },
                ],
              },
            ]
          : [],
      });
    },
  };
  try {
    for (const [position, only] of [true, false].entries()) {
      strict = only;
      const input = conversationTurnSchema.parse({
        id: randomUUID(),
        query: "Explain astronomy",
        expectedVersion: position,
        documentsVersion: list.version,
        context: { notes: [note], notebooks: [], only },
      });
      const result = await f.service.conversations.turn(
        f.principal,
        f.chat.id,
        input,
      );
      assert.equal(
        result.turns[position].result?.documentSources?.length ?? 0,
        only ? 0 : 1,
      );
      await f.service.conversations.turn(f.principal, f.chat.id, input);
    }
    const usage = await owner("action_usage").where({
      accountId: f.principal.accountId,
      metric: "ask",
    });
    assert.equal(usage.length, 2, "replay does not charge Ask twice");
    assert(usage.every((row) => row.status === "completed"));
  } finally {
    configureBillingQuotas(api, { enabled: async () => false, priceIds: [] });
  }
}

test("turns cannot silently omit unaccepted files and unaccepted removal clears extracted text", async () => {
  const f = await readyDocument(false);
  await assert.rejects(
    f.service.conversations.turn(
      f.principal,
      f.chat.id,
      conversationTurnSchema.parse({
        id: randomUUID(),
        expectedVersion: 0,
        query: "Explain this document",
        documentsVersion: f.list.version,
      }),
    ),
    /attach|ready|accept/i,
  );
  await f.docs.remove(f.principal, f.chat.id, f.id);
  assert.equal(
    (
      await owner("conversation_document_chunks")
        .where({ documentId: f.id })
        .first()
    ).content,
    "[Upload unavailable]",
  );
});

test("accepted chunk insertion and provenance identity replacement are refused", async () => {
  const f = await readyDocument();
  const chunk = await owner("conversation_document_chunks")
    .where({ documentId: f.id })
    .first();
  await assert.rejects(
    tenant(api, f.principal.accountId, (trx) =>
      trx("conversation_document_chunks").insert({
        accountId: f.principal.accountId,
        documentId: f.id,
        id: randomUUID(),
        ordinal: 999,
        content: "Invented evidence",
        pageStart: 1,
        pageEnd: 1,
        sourceStart: 0,
        sourceEnd: 17,
      }),
    ),
    /immutable/,
  );
  await assert.rejects(
    tenant(api, f.principal.accountId, (trx) =>
      trx("conversation_document_chunks")
        .where({ id: chunk.id })
        .update({ id: randomUUID() }),
    ),
    /immutable/,
  );
});

test("failed extraction tasks can retry but removed uploads cannot resume", async () => {
  const f = await fixture(),
    id = randomUUID(),
    u = await f.docs.upload(
      f.principal,
      f.chat.id,
      id,
      "oak.txt",
      Buffer.from("Oak roots"),
    );
  await owner("background_tasks")
    .where({ id: u.taskId })
    .update({ status: "failed", errorCode: "worker_unavailable" });
  assert.equal(
    (await f.docs.list(f.principal, f.chat.id)).documents[0].retryable,
    true,
  );
  const tasks = new Tasks(f.service, true);
  assert.equal(
    (await tasks.action(f.principal, u.taskId, "retry")).status,
    "pending",
  );
  await f.drain(u.taskId);
  assert.equal(
    (await f.docs.list(f.principal, f.chat.id)).documents[0].status,
    "ready",
  );
  await f.docs.remove(f.principal, f.chat.id, id);
  await assert.rejects(tasks.action(f.principal, u.taskId, "retry"));
});

test("Ask disable/re-enable during a document answer fences publication", async () => {
  const f = await readyDocument();
  f.service.providers.generation = {
    profile: "held-document",
    generate: async (schema, _i, _s, o) => {
      if (Object.is(schema, conversationPlanSchema))
        return schema.parse({
          query: "oak",
          intent: "answer",
          references: [],
          research: [],
          organizeAfter: null,
        });
      await f.service.settings(f.principal, { askEnabled: false });
      await f.service.settings(f.principal, { askEnabled: true });
      const source = o!.context!.documents!.sources[0];
      return schema.parse({
        message: "",
        statements: [],
        proposals: [],
        documentStatements: [
          {
            text: "Damp mulch",
            sources: [{ id: source.id, version: 1, quote: "damp mulch" }],
          },
        ],
      });
    },
  };
  await assert.rejects(
    f.service.conversations.turn(
      f.principal,
      f.chat.id,
      conversationTurnSchema.parse({
        id: randomUUID(),
        expectedVersion: 0,
        query: "Explain",
        documentsVersion: f.list.version,
      }),
    ),
  );
});

test("ready direct imports hand off to a separate chat without browser re-upload or library writes", async () => {
  const f = await fixture(),
    imports = new DocumentImports(f.service),
    batchId = randomUUID();
  await imports.create(f.principal, { id: batchId });
  const text = "Oak roots need damp mulch.";
  await imports.upload(
    f.principal,
    batchId,
    randomUUID(),
    "oak.txt",
    Buffer.from(text),
  );
  const task = await imports.prepare(f.principal, batchId, randomUUID());
  const { documentImportHandlers } = await import("@lib/memory");
  await runTask(
    worker,
    documentImportHandlers(
      new MemoryService(worker, "test-secret".repeat(4)),
      extractDocument,
      f.store,
    ),
    { id: task.taskId },
  );
  const batch = await imports.get(f.principal, batchId),
    input = { id: randomUUID(), expectedVersion: batch.version };
  assert.equal(typeof f.docs.fromImport, "function");
  const chat = await f.docs.fromImport(f.principal, batchId, input);
  assert.equal(chat.id, input.id);
  assert.deepEqual(await f.docs.fromImport(f.principal, batchId, input), chat);
  assert.equal(chat.documents?.length, 1);
  assert.equal(chat.documents?.[0].accepted, false);
  assert.equal(chat.documents![0].status, "pending");
  await f.drain(chat.documents![0].taskId);
  assert.equal(
    (
      await owner("conversation_document_chunks")
        .where({ documentId: chat.documents![0].id })
        .first()
    ).content,
    text,
  );
  assert.equal(
    (await owner("memories").where({ accountId: f.principal.accountId }))
      .length,
    0,
  );
});
test("full-text conversion creates reviewed import drafts without duplicate originals or notes", async () => {
  const f = await fixture(),
    id = randomUUID(),
    u = await f.docs.upload(
      f.principal,
      f.chat.id,
      id,
      "notes.txt",
      Buffer.from("Long source paragraph.\n\n".repeat(400)),
    );
  await f.drain(u.taskId);
  let list = await f.docs.list(f.principal, f.chat.id);
  await f.docs.accept(
    f.principal,
    f.chat.id,
    { expectedVersion: list.version },
    f.store,
    new AbortController().signal,
  );
  list = await f.docs.list(f.principal, f.chat.id);
  const input = { id: randomUUID(), expectedVersion: list.version };
  const draft = await f.docs.import(f.principal, f.chat.id, input);
  assert.deepEqual(await f.docs.import(f.principal, f.chat.id, input), draft);
  const batch = await owner("document_import_batches")
    .where({ id: draft.id })
    .first();
  assert.equal(batch.status, "ready");
  const notes = await owner("document_import_notes").where({
    batchId: draft.id,
  });
  assert(notes.length > 1);
  assert.equal((await owner("memories")).length, 0);
  assert.equal(
    (await owner("document_import_files").where({ batchId: draft.id }).first())
      .originalReady,
    true,
  );
});

test("HTTP document uploads enforce checksum and return chat-scoped private downloads", async () => {
  const f = await fixture(),
    id = randomUUID(),
    bytes = Buffer.from("Private tree notes");
  const app = createApp({
    memories: f.service,
    media: f.store,
    auth: { principal: async () => f.principal },
    origin: "https://api.example.test",
    siteUrl: "https://example.test",
    issuer: "https://clerk.example.test",
    webhookSecret: "test",
    ready: async () => {},
  });
  const response = await app.request(
    `/v1/conversations/${f.chat.id}/documents/${id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Grove-Filename": "notes.txt",
        "X-Grove-Content-Sha256": "0".repeat(64),
        "Content-Length": String(bytes.length),
      },
      body: bytes,
    },
  );
  assert.equal(response.status, 400);
  const u = await f.docs.upload(f.principal, f.chat.id, id, "notes.txt", bytes);
  await f.drain(u.taskId);
  const list = await f.docs.list(f.principal, f.chat.id);
  const accepted = await app.request(
    `/v1/conversations/${f.chat.id}/documents/accept`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: list.version }),
    },
  );
  assert.equal(accepted.status, 200);
  const original = await app.request(
    `/v1/conversations/${f.chat.id}/documents/${id}/original`,
  );
  assert.equal(original.status, 200);
  assert.match(original.headers.get("content-disposition")!, /^attachment/);
  await original.arrayBuffer();
});

test("a document-grounded notebook preview saves only on Apply with durable source bindings", async () => {
  const f = await fixture(),
    id = randomUUID(),
    u = await f.docs.upload(
      f.principal,
      f.chat.id,
      id,
      "tree.txt",
      Buffer.from("Oak roots need damp mulch."),
    );
  await f.drain(u.taskId);
  const list = await f.docs.list(f.principal, f.chat.id);
  await f.docs.accept(
    f.principal,
    f.chat.id,
    { expectedVersion: list.version },
    f.store,
    new AbortController().signal,
  );
  f.service.providers.generation = {
    profile: "document-save",
    generate: async (schema, _i, _s, o) => {
      if (Object.is(schema, conversationPlanSchema))
        return schema.parse({
          query: "oak",
          intent: "organize",
          references: [],
          research: [],
          organizeAfter: null,
        });
      const source = o!.context!.documents!.sources[0];
      return schema.parse({
        message: "",
        statements: [],
        proposals: [],
        organization: [
          {
            notebooks: [{ key: "trees", name: "Trees", parent: null }],
            renames: [],
            moves: [],
            notes: [
              {
                content: "# Oak care\n\nKeep roots in damp mulch.",
                destination: "new:trees",
              },
            ],
          },
        ],
        documentStatements: [
          {
            text: "Oak roots need damp mulch.",
            sources: [
              {
                id: source.id,
                version: 1,
                quote: "Oak roots need damp mulch.",
              },
            ],
          },
        ],
      });
    },
  };
  const chat = await f.service.conversations.turn(
    f.principal,
    f.chat.id,
    conversationTurnSchema.parse({
      id: randomUUID(),
      expectedVersion: 0,
      query: "Create a Trees notebook from this document",
      documentsVersion: list.version,
    }),
  );
  assert.equal((await owner("memories")).length, 0);
  await f.service.conversations.apply(f.principal, f.chat.id, chat.turns[0].id);
  assert(
    await owner.schema.hasTable("conversation_document_bindings"),
    "document provenance bindings are missing",
  );
  const binding = await owner("conversation_document_bindings").first();
  assert.equal(binding.documentId, id);
  assert(binding.memoryId);
  await f.service.conversations.apply(f.principal, f.chat.id, chat.turns[0].id);
  assert.equal((await owner("memories")).length, 1);
  await f.service.conversations.remove(f.principal, f.chat.id);
  assert.equal(typeof f.docs.noteOriginal, "function");
  const original = await f.docs.noteOriginal(f.principal, binding.memoryId, id);
  assert(original.key);
  const sources = await f.docs.noteSources(f.principal, binding.memoryId);
  assert.equal(sources[0].id, id);
  const app = createApp({
    memories: f.service,
    media: f.store,
    auth: { principal: async () => f.principal },
    origin: "https://api.example.test",
    siteUrl: "https://example.test",
    issuer: "https://clerk.example.test",
    webhookSecret: "test",
    ready: async () => {},
  });
  const download = await app.request(
    `/v1/memories/${binding.memoryId}/document-sources/${id}/original`,
  );
  assert.equal(download.status, 200);
  await download.arrayBuffer();
});

test("invalid document chunk IDs, versions and quotations fail closed", async () => {
  for (const invalid of ["id", "version", "quote"]) {
    const f = await readyDocument();
    let broken = true;
    f.service.providers.generation = {
      profile: `invalid-${invalid}`,
      generate: async (schema, _i, _s, o) => {
        if (Object.is(schema, conversationPlanSchema))
          return schema.parse({
            query: "oak",
            intent: "answer",
            references: [],
            research: [],
            organizeAfter: null,
          });
        const source = o!.context!.documents!.sources[0];
        return schema.parse({
          message: "",
          statements: [],
          proposals: [],
          documentStatements: [
            {
              text: "Damp mulch",
              sources: [
                {
                  id: broken && invalid === "id" ? randomUUID() : source.id,
                  version: broken && invalid === "version" ? 2 : 1,
                  quote:
                    broken && invalid === "quote"
                      ? "Invented text"
                      : "damp mulch",
                },
              ],
            },
          ],
        });
      },
    };
    const input = conversationTurnSchema.parse({
      id: randomUUID(),
      expectedVersion: 0,
      query: "Explain",
      documentsVersion: f.list.version,
    });
    await assert.rejects(
      f.service.conversations.turn(f.principal, f.chat.id, input),
    );
    assert.equal(
      (await f.service.conversations.get(f.principal, f.chat.id)).turns[0]
        .result,
      null,
    );
    broken = false;
    const recovered = await f.service.conversations.turn(
      f.principal,
      f.chat.id,
      input,
    );
    assert.equal(
      recovered.turns[0].result?.documentStatements?.length,
      1,
      "invalid document evidence must not poison the retry cache",
    );
  }
});

test("a document preview cannot Apply after its generation profile changes", async () => {
  const f = await readyDocument();
  const generate: NonNullable<
    typeof f.service.providers.generation
  >["generate"] = async (schema, _i, _s, o) => {
    if (Object.is(schema, conversationPlanSchema))
      return schema.parse({
        query: "oak",
        intent: "create",
        references: [],
        research: [],
        organizeAfter: null,
      });
    const source = o!.context!.documents!.sources[0];
    return schema.parse({
      message: "",
      statements: [],
      proposals: [
        {
          kind: "create",
          target: [],
          sources: [],
          content: "# Oak care\n\nUse damp mulch.",
        },
      ],
      documentStatements: [
        {
          text: "Use damp mulch.",
          sources: [{ id: source.id, version: 1, quote: "damp mulch" }],
        },
      ],
    });
  };
  f.service.providers.generation = {
    profile: "original-document-profile",
    generate,
  };
  const chat = await f.service.conversations.turn(
    f.principal,
    f.chat.id,
    conversationTurnSchema.parse({
      id: randomUUID(),
      expectedVersion: 0,
      query: "Create a note about oak care",
      documentsVersion: f.list.version,
    }),
  );
  f.service.providers.generation = {
    profile: "replacement-document-profile",
    generate,
  };
  await assert.rejects(
    f.service.conversations.apply(f.principal, f.chat.id, chat.turns[0].id),
  );
  assert.equal(
    (await owner("memories").where({ accountId: f.principal.accountId }))
      .length,
    0,
  );
});

test("uncited document prose is never published as a factual answer", async () => {
  const f = await readyDocument();
  f.service.providers.generation = {
    profile: "uncited-document",
    generate: async (schema) =>
      Object.is(schema, conversationPlanSchema)
        ? schema.parse({
            query: "oak",
            intent: "answer",
            references: [],
            research: [],
            organizeAfter: null,
          })
        : schema.parse({
            message: "Invented unverified document fact",
            statements: [],
            proposals: [],
          }),
  };
  const chat = await f.service.conversations.turn(
    f.principal,
    f.chat.id,
    conversationTurnSchema.parse({
      id: randomUUID(),
      expectedVersion: 0,
      query: "Explain",
      documentsVersion: f.list.version,
    }),
  );
  assert.doesNotMatch(chat.turns[0].result!.message, /Invented/);
});

test("concurrent accepts and upload replays reserve only one accepted original", async () => {
  const f = await readyDocument(false);
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve)),
    started = new Promise<void>((resolve) => (entered = resolve));
  const first = f.docs.accept(
    f.principal,
    f.chat.id,
    { expectedVersion: f.list.version },
    {
      read: f.store.read,
      writeDocument: async (...args) => {
        entered();
        await held;
        await f.store.writeDocument!(...args);
      },
    },
    new AbortController().signal,
  );
  await started;
  try {
    await assert.rejects(
      f.docs.accept(
        f.principal,
        f.chat.id,
        { expectedVersion: f.list.version },
        f.store,
        new AbortController().signal,
      ),
      /attached|busy/i,
    );
  } finally {
    release();
  }
  await first;
  assert.equal(
    (await owner("conversation_document_attempts").where({ documentId: f.id }))
      .length,
    1,
  );
  assert.deepEqual(
    await f.docs.upload(
      f.principal,
      f.chat.id,
      f.id,
      "oak.txt",
      Buffer.from("Oak roots need damp mulch."),
    ),
    { id: f.id, taskId: f.upload.taskId },
  );
  await assert.rejects(
    f.docs.upload(
      f.principal,
      f.chat.id,
      f.id,
      "oak.txt",
      Buffer.from("Different"),
    ),
  );
});

test("removal during planning stops document evidence before answer dispatch", async () => {
  const f = await readyDocument();
  let answers = 0;
  f.service.providers.generation = {
    profile: "removed-before-dispatch",
    generate: async (schema) => {
      if (Object.is(schema, conversationPlanSchema)) {
        await f.docs.remove(f.principal, f.chat.id, f.id);
        return schema.parse({
          query: "oak",
          intent: "answer",
          references: [],
          research: [],
          organizeAfter: null,
        });
      }
      answers++;
      return schema.parse({ message: "", statements: [], proposals: [] });
    },
  };
  await assert.rejects(
    f.service.conversations.turn(
      f.principal,
      f.chat.id,
      conversationTurnSchema.parse({
        id: randomUUID(),
        expectedVersion: 0,
        query: "Explain",
        documentsVersion: f.list.version,
      }),
    ),
  );
  assert.equal(answers, 0);
});

test("expiry during original storage cannot accept or replay an expired upload", async () => {
  const f = await readyDocument(false);
  await assert.rejects(
    f.docs.accept(
      f.principal,
      f.chat.id,
      { expectedVersion: f.list.version },
      {
        read: f.store.read,
        writeDocument: async (...args) => {
          await f.store.writeDocument!(...args);
          await owner("conversation_documents")
            .where({ id: f.id })
            .update({ expiresAt: owner.raw("now()-interval '1 second'") });
        },
      },
      new AbortController().signal,
    ),
  );
  assert.equal(
    (await owner("conversation_documents").where({ id: f.id }).first())
      .accepted,
    false,
  );
  await assert.rejects(
    f.docs.upload(
      f.principal,
      f.chat.id,
      f.id,
      "oak.txt",
      Buffer.from("Oak roots need damp mulch."),
    ),
  );
});

test("expired upload cleanup runs without activity and account deletion clears unaccepted bytes", async () => {
  const f = await fixture(),
    id = randomUUID();
  await f.docs.upload(
    f.principal,
    f.chat.id,
    id,
    "draft.txt",
    Buffer.from("Private draft"),
  );
  await owner("conversation_documents")
    .where({ id })
    .update({ expiresAt: owner.raw("now()-interval '1 day'") });
  await owner("rate_buckets")
    .where({ accountId: f.principal.accountId })
    .delete();
  await scheduleCleanup(worker);
  const task = await owner("background_tasks")
    .where({ accountId: f.principal.accountId, kind: "retention_cleanup" })
    .first();
  assert(task, "expired chat documents must schedule cleanup");
  await runTask(
    worker,
    cleanupHandlers(worker, async () => {}),
    { id: task.id },
  );
  assert.equal(
    (await owner("conversation_documents").where({ id }).first()).staging,
    null,
  );
  const next = randomUUID();
  await f.docs.upload(
    f.principal,
    f.chat.id,
    next,
    "unsent.txt",
    Buffer.from("Unsent private draft"),
  );
  await f.service.deleteAccount(f.principal);
  assert.equal(
    (await owner("conversation_documents").where({ id: next }).first()).staging,
    null,
  );
});

test("removing a source during generation fences output and document queries cannot invoke research", async () => {
  const f = await fixture(),
    id = randomUUID(),
    u = await f.docs.upload(
      f.principal,
      f.chat.id,
      id,
      "tree.txt",
      Buffer.from("Oak roots need damp mulch."),
    );
  await f.drain(u.taskId);
  const list = await f.docs.list(f.principal, f.chat.id);
  await f.docs.accept(
    f.principal,
    f.chat.id,
    { expectedVersion: list.version },
    f.store,
    new AbortController().signal,
  );
  let calls = 0;
  f.service.research.exa = {
    search: async () => {
      calls++;
      return [];
    },
    extract: async () => {
      calls++;
      return [];
    },
  };
  f.service.providers.generation = {
    profile: "held-doc",
    generate: async (schema, _i, _s, o) => {
      if (Object.is(schema, conversationPlanSchema))
        return schema.parse({
          query: "oak",
          intent: "answer",
          references: [],
          research: [{ provider: "exa", query: "private document", urls: [] }],
          organizeAfter: null,
        });
      const source = o!.context!.documents!.sources[0];
      await f.docs.remove(f.principal, f.chat.id, id);
      return schema.parse({
        message: "",
        statements: [],
        proposals: [],
        documentStatements: [
          {
            text: "Damp mulch.",
            sources: [{ id: source.id, version: 1, quote: "damp mulch" }],
          },
        ],
      });
    },
  };
  await assert.rejects(
    f.service.conversations.turn(
      f.principal,
      f.chat.id,
      conversationTurnSchema.parse({
        id: randomUUID(),
        expectedVersion: 0,
        query: "What does this say?",
        documentsVersion: list.version,
      }),
    ),
  );
  assert.equal(calls, 0);
  assert.equal(
    (await f.service.conversations.get(f.principal, f.chat.id)).turns[0].result,
    null,
  );
});

test("accepted source chunks are immutable and unaccepted documents cannot be imported", async () => {
  const f = await fixture(),
    id = randomUUID(),
    u = await f.docs.upload(
      f.principal,
      f.chat.id,
      id,
      "tree.txt",
      Buffer.from("Oak roots need damp mulch."),
    );
  await f.drain(u.taskId);
  const list = await f.docs.list(f.principal, f.chat.id);
  await assert.rejects(
    f.docs.import(f.principal, f.chat.id, {
      id: randomUUID(),
      expectedVersion: list.version,
    }),
  );
  await f.docs.accept(
    f.principal,
    f.chat.id,
    { expectedVersion: list.version },
    f.store,
    new AbortController().signal,
  );
  await assert.rejects(
    tenant(api, f.principal.accountId, (trx) =>
      trx("conversation_document_chunks")
        .where({ documentId: id })
        .update({ content: "Replaced" }),
    ),
    /immutable/,
  );
  const before = await owner("accounts")
    .where({ id: f.principal.accountId })
    .first();
  await f.docs.accept(
    f.principal,
    f.chat.id,
    { expectedVersion: list.version },
    f.store,
    new AbortController().signal,
  );
  const after = await owner("accounts")
    .where({ id: f.principal.accountId })
    .first();
  assert.equal(after.mediaAttempts, before.mediaAttempts);
});

test("account exports include accepted chat-only sources and exact original bytes", async () => {
  const f = await fixture(),
    id = randomUUID(),
    bytes = Buffer.from("Private oak document"),
    u = await f.docs.upload(f.principal, f.chat.id, id, "tree.txt", bytes);
  await f.drain(u.taskId);
  const list = await f.docs.list(f.principal, f.chat.id);
  await f.docs.accept(
    f.principal,
    f.chat.id,
    { expectedVersion: list.version },
    f.store,
    new AbortController().signal,
  );
  const artifacts = localArtifacts(`${directory}/exports`);
  await artifacts.ready!();
  const tasks = new Tasks(f.service, true),
    job = await tasks.export(f.principal, {
      id: randomUUID(),
      includeMedia: true,
      includeDescendants: false,
    }),
    handlers = exportHandlers(worker, artifacts, f.store);
  for (let i = 0; i < 100; i++) {
    if ((await tasks.get(f.principal, job.id)).status === "succeeded") break;
    await runTask(worker, handlers, { id: job.id });
  }
  const artifact = await tasks.artifact(f.principal, job.id),
    chunks = [];
  for await (const chunk of await artifacts.read(artifact.key))
    chunks.push(chunk);
  const records = Buffer.concat(chunks)
    .toString()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert(
    records.some((row) => row.type === "chat_document" && row.id === id),
    "accepted chat source metadata must be exported",
  );
  const pieces = records
    .filter((row) => row.type === "chat_document_chunk" && row.id === id)
    .sort((a, b) => a.offset - b.offset);
  assert.deepEqual(
    Buffer.concat(pieces.map((row) => Buffer.from(row.data, "base64"))),
    bytes,
  );
});

test("real generation transport serializes bounded private evidence without storage keys", async () => {
  const f = await readyDocument();
  let calls = 0;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()),
      context = JSON.parse(body.messages[1].content);
    assert.equal(
      context.documents.sources[0].content,
      "Oak roots need damp mulch.",
    );
    assert.doesNotMatch(JSON.stringify(context), /objectKey|staging|media\//);
    assert(context.documents.sources.length <= 12);
    assert(
      context.documents.sources.reduce(
        (n: number, s: { content: string }) => n + s.content.length,
        0,
      ) <= 24000,
    );
    const planning = body.tools[0].function.parameters.properties.intent,
      source = context.documents.sources[0];
    calls++;
    const output = planning
      ? {
          query: "oak",
          intent: "answer",
          references: [],
          research: [],
          organizeAfter: null,
        }
      : {
          message: "",
          statements: [],
          proposals: [],
          documentStatements: [
            {
              text: "Roots need damp mulch.",
              sources: [
                { id: source.id, version: source.version, quote: "damp mulch" },
              ],
            },
          ],
        };
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                {
                  function: {
                    name: "record_result",
                    arguments: JSON.stringify(output),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    f.service.providers.generation = createGenerationProvider(
      generationConfigSchema.parse({
        provider: "minimax",
        model: "MiniMax-M3.1-Flash",
        baseUrl: `http://127.0.0.1:${address.port}`,
      }),
    );
    const chat = await f.service.conversations.turn(
      f.principal,
      f.chat.id,
      conversationTurnSchema.parse({
        id: randomUUID(),
        expectedVersion: 0,
        query: "Explain",
        documentsVersion: f.list.version,
      }),
    );
    assert.equal(calls, 2);
    assert.equal(
      chat.turns[0].result!.documentStatements![0].text,
      "Roots need damp mulch.",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("aggregate staging counts chat bytes when admitting a direct import", async () => {
  const f = await fixture(),
    bytes = Buffer.alloc(3 * 1024 * 1024, 65);
  for (let i = 0; i < 25; i++)
    await f.docs.upload(
      f.principal,
      f.chat.id,
      randomUUID(),
      `file-${i}.txt`,
      bytes,
    );
  const imports = new DocumentImports(f.service),
    id = randomUUID();
  await imports.create(f.principal, { id });
  await assert.rejects(
    imports.upload(
      f.principal,
      id,
      randomUUID(),
      "extra.txt",
      Buffer.from("Extra"),
    ),
    /pending|staging|uploads/i,
  );
});

test("character-capped evidence discloses partial coverage even when every chunk is represented", async () => {
  const f = await fixture(),
    id = randomUUID(),
    u = await f.docs.upload(
      f.principal,
      f.chat.id,
      id,
      "long.txt",
      Buffer.from(("A".repeat(4998) + "\n\n").repeat(5)),
    );
  await f.drain(u.taskId);
  const list = await f.docs.list(f.principal, f.chat.id);
  await f.docs.accept(
    f.principal,
    f.chat.id,
    { expectedVersion: list.version },
    f.store,
    new AbortController().signal,
  );
  const evidence = await tenant(api, f.principal.accountId, (trx) =>
    documents.documentSnapshot(trx, f.chat.id, "A"),
  );
  assert.equal(evidence.shown, evidence.total);
  assert.equal(evidence.partial, true);
  assert(evidence.sources.reduce((n, s) => n + s.content.length, 0) <= 24000);
});

test("account exports cannot recover revoked document passages through raw turn history", async () => {
  const f = await readyDocument();
  f.service.providers.generation = {
    profile: "export-document",
    generate: async (schema, _i, _s, o) => {
      if (Object.is(schema, conversationPlanSchema))
        return schema.parse({
          query: "oak",
          intent: "answer",
          references: [],
          research: [],
          organizeAfter: null,
        });
      const source = o!.context!.documents!.sources[0];
      return schema.parse({
        message: "",
        statements: [],
        proposals: [],
        documentStatements: [
          {
            text: "The source recommends damp mulch.",
            sources: [{ id: source.id, version: 1, quote: "damp mulch" }],
          },
        ],
      });
    },
  };
  await f.service.conversations.turn(
    f.principal,
    f.chat.id,
    conversationTurnSchema.parse({
      id: randomUUID(),
      expectedVersion: 0,
      query: "Explain this source",
      documentsVersion: f.list.version,
    }),
  );
  await f.docs.remove(f.principal, f.chat.id, f.id);
  const artifacts = localArtifacts(`${directory}/revoked-exports`);
  await artifacts.ready!();
  const tasks = new Tasks(f.service, true),
    job = await tasks.export(f.principal, {
      id: randomUUID(),
      includeMedia: true,
      includeDescendants: false,
    }),
    handlers = exportHandlers(worker, artifacts, f.store);
  for (let i = 0; i < 100; i++) {
    if ((await tasks.get(f.principal, job.id)).status === "succeeded") break;
    await runTask(worker, handlers, { id: job.id });
  }
  const artifact = await tasks.artifact(f.principal, job.id),
    chunks = [];
  for await (const chunk of await artifacts.read(artifact.key))
    chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  assert.doesNotMatch(
    raw,
    /Oak roots need damp mulch|The source recommends damp mulch/,
  );
  const turn = raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((row) => row.type === "turn");
  assert.deepEqual(turn.result.documentSources, []);
  assert.deepEqual(turn.result.documentStatements, []);
});

test("accepting an original invalidates an export made before source acceptance", async () => {
  const f = await readyDocument(false),
    artifacts = localArtifacts(`${directory}/accept-exports`);
  await artifacts.ready!();
  const tasks = new Tasks(f.service, true),
    job = await tasks.export(f.principal, {
      id: randomUUID(),
      includeMedia: true,
      includeDescendants: false,
    }),
    handlers = exportHandlers(worker, artifacts, f.store);
  for (let i = 0; i < 100; i++) {
    if ((await tasks.get(f.principal, job.id)).status === "succeeded") break;
    await runTask(worker, handlers, { id: job.id });
  }
  assert(await tasks.artifact(f.principal, job.id));
  await f.docs.accept(
    f.principal,
    f.chat.id,
    { expectedVersion: f.list.version },
    f.store,
    new AbortController().signal,
  );
  await assert.rejects(tasks.artifact(f.principal, job.id), /not available/i);
});

test(
  "strict selected-note turns exclude attachments while ordinary selections retain document evidence and action accounting",
  selectedDocumentIntegration,
);
