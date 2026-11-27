import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createDatabase, tenant } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { rememberSchema } from "@lib/shared/contracts";
import { createApp } from "../../packages/api/src/app.ts";
import { notebookLifecycleSchema } from "@lib/shared/notebook-lifecycle";

const db = createDatabase(process.env.TEST_DATABASE_URL!);
const service = new MemoryService(db, "internal-link-preview-fixture");
after(() => db.destroy());
async function fixture() {
  const subject = `link_preview_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const owner = sessionPrincipal(rows[0].id, subject);
  const notebook = await service.project(owner, {
    name: "Field notebook",
    identity: randomUUID(),
  });
  const note = await service.remember(
    owner,
    rememberSchema.parse({
      operationId: randomUUID(),
      projectId: notebook.id,
      kind: "fact",
      content: "# Original field note\n\nA short readable source excerpt.",
      source: { agent: "website", session: "not-for-preview" },
    }),
  );
  return { owner, note, notebook };
}

test("internal previews return bounded readable metadata without exposing full source or ancestry", async () => {
  const { owner, note, notebook } = await fixture();
  const snapshot = () =>
    tenant(db, owner.accountId, async (trx) => ({
      jobs: await trx("jobs").count("* as count").first(),
      revisions: await trx("memory_revisions").count("* as count").first(),
      content: await trx("memories")
        .where({ id: note.id })
        .first("content", "version"),
    }));
  const before = await snapshot();
  const preview = await service.linkPreview(owner, {
    kind: "note",
    id: note.id,
  });
  assert.equal(preview.title, "Original field note");
  assert(preview.excerpt?.includes("readable source"));
  assert(preview.title.length <= 90);
  assert((preview.excerpt?.length ?? 0) <= 180);
  for (const hidden of [
    "content",
    "source",
    "parentId",
    "projectId",
    "identity",
    "enrichment",
    "relationships",
  ])
    assert(!Object.hasOwn(preview, hidden));
  const book = await service.linkPreview(owner, {
    kind: "notebook",
    id: notebook.id,
  });
  assert.equal(book.title, notebook.name);
  assert.equal(book.excerpt, null);
  assert.deepEqual(
    await snapshot(),
    before,
    "preview reads must not create jobs, content edits or history",
  );
});

test("revision previews read that exact source, never substitute the current note or a missing revision", async () => {
  const { owner, note } = await fixture();
  await service.remember(
    owner,
    rememberSchema.parse({
      id: note.id,
      operationId: randomUUID(),
      expectedVersion: note.version,
      kind: note.kind,
      content: "# Current title\n\nA different current source.",
      source: { agent: "website" },
    }),
  );
  const current = await service.linkPreview(owner, {
    kind: "note",
    id: note.id,
  });
  assert.equal(current.title, "Current title");
  const old = await service.linkPreview(owner, {
    kind: "note",
    id: note.id,
    revision: 1,
  });
  assert.equal(old.title, "Original field note");
  assert.equal(old.version, 1);
  assert(!old.excerpt?.includes("different current"));
  await assert.rejects(
    service.linkPreview(owner, { kind: "note", id: note.id, revision: 900 }),
    { code: "not_found" },
  );
});

test("preview metadata stays within its character bounds for long Unicode titles and excerpts", async () => {
  const { owner, note } = await fixture();
  await service.remember(
    owner,
    rememberSchema.parse({
      id: note.id,
      operationId: randomUUID(),
      expectedVersion: 1,
      kind: note.kind,
      content: `# ${"T".repeat(89)}🌱\n\n${"E".repeat(178)}🌱${"further context ".repeat(30)}`,
      source: { agent: "website" },
    }),
  );
  for (const revision of [undefined, 2]) {
    const value = await service.linkPreview(owner, {
      kind: "note",
      id: note.id,
      revision,
    });
    assert(value.title.length <= 90);
    assert(value.excerpt && value.excerpt.length <= 180);
    assert.doesNotMatch(value.title, /[\uD800-\uDFFF]/u);
    assert.doesNotMatch(value.excerpt, /[\uD800-\uDFFF]/u);
  }
});

test("foreign, inactive, expired and deleted destinations cannot leak preview metadata", async () => {
  const { owner, note, notebook } = await fixture();
  const other = await fixture();
  for (const target of [
    { kind: "note", id: note.id },
    { kind: "notebook", id: notebook.id },
  ] as const)
    await assert.rejects(service.linkPreview(other.owner, target), {
      code: "not_found",
    });
  await service.lifecycle(owner, note.id, "archive", {
    operationId: randomUUID(),
    expectedVersion: 1,
  });
  await assert.rejects(
    service.linkPreview(owner, { kind: "note", id: note.id }),
    { code: "not_found" },
  );
  await tenant(db, other.owner.accountId, (trx) =>
    trx("memories")
      .where({ id: other.note.id })
      .update({
        retentionDays: 1,
        expiresAt: trx.raw("now()-interval '1 second'"),
        purgeAt: trx.raw("now()+interval '60 days'"),
      }),
  );
  await assert.rejects(
    service.linkPreview(other.owner, {
      kind: "note",
      id: other.note.id,
      revision: 1,
    }),
    { code: "not_found" },
  );
  await service.forget(owner, {
    operationId: randomUUID(),
    items: [{ id: note.id, expectedVersion: 2 }],
  });
  await assert.rejects(
    service.linkPreview(owner, { kind: "note", id: note.id, revision: 1 }),
    { code: "not_found" },
  );
});

test("preview HTTP reads are session-only, private and reject ambiguous resource/revision input", async () => {
  const { owner, note, notebook } = await fixture();
  let principal = owner;
  const app = createApp({
    memories: service,
    auth: { principal: async () => principal },
    origin: "https://api.example.test",
    siteUrl: "https://grove.example.test",
    issuer: "https://clerk.example.test",
    webhookSecret: "unused",
    ready: async () => {},
  });
  const path = `/v1/link-previews/note/${note.id}`;
  const response = await app.request(path);
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("cache-control") ?? "",
    /private.*no-store/,
  );
  assert.equal((await response.json()).data.id, note.id);
  for (const invalid of [
    "?revision=0",
    "?revision=1&revision=2",
    "?revision=1e2",
    "?extra=private",
    "?revision=9999999999999999",
  ])
    assert.equal((await app.request(path + invalid)).status, 400, invalid);
  assert.equal(
    (await app.request(`/v1/link-previews/notebook/${notebook.id}?revision=1`))
      .status,
    400,
  );
  principal = { ...owner, type: "key", connectionId: randomUUID() };
  assert.equal((await app.request(path)).status, 403);
  principal = { ...owner, type: "oauth", connectionId: randomUUID() };
  assert.equal((await app.request(path)).status, 403);
});

test("archived and deleted notebook previews cannot disclose names, including through an old revision link", async () => {
  const { owner, notebook, note } = await fixture();
  const change = async (action: "archive" | "delete") => {
    const review = await service.previewProjectLifecycle(owner, notebook.id);
    return service.projectLifecycle(
      owner,
      notebook.id,
      action,
      notebookLifecycleSchema.parse({
        operationId: randomUUID(),
        expectedVersion: review.project.version,
        fingerprint: review.fingerprint,
      }),
    );
  };
  await change("archive");
  await assert.rejects(
    service.linkPreview(owner, { kind: "notebook", id: notebook.id }),
    { code: "not_found" },
  );
  await assert.rejects(
    service.linkPreview(owner, { kind: "note", id: note.id, revision: 1 }),
    { code: "not_found" },
  );
  await change("delete");
  await assert.rejects(
    service.linkPreview(owner, { kind: "notebook", id: notebook.id }),
    { code: "not_found" },
  );
});

test("current and exact-revision previews expose the same serialized expiry boundary", async () => {
  const { owner, note } = await fixture();
  const saved = await service.remember(
    owner,
    rememberSchema.parse({
      id: note.id,
      expectedVersion: 1,
      operationId: randomUUID(),
      kind: note.kind,
      content: note.content,
      retentionDays: 1,
      source: { agent: "website" },
    }),
  );
  const current = await service.linkPreview(owner, {
    kind: "note",
    id: note.id,
  });
  const exact = await service.linkPreview(owner, {
    kind: "note",
    id: note.id,
    revision: 1,
  });
  assert.equal(typeof exact.expiresAt, "string");
  assert.equal(exact.expiresAt, saved.expiresAt);
  assert.equal(current.expiresAt, exact.expiresAt);
});
