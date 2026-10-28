import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant, type Knex } from "@lib/database";
import {
  MemoryService,
  SystemAdministration,
  sessionPrincipal,
} from "@lib/memory";
import { createApp } from "../../packages/api/src/app.ts";
import { AdminAccounts } from "../../packages/api/src/system-admin.ts";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(url && new URL(url).pathname.endsWith("_test"));
const authority = createDatabase(url);
const name = `grove_reports_${randomUUID().replaceAll("-", "")}_test`;
let owner: Knex, db: Knex, worker: Knex;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = (value: string) => {
    const u = new URL(value);
    u.pathname = `/${name}`;
    return u.href;
  };
  owner = createDatabase(target(url));
  await owner.migrate.latest();
  db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
});
after(async () => {
  await Promise.all([owner?.destroy(), db?.destroy(), worker?.destroy()]);
  await authority.raw("DROP DATABASE ??", [name]);
  await authority.destroy();
});
const service = () =>
  new MemoryService(db, "admin-usage-cursor-secret-32-characters");
async function account(admin = false) {
  const subject = `user_${randomUUID()}`;
  const {
    rows: [row],
  } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  if (admin)
    await owner("account_administration").insert({
      accountId: row.id,
      role: "system_admin",
    });
  return {
    ...sessionPrincipal(row.id, subject),
    sessionId: `sess_${randomUUID()}`,
  };
}

test("reports aggregate feature usage across users without pooling actions or exposing content", async () => {
  const admin = await account(true),
    a = await account(),
    b = await account();
  const day = "2026-08-15",
    period = "2026-08-01";
  for (const [principal, units] of [
    [a, 5],
    [b, 1],
  ] as const) {
    await owner("action_usage").insert({
      accountId: principal.accountId,
      metric: "ask",
      operation: randomUUID(),
      period,
      units,
      status: "completed",
      leaseId: randomUUID(),
      leaseUntil: new Date(),
      createdAt: `${day}T23:50:00Z`,
    });
    await owner("inference_usage").insert({
      accountId: principal.accountId,
      day,
      role: "generation",
      requests: units,
      inputTokens: 100,
      outputTokens: 20,
    });
    await owner("memories").insert({
      accountId: principal.accountId,
      content: "PRIVATE_REPORT_CANARY",
      kind: "fact",
      source: {},
    });
  }
  await owner("action_usage").insert({
    accountId: a.accountId,
    metric: "recall",
    operation: randomUUID(),
    period,
    units: 5,
    status: "released",
    leaseId: randomUUID(),
    leaseUntil: new Date(),
    createdAt: `${day}T12:00:00Z`,
  });
  await owner("research_account_usage").insert({
    accountId: b.accountId,
    day,
    calls: 3,
  });
  await owner("speech_usage").insert({
    accountId: b.accountId,
    day,
    kind: "speech_synthesize",
    requests: 2,
    units: 700,
    durationMs: 120000,
  });
  const api = new SystemAdministration(service());
  assert.equal(
    typeof api.usageReport,
    "function",
    "cross-user usage reporting must be implemented",
  );
  const report = await api.usageReport(admin, { from: day, to: day });
  assert.equal(report.totals.metrics.ask.used, 1.2);
  assert.equal(report.totals.metrics.ask.requests, 2);
  assert.equal(report.totals.metrics.ask.cached, 1);
  assert.equal(report.totals.metrics.ask.fresh, 1);
  assert.equal(report.totals.metrics.recall.used, 0);
  assert.equal(report.totals.metrics.generation.used, 6);
  assert.equal(report.totals.metrics.generation.inputTokens, 200);
  assert.equal(report.totals.metrics.research.used, 3);
  assert.equal(report.totals.metrics.synthesis.used, 120000);
  assert.equal(report.totals.metrics.synthesis.requests, 2);
  assert.equal(report.totals.activeUsers, 2);
  assert.equal(
    report.days.find((row) => row.day === day && row.feature === "ask")?.used,
    1.2,
  );
  assert(!JSON.stringify(report).includes("PRIVATE_REPORT_CANARY"));
  const user = report.users.accounts.find(
    (row) => row.accountId === b.accountId,
  )!;
  assert.equal(user.metrics.ask.used, 0.2);
  assert.equal(report.totals.current.notes >= 2, true);
  const other = await api.usageReport(admin, {
    from: "2026-08-16",
    to: "2026-08-16",
  });
  assert.equal(other.totals.metrics.ask.used, 0);
  assert.equal(other.totals.metrics.generation.used, 0);
});

test("report authority is current, website-only, private and independent of purchases", async () => {
  const admin = await account(true),
    user = await account();
  const api = new SystemAdministration(service());
  for (const principal of [
    user,
    { ...admin, type: "key" as const },
    { ...admin, type: "oauth" as const },
    { ...admin, subject: user.subject },
  ]) {
    await assert.rejects(api.usageReport(principal, { from: "bad" }), {
      status: 403,
    });
  }
  await tenant(worker, admin.accountId, async (trx) => {
    await assert.rejects(
      trx.raw("SELECT grove_admin_usage_report(NULL,NULL,NULL)"),
      /permission denied/,
    );
  });
  let identityReads = 0;
  const app = createApp({
    memories: service(),
    auth: { principal: async () => admin },
    adminDirectory: {
      find: async () => [],
      users: async (subjects) => {
        identityReads++;
        return subjects.map((subject) => ({
          subject,
          name: "Report account",
          email: null,
        }));
      },
    },
    origin: "https://api.example",
    siteUrl: "https://site.example",
    issuer: "https://clerk.example",
    webhookSecret: "fixture",
    ready: async () => {},
  });
  const response = await app.request("/v1/admin/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(
    (await response.json()).data.users.accounts[0].name,
    "Report account",
  );
  assert.equal(identityReads, 1);
  await owner("session_revocations").insert({ id: admin.sessionId });
  await assert.rejects(api.usageReport(admin, {}), { status: 401 });
});

test("reports bound UTC date ranges and paginate all users without changing global totals", async () => {
  const admin = await account(true),
    api = new SystemAdministration(service());
  for (const input of [
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-08-02", to: "2026-08-01" },
    { from: "2020-01-01", to: "2026-01-01" },
    { from: "2099-01-01", to: "2099-01-02" },
    { from: "2026-08-01" },
    { after: "bad" },
    { feature: "private" },
  ]) {
    await assert.rejects(api.usageReport(admin, input));
  }
  for (let i = 0; i < 34; i++) await account();
  const first = await api.usageReport(admin, {});
  assert.equal(first.users.accounts.length, 30);
  assert(first.users.nextCursor);
  const second = await api.usageReport(admin, {
    after: first.users.nextCursor,
  });
  assert.deepEqual(second.totals, first.totals);
  assert(second.users.accounts.length > 0);
  assert(
    !second.users.accounts.some((row) =>
      first.users.accounts.some((old) => row.accountId === old.accountId),
    ),
  );
  await tenant(db, admin.accountId, async (trx) => {
    await trx.raw("SELECT grove_admin_usage_report(NULL,NULL,NULL)");
    assert.equal(
      (await trx.raw("SELECT current_setting('grove.account_id') AS actor"))
        .rows[0].actor,
      admin.accountId,
    );
  });
  await owner("account_administration")
    .where({ accountId: admin.accountId })
    .update({ role: "user" });
  await assert.rejects(api.usageReport(admin, {}), { status: 403 });
});

test("report identity enrichment never releases data after the operator loses access", async () => {
  const admin = await account(true);
  const api = new AdminAccounts(service(), {
    find: async () => [],
    users: async () => {
      await owner("account_administration")
        .where({ accountId: admin.accountId })
        .update({ role: "user" });
      return [];
    },
  });
  await assert.rejects(api.usageReport(admin, {}), { status: 403 });
});

test("identity-provider outages keep aggregate reports available but never bypass revoked authority", async () => {
  const admin = await account(true);
  let revoke = false;
  const api = new AdminAccounts(service(), {
    find: async () => [],
    users: async () => {
      if (revoke)
        await owner("account_administration")
          .where({ accountId: admin.accountId })
          .update({ role: "user" });
      throw new Error("Synthetic identity-directory outage");
    },
  });
  const report = await api.usageReport(admin, {});
  assert(report.totals.accounts > 0);
  assert.equal(report.users.accounts[0].name, null);
  revoke = true;
  await assert.rejects(api.usageReport(admin, {}), { status: 403 });
});

test("live action reservations and original quota periods remain distinct from provider attempt days", async () => {
  const admin = await account(true),
    user = await account();
  for (const [status, units, leaseUntil] of [
    ["reserved", 1, new Date(Date.now() + 60000)],
    ["reserved", 5, new Date(0)],
    ["released", 5, new Date()],
  ] as const) {
    await owner("action_usage").insert({
      accountId: user.accountId,
      metric: "assistance",
      operation: randomUUID(),
      period: "2026-08-01",
      createdAt: "2026-07-31T23:00:00Z",
      status,
      units,
      leaseId: randomUUID(),
      leaseUntil,
    });
  }
  const report = await new SystemAdministration(service()).usageReport(admin, {
    from: "2026-08-01",
    to: "2026-08-01",
  });
  assert.equal(report.totals.metrics.assistance.reserved, 0.2);
  assert.equal(report.totals.metrics.assistance.used, 0);
  assert.equal(report.totals.metrics.assistance.requests, 0);
});

test("report functions work under a non-superuser owner without opening tenant tables", async () => {
  const admin = await account(true),
    api = new SystemAdministration(service());
  const role = `reports_owner_${randomUUID().replaceAll("-", "")}`;
  const tables = [
    "accounts",
    "account_administration",
    "action_usage",
    "inference_usage",
    "research_account_usage",
    "speech_usage",
    "memories",
    "projects",
    "connections",
  ];
  const functions = [
    "grove_admin_guard()",
    "grove_admin_state(uuid)",
    "grove_admin_usage_rows(date,date)",
    "grove_admin_usage_report(date,date,uuid)",
  ];
  const original = (await owner.raw("SELECT current_user AS name")).rows[0]
    .name;
  await authority.raw("CREATE ROLE ?? NOLOGIN NOSUPERUSER NOBYPASSRLS", [role]);
  try {
    await owner.raw("GRANT USAGE,CREATE ON SCHEMA public TO ??", [role]);
    for (const table of tables)
      await owner.raw("ALTER TABLE ?? OWNER TO ??", [table, role]);
    for (const signature of functions)
      await owner.raw(`ALTER FUNCTION ${signature} OWNER TO ??`, [role]);
    const report = await api.usageReport(admin, {});
    assert(report.totals.accounts > 0);
    assert.deepEqual(await db("action_usage"), []);
    await assert.rejects(
      tenant(db, admin.accountId, (trx) =>
        trx.raw(
          "SELECT * FROM grove_admin_usage_rows(current_date,current_date)",
        ),
      ),
      /permission denied/,
    );
  } finally {
    for (const table of tables)
      await owner.raw("ALTER TABLE ?? OWNER TO ??", [table, original]);
    for (const signature of functions)
      await owner.raw(`ALTER FUNCTION ${signature} OWNER TO ??`, [original]);
    await owner.raw("REVOKE ALL ON SCHEMA public FROM ??", [role]);
    await authority.raw("DROP ROLE ??", [role]);
  }
});
