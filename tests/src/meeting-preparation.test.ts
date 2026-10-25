import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant, type Knex } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import type { Providers } from "@lib/ai";
import { rememberSchema } from "@lib/shared/contracts";
import { assistanceRequestSchema } from "@lib/shared/assistance";
import { configureBillingQuotas } from "../../lib/memory/src/billing-quotas.ts";
import {
  cleanupHandlers,
  scheduleCleanup,
} from "../../lib/memory/src/cleanup.ts";
import { runTask } from "../../lib/memory/src/task-runner.ts";
import { createApp } from "../../packages/api/src/app.ts";
import { Authentication } from "../../packages/api/src/auth.ts";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(url && new URL(url).pathname.endsWith("_test"));
const authority = createDatabase(url);
const name = `grove_meeting_${randomUUID().replaceAll("-", "")}_test`;
let admin: Knex, db: Knex, workerDb: Knex;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = (input: string) => {
    const parsed = new URL(input);
    parsed.pathname = `/${name}`;
    return parsed.href;
  };
  admin = createDatabase(target(url));
  await admin.migrate.latest();
  db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  workerDb = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  for (const database of [db, workerDb])
    configureBillingQuotas(database, {
      enabled: async () => true,
      priceIds: ["price_pro"],
    });
});
after(async () => {
  await Promise.all([admin?.destroy(), db?.destroy(), workerDb?.destroy()]);
  await authority.raw("DROP DATABASE IF EXISTS ?? WITH (FORCE)", [name]);
  await authority.destroy();
});

async function fixture() {
  const subject = `meeting_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  const supplied: string[][] = [];
  const providers: Providers = {
    generation: {
      profile: `meeting-${randomUUID()}`,
      generate: async (schema, prompt, sources, options) => {
        assert.match(prompt, /evidence/i);
        assert(options?.context?.question.includes("Launch"));
        supplied.push(sources.map((s) => s.id));
        const source = sources[0];
        return schema.parse({
          decisions: source
            ? [
                {
                  text: "Use staged launch.",
                  sources: [
                    {
                      id: source.id,
                      version: source.version,
                      quote: source.content,
                    },
                  ],
                },
              ]
            : [],
          discussions: [],
          questions: [],
        });
      },
    },
  };
  const service = new MemoryService(
    db,
    "meeting-test-secret-at-least-32-chars",
    undefined,
    providers,
  );
  const worker = new MemoryService(
    workerDb,
    service.cursorSecret,
    undefined,
    providers,
  );
  await service.settings(principal, {
    titlesTagsEnabled: false,
    classificationEnabled: false,
    noteConnectionsEnabled: false,
    notebookConnectionsEnabled: false,
    notebookSummariesEnabled: false,
    personalSummaryEnabled: false,
    progressSummariesEnabled: false,
  });
  const project = await service.project(principal, {
    name: "Launch",
    identity: randomUUID(),
  });
  const save = (content: string, extra = {}) =>
    service.remember(
      principal,
      rememberSchema.parse({
        operationId: randomUUID(),
        content,
        projectId: project.id,
        ...extra,
      }),
    );
  const input = (extra = {}) =>
    assistanceRequestSchema.parse({
      id: randomUUID(),
      kind: "meeting",
      title: "Launch planning",
      agenda: "Launch rollout risks",
      projectId: project.id,
      ...extra,
    });
  const enable = () =>
    service.settings(principal, { meetingPreparationEnabled: true });
  const drain = async () => {
    for (let n = 0; n < 30; n++) {
      await admin("jobs")
        .where({ accountId: principal.accountId })
        .whereNull("failedAt")
        .update({ dueAt: admin.fn.now() });
      if (!(await worker.runJob())) return;
    }
    assert.fail("Meeting did not finish");
  };
  const request = async (value = input()) => {
    await service.assistance.request(principal, value);
    await drain();
    return service.assistance.get(principal, value.id);
  };
  return {
    service,
    worker,
    principal,
    providers,
    supplied,
    project,
    save,
    input,
    enable,
    drain,
    request,
  };
}

test("meeting requests bind exactly one bounded source scope and reject ambiguous or empty input", () => {
  const common = {
    id: randomUUID(),
    kind: "meeting",
    title: "Launch",
    agenda: "Rollout risks",
  };
  const ref = { id: randomUUID(), version: 1 };
  assert(
    assistanceRequestSchema.safeParse({
      ...common,
      sources: [ref],
      projectId: null,
    }).success,
  );
  assert(
    assistanceRequestSchema.safeParse({ ...common, projectId: randomUUID() })
      .success,
  );
  for (const extra of [
    { projectId: null },
    { sources: [], projectId: null },
    { sources: [ref, ref], projectId: null },
    { sources: [ref], projectId: randomUUID() },
    {
      sources: Array.from({ length: 13 }, () => ({ ...ref, id: randomUUID() })),
      projectId: null,
    },
    { sources: [ref], projectId: null, agenda: " " },
    { sources: [ref], projectId: null, meetingDate: "2026-02-31" },
    { sources: [ref], projectId: null, unknown: true },
  ])
    assert(!assistanceRequestSchema.safeParse({ ...common, ...extra }).success);
});

test("meeting preparation is separately opted in and cannot be enabled by legacy settings", async () => {
  const f = await fixture();
  assert.equal(
    (await admin("accounts").where({ id: f.principal.accountId }).first())
      .meetingPreparationEnabled,
    false,
  );
  await f.service.settings(f.principal, { summariesEnabled: true });
  await assert.rejects(f.service.assistance.request(f.principal, f.input()), {
    code: "feature_disabled",
  });
  assert.equal(f.supplied.length, 0);
});

test("meeting evidence stays notebook-local, persists coverage and replay charges once; Save and Undo are explicit", async () => {
  const f = await fixture();
  await f.enable();
  const note = await f.save("Launch: use staged launch.");
  await f.save("OUTSIDE_CANARY", { projectId: null });
  const child = await f.service.project(f.principal, {
    name: "Child",
    identity: randomUUID(),
    parentId: f.project.id,
  });
  await f.save("CHILD_CANARY", { projectId: child.id });
  const input = f.input();
  const result = await f.request(input);
  assert.equal(result.status, "ready");
  assert.deepEqual(f.supplied, [[note.id]]);
  const coverage = result.result!.coverage;
  assert.equal(coverage.total, 1);
  assert.equal(coverage.examined, 1);
  assert.equal(Reflect.get(coverage, "cited"), 1);
  assert.equal(Reflect.get(coverage, "partial"), false);
  assert.equal(
    (await f.service.assistance.request(f.principal, input)).id,
    result.id,
  );
  await assert.rejects(
    f.service.assistance.request(
      f.principal,
      f.input({ id: input.id, title: "Changed" }),
    ),
    { code: "preview_changed" },
  );
  const usage = await tenant(db, f.principal.accountId, (trx) =>
    trx("action_usage").where({ metric: "assistance" }),
  );
  assert.equal(usage.length, 1);
  assert.equal(usage[0].status, "completed");
  assert.equal((await f.service.get(f.principal, note.id)).version, 1);
  await assert.rejects(
    f.service.assistance.apply(f.principal, result.id, {
      expectedVersion: result.version,
      action: "combine",
    }),
    { code: "preview_changed" },
  );
  const saved = await f.service.assistance.apply(f.principal, result.id, {
    expectedVersion: result.version,
  });
  const retry = await f.service.assistance.apply(f.principal, result.id, {
    expectedVersion: result.version,
  });
  assert.deepEqual(retry.applied, saved.applied);
  const brief = await f.service.get(f.principal, saved.applied[0].id);
  assert(brief.content.includes("## Decisions"));
  assert(brief.content.includes(`?revision=${note.version}`));
  assert.equal(brief.projectId, f.project.id);
  await f.service.assistance.apply(
    f.principal,
    result.id,
    { expectedVersion: saved.version },
    true,
  );
  assert.equal((await f.service.get(f.principal, brief.id)).status, "archived");
});

test("selected notes are exact pins; foreign, archived and wrong revisions fail before inference", async () => {
  const f = await fixture(),
    other = await fixture();
  await f.enable();
  const note = await f.save("Launch: use staged launch.");
  const foreign = await other.save("FOREIGN_CANARY");
  const archived = await f.save("Archived decision", { archived: true });
  const expired = await f.save("Expired decision", { retentionDays: 1 });
  await admin("memories")
    .where({ id: expired.id })
    .update({ expiresAt: new Date(Date.now() - 1000) });
  for (const source of [foreign, archived, expired, { ...note, version: 99 }])
    await assert.rejects(
      f.service.assistance.request(
        f.principal,
        f.input({
          projectId: null,
          sources: [{ id: source.id, version: source.version }],
        }),
      ),
      { code: "sources_changed" },
    );
  await assert.rejects(
    f.service.assistance.request({ ...f.principal, type: "key" }, f.input()),
  );
  const result = await f.request(
    f.input({
      projectId: null,
      sources: [{ id: note.id, version: note.version }],
    }),
  );
  assert.equal(result.status, "ready");
  assert.deepEqual(f.supplied, [[note.id]]);
  await assert.rejects(
    other.service.assistance.get(other.principal, result.id),
    { code: "not_found" },
  );
  assert.deepEqual(await db("assistance_requests"), []);
});

test("large notebooks rank bounded evidence and disclose omissions rather than rejecting membership", async () => {
  const f = await fixture();
  await f.enable();
  await admin("memories").insert(
    Array.from({ length: 140 }, (_, n) => ({
      id: randomUUID(),
      accountId: f.principal.accountId,
      projectId: f.project.id,
      content: `Unrelated garden record ${n}`,
      kind: "fact",
      source: "{}",
    })),
  );
  const relevant = await f.save("Launch rollout risks: use staged launch.");
  const result = await f.request();
  assert.equal(result.status, "ready");
  assert(f.supplied.flat().includes(relevant.id));
  assert(f.supplied.flat().length <= 12);
  assert.equal(result.result!.coverage.total, 141);
  assert.equal(Reflect.get(result.result!.coverage, "partial"), true);
  assert.equal(f.supplied.length, 1);
  const saved = await f.service.assistance.apply(f.principal, result.id, {
    expectedVersion: result.version,
  });
  const brief = await f.service.get(f.principal, saved.applied[0].id);
  assert.match(brief.content, /Partial coverage/);
});

test("explicit pin budgets never silently drop notes, while empty notebooks do not generate or settle a charge", async () => {
  const f = await fixture();
  await f.enable();
  const empty = await f.request();
  assert.equal(empty.status, "ready");
  assert.equal(empty.result!.coverage.examined, 0);
  assert.equal(f.supplied.length, 0);
  const notes = await Promise.all(
    Array.from({ length: 5 }, (_, n) =>
      f.save(`Launch ${n} ` + "a".repeat(5900)),
    ),
  );
  await assert.rejects(
    f.service.assistance.request(
      f.principal,
      f.input({
        projectId: null,
        sources: notes.map(({ id, version }) => ({ id, version })),
      }),
    ),
    { code: "evidence_too_large" },
  );
  assert.equal(f.supplied.length, 0);
  const usage = await tenant(db, f.principal.accountId, (trx) =>
    trx("action_usage").where({ metric: "assistance" }),
  );
  assert(usage.every((row) => row.status === "released"));
});

test("uncited notebook edits and preference disable/re-enable fence held meeting publication", async () => {
  for (const change of ["source", "preference"] as const) {
    const f = await fixture();
    await f.enable();
    await f.save("Launch: use staged launch.");
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = f.providers.generation!.generate;
    f.providers.generation!.generate = async (...args) => {
      entered();
      await held;
      return generate(...args);
    };
    const input = f.input();
    await f.service.assistance.request(f.principal, input);
    const running = f.worker.runJob();
    await waiting;
    try {
      if (change === "source") await f.save("New uncited launch decision.");
      else {
        await f.service.settings(f.principal, {
          meetingPreparationEnabled: false,
        });
        await f.enable();
      }
    } finally {
      release();
    }
    await running;
    const result = await f.service.assistance.get(f.principal, input.id);
    assert.equal(result.status, "stale");
    assert.equal(result.result, null);
  }
});

test("forged meeting quotations never publish and thirty-day retention redacts derived data, not authored notes", async () => {
  const f = await fixture();
  await f.enable();
  const note = await f.save("Launch: use staged launch.");
  const generate = f.providers.generation!.generate;
  f.providers.generation!.generate = async (schema) =>
    schema.parse({
      decisions: [
        {
          text: "Invented",
          sources: [{ id: note.id, version: 1, quote: "NOT_IN_SOURCE" }],
        },
      ],
      discussions: [],
      questions: [],
    });
  const invalid = await f.request();
  assert.equal(invalid.status, "failed");
  assert.equal(invalid.result, null);
  f.providers.generation!.generate = generate;
  const ready = await f.request();
  assert(
    ready.expiresAt &&
      Date.parse(ready.expiresAt) <= Date.now() + 30 * 86400000,
  );
  await admin("assistance_requests")
    .where({ id: ready.id })
    .update({ expiresAt: new Date(Date.now() - 1000) });
  assert.equal(
    (await f.service.assistance.get(f.principal, ready.id)).result,
    null,
  );
  await scheduleCleanup(workerDb);
  const handlers = cleanupHandlers(workerDb, async () => {});
  for (
    let n = 0;
    n < 50 && (await runTask(workerDb, handlers, { lane: "maintenance" }));
    n++
  );
  const row = await admin("assistance_requests")
    .where({ id: ready.id })
    .first();
  assert.deepEqual(row.input, {});
  assert.equal(row.result, null);
  assert.equal(
    (await f.service.get(f.principal, note.id)).content,
    note.content,
  );
});

test("cancelled meeting work cannot publish after a held provider completes and replay cannot charge again", async () => {
  const f = await fixture();
  await f.enable();
  await f.save("Launch: use staged launch.");
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const generate = f.providers.generation!.generate;
  f.providers.generation!.generate = async (...args) => {
    entered();
    await held;
    return generate(...args);
  };
  const input = f.input();
  const pending = await f.service.assistance.request(f.principal, input);
  const running = f.worker.runJob();
  await waiting;
  try {
    const cancel = Reflect.get(f.service.assistance, "cancel");
    assert.equal(
      typeof cancel,
      "function",
      "Assistance needs an explicit cancellation boundary",
    );
    const cancelled = await cancel.call(
      f.service.assistance,
      f.principal,
      input.id,
      pending.version,
    );
    const retry = await cancel.call(
      f.service.assistance,
      f.principal,
      input.id,
      pending.version,
    );
    assert.equal(cancelled.status, "cancelled");
    assert.equal(retry.version, cancelled.version);
  } finally {
    release();
    await running;
  }
  const result = await f.service.assistance.get(f.principal, input.id);
  assert.equal(result.status, "cancelled");
  assert.equal(result.result, null);
  assert.equal(
    (await f.service.assistance.request(f.principal, input)).status,
    "cancelled",
  );
  const usage = await tenant(db, f.principal.accountId, (trx) =>
    trx("action_usage").where({ metric: "assistance" }),
  );
  assert.equal(usage[0].status, "released");
});

test("meeting HTTP create/read/cancel enforce private ownership and strict request bodies", async () => {
  const f = await fixture();
  await f.enable();
  await f.save("Launch: use staged launch.");
  const auth = new Authentication(db, {
    verify: async (token) => ({
      subject:
        token === "owner"
          ? f.principal.subject!
          : `other_${f.principal.subject}`,
      type: "session",
      sessionId: `meeting_${token}`,
    }),
  });
  const app = createApp({
    memories: f.service,
    auth,
    origin: "http://localhost",
    siteUrl: "http://localhost",
    issuer: "https://clerk.example.test",
    webhookSecret: "whsec_dGVzdA==",
    ready: async () => {},
  });
  const headers = {
    authorization: "Bearer owner",
    "content-type": "application/json",
  };
  assert.equal(
    (await app.request("/v1/assistance", { method: "POST", body: "{}" }))
      .status,
    401,
  );
  const input = f.input();
  assert.equal(
    (
      await app.request("/v1/assistance", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...input, useAllNotebooks: true }),
      })
    ).status,
    400,
  );
  const created = await app.request("/v1/assistance", {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  assert.equal(created.status, 200);
  assert.match(created.headers.get("cache-control")!, /no-store/);
  const pending = (await created.json()).data;
  const path = `/v1/assistance/${input.id}`;
  assert.equal(
    (await app.request(path, { headers: { authorization: "Bearer other" } }))
      .status,
    404,
  );
  assert.equal(
    (
      await app.request(`${path}/cancel`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          expectedVersion: pending.version,
          action: "combine",
        }),
      })
    ).status,
    400,
  );
  const cancelled = await app.request(`${path}/cancel`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedVersion: pending.version }),
  });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).data.status, "cancelled");
  assert.equal(f.supplied.length, 0);
});
