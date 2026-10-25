import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant, type Knex } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import {
  rememberSchema,
  listSchema,
  recallSchema,
} from "@lib/shared/contracts";
import { deliverEmail } from "../../packages/api/src/mail.ts";
import { askSchema } from "@lib/shared/models";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Use a disposable test database");
const authority = createDatabase(url);
const name = `grove_background_${randomUUID().replaceAll("-", "")}_test`;
let db: Knex, workerDb: Knex, admin: Knex;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = (source: string) => {
    const u = new URL(source);
    u.pathname = `/${name}`;
    return u.href;
  };
  admin = createDatabase(target(url));
  await admin.migrate.latest();
  db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  workerDb = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
});
after(async () => {
  await Promise.all([db?.destroy(), workerDb?.destroy(), admin?.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
  await authority.destroy();
});
const input = (content: string, rest = {}) =>
  rememberSchema.parse({ operationId: randomUUID(), content, ...rest });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const subject = `background_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  const embedding = {
    profile: `test-${randomUUID()}`,
    model: "test",
    dimensions: 384,
    embed: async () => [1, ...Array(383).fill(0)],
  };
  const service = new MemoryService(
    db,
    "background-test-secret-32-characters",
    embedding,
  );
  const worker = new MemoryService(workerDb, service.cursorSecret, embedding);
  return { principal, service, worker };
}

test("ephemeral lifetime is independent of kind; moves preserve expiry, restore renews, permanent conversion survives maintenance", async () => {
  const { principal, service, worker } = await fixture();
  const memory = await service.remember(
    principal,
    input("Short-lived research", { kind: "fact", retentionDays: 7 }),
  );
  assert.equal(memory.retentionDays, 7);
  assert(memory.expiresAt && memory.purgeAt);
  const project = await service.project(principal, {
    name: "Research",
    identity: `test:${randomUUID()}`,
  });
  const moved = await service.remember(
    principal,
    input(memory.content, {
      id: memory.id,
      expectedVersion: memory.version,
      projectId: project.id,
      kind: memory.kind,
    }),
  );
  assert.equal(moved.expiresAt, memory.expiresAt);
  await admin("memories")
    .where({ id: memory.id })
    .update({
      expiresAt: admin.raw("now() - interval '1 day'"),
      purgeAt: admin.raw("now() + interval '59 days'"),
    });
  assert.equal(
    (await service.list(principal, listSchema.parse({ lifetime: "ephemeral" })))
      .items.length,
    0,
  );
  assert.equal(
    (
      await service.list(
        principal,
        listSchema.parse({ status: "expired", lifetime: "ephemeral" }),
      )
    ).items[0].id,
    memory.id,
  );
  assert.equal(
    (
      await service.recall(
        principal,
        recallSchema.parse({ projectId: project.id }),
      )
    ).items.length,
    0,
  );
  const restored = await service.lifecycle(principal, memory.id, "restore", {
    operationId: randomUUID(),
    expectedVersion: moved.version,
  });
  assert(Date.parse(restored.expiresAt!) > Date.now());
  const permanent = await service.remember(
    principal,
    input(restored.content, {
      id: memory.id,
      expectedVersion: restored.version,
      projectId: project.id,
      retentionDays: null,
    }),
  );
  assert.equal(permanent.expiresAt, null);
  await worker.maintenance(async () => {});
  assert.equal(
    (await service.get(principal, permanent.id)).retentionDays,
    null,
  );
  const handoff = await service.remember(
    principal,
    input("A durable task record", {
      kind: "handoff",
      taskId: randomUUID(),
      retentionDays: null,
    }),
  );
  assert.equal(handoff.expiresAt, null);
});

test("date/source/lifetime filtering and microsecond pagination apply to the entire scoped result set", async () => {
  const { principal, service } = await fixture();
  const other = await fixture();
  const records = [];
  for (let i = 0; i < 4; i++)
    records.push(
      await service.remember(
        principal,
        input(`Sorted note ${i}`, {
          source: { agent: "website" },
          retentionDays: 7,
        }),
      ),
    );
  await other.service.remember(
    other.principal,
    input("Never cross accounts", {
      source: { agent: "website" },
      retentionDays: 7,
    }),
  );
  await admin("memories")
    .whereIn(
      "id",
      records.map((m) => m.id),
    )
    .update({
      updatedAt: admin.raw("'2026-10-20T12:00:00.123456Z'::timestamptz"),
    });
  for (const sort of ["updated_asc", "updated_desc", "created_desc"] as const) {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await service.list(
        principal,
        listSchema.parse({
          sourceAgent: "website",
          updatedAfter: "2026-10-19T00:00:00Z",
          lifetime: "ephemeral",
          sort,
          limit: 1,
          cursor: cursor ?? undefined,
        }),
      );
      ids.push(...page.items.map((m) => m.id));
      cursor = page.nextCursor;
      assert(ids.length <= 4, "pagination must not repeat a timestamp tie");
    } while (cursor);
    assert.equal(new Set(ids).size, 4);
    assert.deepEqual([...ids].sort(), records.map((m) => m.id).sort());
  }
  const page = await service.list(
    principal,
    listSchema.parse({ sort: "updated_desc", limit: 1 }),
  );
  await assert.rejects(
    service.list(
      principal,
      listSchema.parse({ sort: "updated_asc", cursor: page.nextCursor }),
    ),
    { code: "invalid_cursor" },
  );
  assert.equal(
    (await service.list(principal, listSchema.parse({ sourceAgent: "codex" })))
      .items.length,
    0,
  );
});

test("scheduled organization repairs missing data once and never resets exhausted jobs or processes inactive memories", async () => {
  const { principal, service, worker } = await fixture();
  const one = await service.remember(principal, input("Reconcile this note"));
  const failed = await service.remember(
    principal,
    input("Failed job remains inspectable"),
  );
  const expired = await service.remember(
    principal,
    input("Expired note", { retentionDays: 1 }),
  );
  await admin("jobs").where({ memoryId: one.id }).delete();
  await admin("jobs")
    .where({ memoryId: failed.id })
    .update({ failedAt: admin.fn.now(), attempts: 5 });
  await admin("memories")
    .where({ id: expired.id })
    .update({
      expiresAt: admin.raw("now() - interval '1 day'"),
      purgeAt: admin.raw("now() + interval '59 days'"),
    });
  await admin("jobs").where({ memoryId: expired.id }).delete();
  await Promise.all([
    worker.scheduleOrganization(900),
    worker.scheduleOrganization(900),
  ]);
  assert.equal((await admin("jobs").where({ memoryId: one.id })).length, 1);
  assert.equal((await admin("jobs").where({ memoryId: expired.id })).length, 0);
  assert.equal(
    (await admin("jobs").where({ memoryId: failed.id }).first()).attempts,
    5,
  );
  const job = await admin("jobs").where({ memoryId: one.id }).first();
  const claimed = await Promise.all([
    worker.runJob(job.id),
    worker.runJob(job.id),
  ]);
  assert.equal(claimed.filter(Boolean).length, 1);
  await admin("accounts")
    .where({ id: principal.accountId })
    .update({ organizationDueAt: admin.fn.now() });
  await worker.scheduleOrganization(900);
  assert.equal((await admin("jobs").where({ memoryId: one.id })).length, 0);
});

test("transactional mail is an isolated outbox with idempotent delivery, retries, and verified-recipient enforcement", async () => {
  const { principal } = await fixture();
  const job = await admin("transactional_emails")
    .where({ accountId: principal.accountId })
    .first();
  assert.equal(job.kind, "welcome");
  await assert.rejects(db("transactional_emails").select("id"));
  assert.equal((await workerDb("transactional_emails").select("id")).length, 0);
  const requests: RequestInit[] = [];
  const send = (async (_url: unknown, init: RequestInit) => {
    requests.push(init);
    return requests.length === 1
      ? new Response("{}", { status: 503 })
      : Response.json({ id: "resend-test-id" });
  }) as typeof fetch;
  const config = {
    key: "re_test",
    from: "notifications@example.test",
    siteUrl: "https://grove.example.test",
  };
  const recipient = async () => "verified@example.test";
  await deliverEmail(workerDb, config, recipient, job.id, send);
  assert.equal(
    (await admin("transactional_emails").where({ id: job.id }).first())
      .errorCode,
    "email_http_503",
  );
  await admin("transactional_emails")
    .where({ id: job.id })
    .update({ dueAt: admin.fn.now() });
  await deliverEmail(workerDb, config, recipient, job.id, send);
  assert.deepEqual(requests[0], { ...requests[1], signal: requests[0].signal });
  assert.equal(
    await deliverEmail(workerDb, config, recipient, job.id, send),
    false,
  );
  assert(
    (await admin("transactional_emails").where({ id: job.id }).first()).sentAt,
  );
  const unverified = await fixture();
  const rejected = await admin("transactional_emails")
    .where({ accountId: unverified.principal.accountId })
    .first();
  await deliverEmail(workerDb, config, async () => null, rejected.id, send);
  assert.equal(
    (await admin("transactional_emails").where({ id: rejected.id }).first())
      .errorCode,
    "email_recipient_unavailable",
  );
  assert.equal(requests.length, 2);
  await tenant(workerDb, principal.accountId, (trx) =>
    trx("accounts")
      .where({ id: principal.accountId })
      .update({ status: "deleting" }),
  );
});

test("connection notifications follow real grant transitions and exhausted deliveries leave the dispatch queue", async () => {
  const { principal, service } = await fixture();
  const input = {
    name: "Notification test",
    capabilities: ["memory:read" as const],
    personal: true,
    allProjects: false,
    projectIds: [],
  };
  const { connection } = await service.grant(principal, input, { key: true });
  await service.grant(
    principal,
    { ...input, name: "Renamed connection" },
    { id: connection.id },
  );
  await service.revoke(principal, connection.id);
  await service.revoke(principal, connection.id);
  const emails = await admin("transactional_emails")
    .where({ accountId: principal.accountId })
    .orderBy("createdAt");
  assert.deepEqual(
    emails.map((row) => row.kind),
    ["welcome", "connection_approved", "connection_revoked"],
  );
  await admin("transactional_emails")
    .where({ id: emails[0].id })
    .update({ attempts: 5 });
  await admin("transactional_emails")
    .where({ id: emails[1].id })
    .update({ createdAt: admin.raw("now() - interval '24 hours'") });
  await workerDb.raw("SELECT grove_sweep_deliveries()");
  const dispatch = await workerDb.raw(
    "SELECT * FROM grove_due_dispatch(?::text[], true)",
    [[]],
  );
  assert(
    !dispatch.rows.some((row: { id: string }) =>
      [emails[0].id, emails[1].id].includes(row.id),
    ),
  );
  assert(dispatch.rows.some((row: { id: string }) => row.id === emails[2].id));
  assert.equal(
    (
      await admin("transactional_emails")
        .where({ accountId: principal.accountId })
        .whereNotNull("failedAt")
    ).length,
    2,
  );
});

test("Ask Grove discards answers after cancellation, revoked access, disabled summaries, or a provider switch", async () => {
  for (const change of ["cancel", "revoke", "settings", "profile"] as const) {
    const { principal, service } = await fixture();
    const note = await service.remember(
      principal,
      input("Orchard visits are in autumn."),
    );
    const grant = await service.grant(
      principal,
      {
        name: "Scoped questions",
        capabilities: ["memory:read"],
        personal: true,
        allProjects: false,
        projectIds: [],
      },
      { key: true },
    );
    const key = {
      ...principal,
      type: "key" as const,
      connectionId: grant.connection.id,
      capabilities: ["memory:read" as const],
    };
    const started = deferred(),
      gate = deferred();
    const controller = new AbortController();
    let inferenceSignal: AbortSignal | undefined;
    service.providers.generation = {
      profile: "ask-delayed",
      generate: async (schema, _instructions, _sources, options) => {
        inferenceSignal = options?.signal;
        assert(inferenceSignal && !inferenceSignal.aborted);
        started.resolve();
        await gate.promise;
        return schema.parse({
          insufficient: false,
          statements: [
            {
              text: "Visit in autumn.",
              sources: [{ id: note.id, version: note.version }],
            },
          ],
        });
      },
    };
    const pending = service.ask(
      key,
      askSchema.parse({ query: "orchard" }),
      controller.signal,
    );
    const rejected = assert.rejects(
      pending,
      change === "cancel"
        ? { name: "AbortError" }
        : {
            code: change === "revoke" ? "forbidden" : "sources_changed",
          },
    );
    await started.promise;
    if (change === "cancel") {
      controller.abort();
      assert.equal(inferenceSignal?.aborted, true, "caller cancellation reaches the composed cache/provider signal");
    }
    if (change === "revoke")
      await service.revoke(principal, grant.connection.id);
    if (change === "settings")
      await service.settings(principal, {
        captureEnabled: true,
        recallEnabled: true,
        summariesEnabled: false,
      });
    if (change === "profile")
      service.providers.generation = {
        ...service.providers.generation,
        profile: "changed-provider",
      };
    gate.resolve();
    await rejected;
    assert.equal(
      (await service.list(principal, listSchema.parse({}))).items.length,
      1,
    );
  }
});

test("Ask Grove retrieves across authorized notebooks, grounds citations, and keeps search usable without generation", async () => {
  const { principal, service } = await fixture();
  const { principal: other, service: otherService } = await fixture();
  const project = await service.project(principal, {
    name: "Orchard",
    identity: `ask:${randomUUID()}`,
  });
  const personal = await service.remember(
    principal,
    input("Orchard visits are best in autumn."),
  );
  const scoped = await service.remember(
    principal,
    input("Orchard planning: bring a notebook.", { projectId: project.id }),
  );
  await otherService.remember(other, input("Orchard private account data."));
  let calls = 0;
  service.providers.generation = {
    profile: "ask-test",
    generate: async (schema, _instructions, sources, options) => {
      calls++;
      assert.equal(options?.context?.question, "orchard");
      assert(
        sources.every((source) => [personal.id, scoped.id].includes(source.id)),
      );
      return schema.parse({
        insufficient: false,
        statements: [
          {
            text: "Bring a notebook.",
            sources: [{ id: sources[0].id, version: sources[0].version }],
          },
        ],
      });
    },
  };
  const all = await service.ask(
    principal,
    askSchema.parse({ query: "orchard" }),
  );
  assert.equal(all.status, "ready");
  assert.equal(all.sources.length, 2);
  const grant = await service.grant(
    principal,
    {
      name: "Read one notebook",
      capabilities: ["memory:read"],
      personal: false,
      allProjects: false,
      projectIds: [project.id],
    },
    { key: true },
  );
  const key = {
    ...principal,
    type: "key" as const,
    connectionId: grant.connection.id,
    capabilities: ["memory:read" as const],
  };
  const limited = await service.ask(key, askSchema.parse({ query: "orchard" }));
  assert.deepEqual(
    limited.sources.map((source) => source.id),
    [scoped.id],
  );
  const count = calls;
  assert.equal(
    (
      await service.ask(
        principal,
        askSchema.parse({ query: "orchard", mode: "search" }),
      )
    ).status,
    "search",
  );
  assert.equal(calls, count);
  delete service.providers.generation;
  assert.equal(
    (await service.ask(principal, askSchema.parse({ query: "orchard" })))
      .status,
    "generation_disabled",
  );
  assert.equal(
    (await service.ask(principal, askSchema.parse({ query: "unmatchedword" })))
      .status,
    "no_evidence",
  );
});

test("answers reject fabricated citations and concurrent changes; restored revisions never overwrite a later edit", async () => {
  const { principal, service } = await fixture();
  const old = await service.remember(
    principal,
    input("Orchard meeting: Tuesday."),
  );
  service.providers.generation = {
    profile: "ask-invalid",
    generate: async (schema) =>
      schema.parse({
        insufficient: false,
        statements: [
          {
            text: "Invented evidence.",
            sources: [{ id: randomUUID(), version: 1 }],
          },
        ],
      }),
  };
  await assert.rejects(
    service.ask(principal, askSchema.parse({ query: "orchard" })),
    { code: "generation_invalid_citation" },
  );
  const entered = deferred();
  const gate = deferred();
  service.providers.generation = {
    profile: "ask-stale",
    generate: async (schema, _instructions, sources) => {
      entered.resolve();
      await gate.promise;
      return schema.parse({
        insufficient: false,
        statements: [
          {
            text: "Tuesday.",
            sources: [{ id: sources[0].id, version: sources[0].version }],
          },
        ],
      });
    },
  };
  const pending = service.ask(principal, askSchema.parse({ query: "orchard" }));
  await entered.promise;
  const updated = await service.remember(
    principal,
    input("Orchard meeting: Wednesday.", {
      id: old.id,
      expectedVersion: old.version,
    }),
  );
  gate.resolve();
  await assert.rejects(pending, { code: "sources_changed" });
  const history = await service.revisions(principal, old.id);
  assert(history.some((revision) => revision.content === old.content));
  await assert.rejects(
    service.lifecycle(principal, old.id, "restore", {
      operationId: randomUUID(),
      expectedVersion: old.version,
      revision: old.version,
    }),
    { code: "version_conflict" },
  );
  const restored = await service.lifecycle(principal, old.id, "restore", {
    operationId: randomUUID(),
    expectedVersion: updated.version,
    revision: old.version,
  });
  assert.equal(restored.version, 3);
  assert.equal(restored.content, old.content);
  assert(
    (await service.revisions(principal, old.id)).some(
      (revision) => revision.content === updated.content,
    ),
  );
});
