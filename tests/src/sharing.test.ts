import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, tenant } from "@lib/database";
import { MemoryService, Sharing, sessionPrincipal } from "@lib/memory";
import {
  GroveError,
  rememberSchema,
  type Principal,
} from "@lib/shared/contracts";
import {
  shareEnableSchema,
  type ShareState,
  type ShareTarget,
} from "@lib/shared/sharing";
import { createApp } from "../../packages/api/src/app.ts";

const url = process.env.TEST_DATABASE_URL;
const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL;
assert(
  url && ownerUrl && new URL(ownerUrl).pathname.endsWith("_test"),
  "Use disposable test databases",
);
const db = createDatabase(url);
const admin = createDatabase(ownerUrl);
const service = new MemoryService(
  db,
  "sharing-test-cursor-secret-at-least-32-characters",
);
const sharing = new Sharing(service, {
  key: "ab".repeat(32),
  siteUrl: "https://grove.example.test",
});
const secret = (state: ShareState) =>
  new URL(state.direct!.url!).pathname.split("/").at(-1)!;
const enable = (target: ShareTarget, version = 1, includeDescendants = false) =>
  sharing.enable(
    alice,
    target,
    shareEnableSchema.parse({
      operationId: randomUUID(),
      expectedVersion: 0,
      expectedTargetVersion: version,
      includeDescendants,
    }),
  );
const notebook = (name: string, parentId?: string) =>
  service.project(alice, { name, identity: randomUUID(), parentId });
let alice: Principal;
let bob: Principal;
before(async () => {
  const account = async () => {
    const subject = `user_sharing_${randomUUID()}`;
    const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
    return sessionPrincipal(rows[0].id, subject);
  };
  alice = await account();
  bob = await account();
});

test("owner-only management keeps tokens encrypted, stable and retry-safe", async () => {
  const note = await save(alice);
  const target = { kind: "note", id: note.id } as const;
  const input = shareEnableSchema.parse({
    operationId: randomUUID(),
    expectedVersion: 0,
    expectedTargetVersion: note.version,
  });
  const [first, retry, concurrent] = await Promise.all([
    sharing.enable(alice, target, input),
    sharing.enable(alice, target, input),
    sharing.enable(alice, target, { ...input, operationId: randomUUID() }),
  ]);
  assert.deepEqual(first, retry);
  assert.deepEqual(first, concurrent);
  assert.deepEqual(await sharing.get(alice, target), first);
  const stored = await admin("public_shares")
    .where({ id: first.direct!.id })
    .first();
  assert(!JSON.stringify(stored).includes(secret(first)));
  assert(
    !JSON.stringify(
      await admin("public_share_operations").where({ shareId: stored.id }),
    ).includes(secret(first)),
  );
  await assert.rejects(sharing.get(bob, target), { code: "not_found" });
  await assert.rejects(sharing.enable(bob, target, input), {
    code: "not_found",
  });
  await assert.rejects(
    sharing.change(bob, stored.id, "revoke", {
      operationId: randomUUID(),
      expectedVersion: 1,
    }),
    { code: "not_found" },
  );
  const grant = await service.grant(
    alice,
    {
      name: "Broad agent",
      capabilities: ["memory:read", "memory:write", "memory:delete"],
      personal: true,
      allProjects: true,
      projectIds: [],
    },
    { key: true },
  );
  for (const type of ["key", "oauth"] as const) {
    const agent: Principal = {
      ...alice,
      type,
      connectionId: grant.connection.id,
      clientId: grant.connection.clientId ?? "agent",
      issuedAt: Date.now(),
    };
    await assert.rejects(sharing.enable(agent, target, input));
  }
  await assert.rejects(
    sharing.enable(alice, target, { ...input, expectedTargetVersion: 99 }),
    { code: "operation_conflict" },
  );
  const replacement = await sharing.change(alice, stored.id, "rotate", {
    operationId: randomUUID(),
    expectedVersion: 1,
  });
  assert.notEqual(secret(first), secret(replacement));
  await assert.rejects(sharing.read(secret(first)), { code: "not_found" });
  await assert.rejects(sharing.enable(alice, target, input), {
    code: "version_conflict",
  });
  const revoke = { operationId: randomUUID(), expectedVersion: 2 };
  const off = await sharing.change(alice, stored.id, "revoke", revoke);
  assert.equal(off.direct!.url, null);
  assert.equal(off.direct!.active, false);
  assert.deepEqual(
    await sharing.change(alice, stored.id, "revoke", revoke),
    off,
  );
  await assert.rejects(sharing.read(secret(replacement)), {
    code: "not_found",
  });
  const on = await sharing.enable(alice, target, {
    ...input,
    operationId: randomUUID(),
    expectedVersion: 3,
  });
  assert.notEqual(secret(on), secret(first));
  assert.equal((await sharing.read(secret(on))).note!.content, note.content);
});

test("public HTTP reads bypass identity services but never authorize private APIs or writes", async () => {
  const note = await save(alice, "# Public HTTP\nRead me.");
  const state = await enable({ kind: "note", id: note.id });
  let identityCalls = 0;
  const app = createApp({
    memories: service,
    shareLinkKey: "ab".repeat(32),
    auth: {
      async principal(request) {
        identityCalls++;
        if (request.headers.get("authorization") === "Bearer owner")
          return alice;
        throw new GroveError("unauthorized", "Sign in", 401);
      },
    },
    origin: "https://api.example.test",
    siteUrl: "https://grove.example.test",
    issuer: "https://clerk.example.test",
    webhookSecret: "unused",
    ready: async () => {},
  });
  const path = `/public/shares/${secret(state)}`;
  const response = await app.request(path);
  assert.equal(response.status, 200);
  assert.equal(identityCalls, 0);
  const body = await response.json();
  assert.equal(body.data.note.content, note.content);
  assert.deepEqual(Object.keys(body.data.note).sort(), [
    "content",
    "id",
    "linkedNoteIds",
    "title",
    "updatedAt",
  ]);
  for (const name of [
    "source",
    "enrichment",
    "accountId",
    "tokenDigest",
    "version",
    "identity",
  ])
    assert(!Object.hasOwn(body.data, name));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("x-robots-tag")!, /noindex/);
  assert.equal(
    (await app.request(path, { method: "PATCH", body: "{}" })).status,
    404,
  );
  assert.equal((await app.request("/public/shares/invalid")).status, 404);
  assert.equal(
    (
      await app.request(`/v1/memories/${note.id}`, {
        headers: { Authorization: `Bearer ${secret(state)}` },
      })
    ).status,
    401,
  );
  assert.equal(
    (await app.request(`/v1/memories/${note.id}/share`)).status,
    401,
  );
  const managed = await app.request(`/v1/memories/${note.id}/share`, {
    headers: { Authorization: "Bearer owner" },
  });
  assert.equal(managed.status, 200);
  assert.equal((await managed.json()).data.direct.url, state.direct!.url);
});

test("notebook permissions follow current membership and expose inherited sharing truthfully", async () => {
  const parent = await notebook("Private ancestor");
  const root = await notebook("Shared root", parent.id);
  const child = await notebook("Child", root.id);
  const outside = await notebook("Private sibling", parent.id);
  const main = await save(alice, "# Main", root.id);
  const nested = await save(alice, "# Nested", child.id);
  const other = await save(alice, "# Other", outside.id);
  const state = await enable({ kind: "notebook", id: root.id });
  const token = secret(state);
  const page = await sharing.read(token);
  assert.deepEqual(
    page.notes.map((n) => n.id),
    [main.id],
  );
  assert.equal(page.notebooks.length, 0);
  assert(!JSON.stringify(page).includes(parent.id));
  await assert.rejects(sharing.read(token, "note", nested.id), {
    code: "not_found",
  });
  const broad = await sharing.change(alice, state.direct!.id, "scope", {
    operationId: randomUUID(),
    expectedVersion: 1,
    includeDescendants: true,
  });
  assert.equal(secret(broad), token);
  assert.deepEqual(
    (await sharing.read(token)).notebooks.map((n) => n.id),
    [child.id],
  );
  assert.equal(
    (await sharing.read(token, "note", nested.id)).note!.content,
    nested.content,
  );
  assert.equal(
    (await sharing.get(alice, { kind: "note", id: nested.id })).inherited[0]!
      .projectId,
    root.id,
  );
  assert.equal(
    (await sharing.get(alice, { kind: "notebook", id: child.id })).inherited[0]!
      .projectId,
    root.id,
  );
  for (const [kind, id] of [
    ["notebook", parent.id],
    ["notebook", outside.id],
    ["note", other.id],
  ] as const) {
    await assert.rejects(sharing.read(token, kind, id), { code: "not_found" });
  }
  const direct = await enable({ kind: "note", id: nested.id });
  const disabled = await sharing.change(alice, direct.direct!.id, "revoke", {
    operationId: randomUUID(),
    expectedVersion: 1,
  });
  assert.equal(disabled.inherited.length, 1);
  await service.project(
    alice,
    {
      name: child.name,
      identity: child.identity,
      parentId: outside.id,
      expectedVersion: child.version,
    },
    child.id,
  );
  await assert.rejects(sharing.read(token, "note", nested.id), {
    code: "not_found",
  });
  assert.equal(
    (await sharing.get(alice, { kind: "note", id: nested.id })).inherited
      .length,
    0,
  );
  const newChild = await notebook("New child", root.id);
  const fresh = await save(alice, "# Newly added", newChild.id);
  assert.equal(
    (await sharing.read(token, "note", fresh.id)).note!.title,
    "Newly added",
  );
});

test("public pagination binds token, route, size and permission version", async () => {
  const root = await notebook("Pages");
  const notes = await Promise.all([
    save(alice, "# One", root.id),
    save(alice, "# Two", root.id),
    save(alice, "# Three", root.id),
  ]);
  const state = await enable({ kind: "notebook", id: root.id });
  const token = secret(state);
  const one = await sharing.read(token, "root", undefined, { limit: 1 });
  const two = await sharing.read(token, "root", undefined, {
    limit: 1,
    cursor: one.nextCursor!,
  });
  const three = await sharing.read(token, "root", undefined, {
    limit: 1,
    cursor: two.nextCursor!,
  });
  assert.deepEqual(
    [one.notes[0]!.id, two.notes[0]!.id, three.notes[0]!.id],
    notes.map((n) => n.id).sort(),
  );
  assert.equal(three.nextCursor, null);
  await assert.rejects(
    sharing.read(token, "root", undefined, { cursor: one.nextCursor! }),
    { code: "invalid_cursor" },
  );
  await assert.rejects(
    sharing.read(token, "notebook", root.id, {
      limit: 1,
      cursor: one.nextCursor!,
    }),
    { code: "invalid_cursor" },
  );
  await assert.rejects(
    sharing.read(token, "root", undefined, {
      limit: 1,
      cursor: `x${one.nextCursor}`,
    }),
    { code: "invalid_cursor" },
  );
  await sharing.change(alice, state.direct!.id, "scope", {
    operationId: randomUUID(),
    expectedVersion: 1,
    includeDescendants: true,
  });
  await assert.rejects(
    sharing.read(token, "root", undefined, {
      limit: 1,
      cursor: one.nextCursor!,
    }),
    { code: "invalid_cursor" },
  );
});

test("live reads respect edits, archive, expiry, deletion and account state", async () => {
  const hidden = await save(alice, "# Private title");
  const note = await save(
    alice,
    `# Visible\n[Private](/app/memories/${hidden.id})`,
  );
  const state = await enable({ kind: "note", id: note.id });
  const token = secret(state);
  assert.deepEqual((await sharing.read(token)).note!.linkedNoteIds, []);
  const changed = await service.remember(
    alice,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: note.id,
      expectedVersion: 1,
      content: "# Changed",
      retentionDays: 1,
    }),
  );
  assert.equal((await sharing.read(token)).note!.title, "Changed");
  const archived = await service.lifecycle(alice, note.id, "archive", {
    operationId: randomUUID(),
    expectedVersion: changed.version,
  });
  await assert.rejects(sharing.read(token), { code: "not_found" });
  assert.equal(
    (await sharing.get(alice, { kind: "note", id: note.id })).canShare,
    false,
  );
  const restored = await service.lifecycle(alice, note.id, "restore", {
    operationId: randomUUID(),
    expectedVersion: archived.version,
  });
  assert.equal((await sharing.read(token)).note!.title, "Changed");
  await admin("memories")
    .where({ id: note.id })
    .update({ expiresAt: new Date(Date.now() - 1000) });
  await assert.rejects(sharing.read(token), { code: "not_found" });
  await admin("memories")
    .where({ id: note.id })
    .update({ expiresAt: new Date(Date.now() + 86400000) });
  await admin("accounts")
    .where({ id: alice.accountId })
    .update({ status: "disabled" });
  try {
    await assert.rejects(sharing.read(token), { code: "not_found" });
  } finally {
    await admin("accounts")
      .where({ id: alice.accountId })
      .update({ status: "active" });
  }
  await service.forget(alice, {
    operationId: randomUUID(),
    items: [{ id: note.id, expectedVersion: restored.version }],
  });
  await assert.rejects(sharing.read(token), { code: "not_found" });
  assert.equal(
    (await admin("public_shares").where({ id: state.direct!.id })).length,
    0,
  );
});

test("public traffic has a separate bounded budget and key rotation permits owner recovery", async () => {
  const note = await save(alice);
  const state = await enable({ kind: "note", id: note.id });
  const changedKey = new Sharing(service, {
    key: "cd".repeat(32),
    siteUrl: "https://grove.example.test",
  });
  assert.equal(
    (await changedKey.get(alice, { kind: "note", id: note.id })).direct!.url,
    null,
  );
  const replacement = await changedKey.change(
    alice,
    state.direct!.id,
    "rotate",
    { operationId: randomUUID(), expectedVersion: 1 },
  );
  assert(replacement.direct!.url);
  await assert.rejects(changedKey.read(secret(state)), { code: "not_found" });
  await admin.raw("SELECT grove_share_admit(?) FROM generate_series(1, 240)", [
    state.direct!.id,
  ]);
  await assert.rejects(changedKey.read(secret(replacement)), {
    code: "rate_limited",
  });
  assert.equal(
    (await changedKey.get(alice, { kind: "note", id: note.id })).direct!.active,
    true,
  );
  const unconfigured = new Sharing(service, {
    siteUrl: "https://grove.example.test",
  });
  assert.equal(
    (await unconfigured.get(alice, { kind: "note", id: note.id })).available,
    false,
  );
  await assert.rejects(unconfigured.read(secret(replacement)), {
    code: "sharing_unavailable",
  });
  await unconfigured.change(alice, state.direct!.id, "revoke", {
    operationId: randomUUID(),
    expectedVersion: 2,
  });
});
after(async () => {
  await Promise.all([db.destroy(), admin.destroy()]);
});

const save = (
  principal: Principal,
  content = "# Shared note",
  projectId: string | null = null,
) =>
  service.remember(
    principal,
    rememberSchema.parse({ operationId: randomUUID(), content, projectId }),
  );

test("concurrent rotation/revocation and an in-flight read cannot revive a completed revocation", async () => {
  const note = await save(alice);
  const state = await enable({ kind: "note", id: note.id });
  const changes = await Promise.allSettled(
    ["rotate", "revoke"].map((action) =>
      sharing.change(alice, state.direct!.id, action as "rotate" | "revoke", {
        operationId: randomUUID(),
        expectedVersion: 1,
      }),
    ),
  );
  assert.equal(changes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(changes.filter((item) => item.status === "rejected").length, 1);
  await assert.rejects(sharing.read(secret(state)), { code: "not_found" });
  const current = await sharing.get(alice, { kind: "note", id: note.id });
  const live = current.direct!.active
    ? current
    : await sharing.enable(
        alice,
        { kind: "note", id: note.id },
        shareEnableSchema.parse({
          operationId: randomUUID(),
          expectedVersion: current.direct!.version,
          expectedTargetVersion: note.version,
        }),
      );
  const reader = await db.transaction();
  try {
    const { rows } = await reader.raw(
      "SELECT grove_public_share(?, 'root', NULL, NULL, NULL, NULL, 30) AS value",
      [createHash("sha256").update(secret(live)).digest("hex")],
    );
    assert.equal(rows[0].value.note.id, note.id);
    const revoking = sharing.change(alice, live.direct!.id, "revoke", {
      operationId: randomUUID(),
      expectedVersion: live.direct!.version,
    });
    await reader.commit();
    await revoking;
    await assert.rejects(sharing.read(secret(live)), { code: "not_found" });
  } finally {
    if (!reader.isCompleted()) await reader.rollback();
  }
});

test("scope narrowing, moving notes and outside cursors never grant extra access", async () => {
  const root = await notebook("Scope root");
  const child = await notebook("Scope child", root.id);
  const elsewhere = await notebook("Elsewhere");
  const note = await save(alice, "# Mobile note", child.id);
  const state = await enable({ kind: "notebook", id: root.id }, 1, true);
  const direct = await enable({ kind: "note", id: note.id });
  assert.equal(
    (await sharing.read(secret(state), "note", note.id)).note!.id,
    note.id,
  );
  await sharing.change(alice, state.direct!.id, "scope", {
    operationId: randomUUID(),
    expectedVersion: 1,
    includeDescendants: false,
  });
  await assert.rejects(sharing.read(secret(state), "note", note.id), {
    code: "not_found",
  });
  await assert.rejects(sharing.read(secret(state), "notebook", child.id), {
    code: "not_found",
  });
  const moved = await service.remember(
    alice,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: note.id,
      expectedVersion: 1,
      content: note.content,
      projectId: root.id,
    }),
  );
  assert.equal(
    (await sharing.read(secret(state), "note", note.id)).note!.id,
    note.id,
  );
  await service.remember(
    alice,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: note.id,
      expectedVersion: moved.version,
      content: note.content,
      projectId: elsewhere.id,
    }),
  );
  await assert.rejects(sharing.read(secret(state), "note", note.id), {
    code: "not_found",
  });
  assert.equal((await sharing.read(secret(direct))).note!.id, note.id);
});

test("security-definer readers cannot be shadowed with temporary relations", async () => {
  const note = await save(alice);
  const state = await enable({ kind: "note", id: note.id });
  await db.transaction(async (trx) => {
    await trx.raw("CREATE TEMP TABLE public_shares (id uuid) ON COMMIT DROP");
    await trx.raw("CREATE TEMP TABLE accounts (id uuid) ON COMMIT DROP");
    await trx.raw("CREATE TEMP TABLE memories (id uuid) ON COMMIT DROP");
    const { rows } = await trx.raw(
      "SELECT grove_public_share(?, 'root', NULL, NULL, NULL, NULL, 30) AS value",
      [createHash("sha256").update(secret(state)).digest("hex")],
    );
    assert.equal(rows[0].value.note.id, note.id);
  });
});

test("account deletion purges sharing records and rate state using the worker role", async () => {
  const workerUrl = process.env.TEST_WORKER_DATABASE_URL;
  assert(workerUrl, "Use a disposable worker connection");
  const workerDb = createDatabase(workerUrl);
  try {
    const subject = `user_sharing_delete_${randomUUID()}`;
    const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
    const principal = sessionPrincipal(rows[0].id, subject);
    const note = await save(principal);
    const state = await sharing.enable(
      principal,
      { kind: "note", id: note.id },
      shareEnableSchema.parse({
        operationId: randomUUID(),
        expectedVersion: 0,
        expectedTargetVersion: 1,
      }),
    );
    await sharing.read(secret(state));
    assert.equal(
      (await admin("public_share_rates").where({ bucket: state.direct!.id }))
        .length,
      1,
    );
    await service.deleteAccount(principal);
    await assert.rejects(sharing.read(secret(state)), { code: "not_found" });
    await new MemoryService(workerDb, service.cursorSecret).maintenance(
      async () => {},
    );
    for (const table of ["public_shares", "public_share_operations"])
      assert.equal(
        (await admin(table).where({ accountId: principal.accountId })).length,
        0,
      );
    assert.equal(
      (await admin("public_share_rates").where({ bucket: state.direct!.id }))
        .length,
      0,
    );
  } finally {
    await workerDb.destroy();
  }
});

test("invalid public tokens consume a shared budget without charging the owner", async () => {
  const note = await save(alice);
  const before = await admin("rate_buckets")
    .where({ accountId: alice.accountId })
    .select("*");
  await admin.raw(
    "INSERT INTO public_share_rates(bucket, minute, count) VALUES('global', date_trunc('minute', now()), 1200) ON CONFLICT(bucket, minute) DO UPDATE SET count = 1200",
  );
  try {
    const app = createApp({
      memories: service,
      shareLinkKey: "ab".repeat(32),
      auth: {
        async principal() {
          return alice;
        },
      },
      origin: "https://api.example.test",
      siteUrl: "https://grove.example.test",
      issuer: "https://clerk.example.test",
      webhookSecret: "unused",
      ready: async () => {},
    });
    const response = await app.request("/public/shares/not-a-capability");
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.deepEqual(
      await admin("rate_buckets")
        .where({ accountId: alice.accountId })
        .select("*"),
      before,
    );
    assert.equal(
      (await sharing.get(alice, { kind: "note", id: note.id })).target.id,
      note.id,
    );
  } finally {
    await admin("public_share_rates").where({ bucket: "global" }).delete();
  }
});

test("share storage enforces tenant isolation, same-owner targets and explicit target shape", async () => {
  const mine = await save(alice);
  const foreign = await save(bob);
  const row = {
    id: randomUUID(),
    accountId: alice.accountId,
    memoryId: mine.id,
    tokenDigest: "a".repeat(64),
    tokenCiphertext: "encrypted-fixture",
  };
  await tenant(db, alice.accountId, (trx) => trx("public_shares").insert(row));
  assert.equal((await db("public_shares")).length, 0);
  assert.equal(
    (
      await tenant(db, bob.accountId, (trx) =>
        trx("public_shares").where({ id: row.id }),
      )
    ).length,
    0,
  );
  await assert.rejects(
    tenant(db, alice.accountId, (trx) =>
      trx("public_shares").insert({
        ...row,
        id: randomUUID(),
        memoryId: foreign.id,
        tokenDigest: "b".repeat(64),
      }),
    ),
    /foreign key/,
  );
  await assert.rejects(
    tenant(db, bob.accountId, (trx) =>
      trx("public_shares").insert({
        ...row,
        id: randomUUID(),
        tokenDigest: "b".repeat(64),
      }),
    ),
    /row-level security/,
  );
  await assert.rejects(
    tenant(db, alice.accountId, (trx) =>
      trx("public_shares").insert({
        ...row,
        id: randomUUID(),
        memoryId: null,
        tokenDigest: "b".repeat(64),
      }),
    ),
    /check constraint/,
  );
  await assert.rejects(
    tenant(db, alice.accountId, (trx) =>
      trx("public_shares")
        .where({ id: row.id })
        .update({ includeDescendants: true }),
    ),
    /check constraint/,
  );
  await assert.rejects(
    db("public_share_rates").select("*"),
    /permission denied/,
  );
  const { rows } = await admin.raw(
    "SELECT has_function_privilege('grove_worker', 'grove_public_share(text,text,uuid,uuid,uuid,integer,integer)', 'EXECUTE') AS permitted",
  );
  assert.equal(rows[0].permitted, false);
  await tenant(db, alice.accountId, (trx) =>
    trx("memories").where({ id: mine.id }).delete(),
  );
  assert.equal(
    (
      await tenant(db, alice.accountId, (trx) =>
        trx("public_shares").where({ id: row.id }),
      )
    ).length,
    0,
  );
});
