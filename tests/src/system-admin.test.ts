import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant, type Knex } from "@lib/database";
import * as memory from "@lib/memory";
import { rememberSchema } from "@lib/shared/contracts";
import { createApp } from "../../packages/api/src/app.ts";
import { budgetedInference } from "../../lib/memory/src/processing.ts";
import { billingAllows } from "../../lib/memory/src/billing-quotas.ts";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Use a disposable test database");
const authority = createDatabase(url);
const name = `grove_admin_${randomUUID().replaceAll("-", "")}_test`;
let owner: Knex, db: Knex, worker: Knex;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = (source: string) => {
    const parsed = new URL(source);
    parsed.pathname = `/${name}`;
    return parsed.href;
  };
  owner = createDatabase(target(url));
  await owner.migrate.latest();
  db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
});
after(async () => {
  await Promise.all([db?.destroy(), worker?.destroy(), owner?.destroy()]);
  await authority.raw("DROP DATABASE ??", [name]);
  await authority.destroy();
});
async function account() {
  const subject = `user_${randomUUID()}`;
  const {
    rows: [row],
  } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  return {
    ...memory.sessionPrincipal(row.id, subject),
    sessionId: `sess_${randomUUID()}`,
  };
}
function administration() {
  assert.equal(
    typeof memory.SystemAdministration,
    "function",
    "protected system administration must be implemented",
  );
  return new memory.SystemAdministration(
    new memory.MemoryService(
      db,
      "system-admin-fixture-cursor-secret-32-characters",
    ),
  );
}
async function adminAccount() {
  const principal = await account();
  await owner("account_administration").insert({
    accountId: principal.accountId,
    role: "system_admin",
  });
  return principal;
}
const change = (target: string, overrides = {}) => ({
  accountId: target,
  operationId: randomUUID(),
  expectedVersion: 0,
  role: "user",
  access: "pro",
  reason: "Approved complimentary access",
  ...overrides,
});

test("only current website system admins can see account metadata or change access", async () => {
  const api = administration(),
    ordinary = await account(),
    admin = await adminAccount();
  assert.deepEqual(await api.status(ordinary), { role: "user" });
  assert.deepEqual(await api.status(admin), { role: "system_admin" });
  for (const principal of [
    ordinary,
    { ...admin, type: "key" as const },
    { ...admin, type: "oauth" as const },
  ]) {
    await assert.rejects(api.accounts(principal), { status: 403 });
    await assert.rejects(api.change(principal, change(ordinary.accountId)), {
      status: 403,
    });
    await assert.rejects(api.audit(principal), { status: 403 });
  }
  const rows = await api.accounts(admin, [ordinary.subject]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].accountId, ordinary.accountId);
  assert.deepEqual(
    Object.keys(rows[0]).sort(),
    [
      "access",
      "accountId",
      "createdAt",
      "role",
      "status",
      "subject",
      "version",
    ].sort(),
  );
  await assert.rejects(api.accounts({ ...admin, subject: ordinary.subject }), {
    status: 403,
  });
  await owner("session_revocations").insert({ id: admin.sessionId });
  await assert.rejects(api.accounts(admin), { status: 401 });
});

test("access changes are versioned, audited, retry-safe and never alter subscriptions", async () => {
  const api = administration(),
    admin = await adminAccount(),
    target = await account();
  const input = change(target.accountId);
  const first = await api.change(admin, input);
  assert.equal(first.access, "pro");
  assert.equal(first.version, 1);
  assert.deepEqual(await api.change(admin, input), first);
  await assert.rejects(api.change(admin, { ...input, access: "unlimited" }), {
    status: 409,
  });
  await assert.rejects(api.change(admin, change(target.accountId)), {
    status: 409,
  });
  const unlimited = await api.change(
    admin,
    change(target.accountId, { expectedVersion: 1, access: "unlimited" }),
  );
  assert.equal(unlimited.version, 2);
  const restored = await api.change(
    admin,
    change(target.accountId, { expectedVersion: 2, access: "default" }),
  );
  assert.equal(restored.access, "default");
  const audit = (await api.audit(admin)).filter(
    (row) => row.accountId === target.accountId,
  );
  assert.equal(audit.length, 3);
  assert.equal(audit[0].actorId, admin.accountId);
  assert.equal(audit[0].reason, input.reason);
  assert.equal(audit[0].before.access, "unlimited");
  assert.equal(audit[0].after.access, "default");
  assert.equal((await owner("billing_subscriptions")).length, 0);
  for (const bad of [
    { reason: "" },
    { role: "owner" },
    { access: "free" },
    { expectedVersion: -1 },
    { extra: true },
  ])
    await assert.rejects(
      api.change(admin, { ...change(target.accountId), ...bad }),
    );
});

test("concurrent edits cannot silently overwrite and revoked admins lose access immediately", async () => {
  const api = administration(),
    admin = await adminAccount(),
    target = await account();
  const results = await Promise.allSettled([
    api.change(admin, change(target.accountId, { access: "pro" })),
    api.change(admin, change(target.accountId, { access: "unlimited" })),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const promoted = await api.change(
    admin,
    change(target.accountId, {
      expectedVersion: 1,
      role: "system_admin",
      access: "default",
    }),
  );
  assert.equal(promoted.role, "system_admin");
  await api.change(target, change(admin.accountId, { role: "user" }));
  await assert.rejects(api.accounts(admin), { status: 403 });
  await assert.rejects(
    api.change(admin, change(target.accountId, { expectedVersion: 2 })),
    { status: 403 },
  );
});

test("runtime and workers cannot directly write roles, read other tenants, bootstrap or mutate audit", async () => {
  const api = administration(),
    admin = await adminAccount(),
    target = await account();
  await api.change(admin, change(target.accountId));
  for (const connection of [db, worker]) {
    assert.equal((await connection("account_administration")).length, 0);
    await tenant(connection, target.accountId, async (trx) => {
      assert.equal((await trx("account_administration")).length, 1);
      await assert.rejects(
        trx("account_administration").update({ role: "system_admin" }),
        /permission denied/,
      );
    });
    await assert.rejects(
      connection("system_admin_audit").select(),
      /permission denied/,
    );
    await assert.rejects(
      connection.raw("SELECT grove_bootstrap_system_admin(?,?)", [
        target.subject,
        "bootstrap attempt",
      ]),
      /permission denied/,
    );
  }
  await assert.rejects(
    tenant(worker, admin.accountId, (trx) =>
      trx.raw("SELECT grove_admin_accounts(NULL)"),
    ),
    /permission denied/,
  );
  await assert.rejects(
    tenant(db, target.accountId, (trx) =>
      trx.raw("SELECT grove_admin_accounts(NULL)"),
    ),
    /system_admin_required/,
  );
  const service = new memory.MemoryService(
    db,
    "system-admin-fixture-cursor-secret-32-characters",
  );
  const note = await service.remember(
    target,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Private note canary",
      kind: "fact",
      source: { agent: "website" },
    }),
  );
  await assert.rejects(service.get(admin, note.id), { status: 404 });
});

test("last active admin cannot be removed and unavailable accounts cannot receive grants", async () => {
  const api = administration();
  await owner("account_administration").update({ role: "user" });
  const admin = await adminAccount(),
    target = await account();
  await assert.rejects(api.change(admin, change(admin.accountId)), {
    code: "last_system_admin",
    status: 409,
  });
  await owner("accounts")
    .where({ id: target.accountId })
    .update({ status: "deleting" });
  await assert.rejects(api.change(admin, change(target.accountId)), {
    status: 404,
  });
});

test("owner-only bootstrap is explicit, idempotent and limited to an existing active identity", async () => {
  administration();
  await owner("account_administration").update({ role: "user" });
  const target = await account();
  await assert.rejects(
    owner.raw("SELECT grove_bootstrap_system_admin(?,?)", [
      "user_missing",
      "Approved owner bootstrap",
    ]),
    /account_unavailable/,
  );
  const run = () =>
    owner.raw("SELECT grove_bootstrap_system_admin(?,?) AS id", [
      target.subject,
      "Approved owner bootstrap",
    ]);
  assert.equal((await run()).rows[0].id, target.accountId);
  assert.equal((await run()).rows[0].id, target.accountId);
  await assert.rejects(
    owner.raw("SELECT grove_bootstrap_system_admin(?,?)", [
      (await account()).subject,
      "Unapproved additional owner",
    ]),
    /already_bootstrapped/,
  );
  assert.equal(
    (
      await owner("system_admin_audit").where({
        accountId: target.accountId,
        kind: "bootstrap",
      })
    ).length,
    1,
  );
});

test("Pro and unlimited grants apply in API and worker without enabling billing or bypassing tenant isolation", async () => {
  const api = administration(),
    admin = await adminAccount(),
    target = await account();
  for (const connection of [db, worker])
    memory.configureBillingQuotas(connection, {
      enabled: async () => false,
      priceIds: ["price_pro"],
    });
  const check = (connection: Knex) =>
    tenant(connection, target.accountId, async (trx) => ({
      usage: await memory.billingUsage(connection, trx, target.accountId),
      allows: await billingAllows(
        connection,
        trx,
        target.accountId,
        "generation",
        201,
      ),
    }));
  assert.equal((await check(db)).usage, null);
  await api.change(admin, change(target.accountId));
  assert.equal((await check(db)).usage?.plan, "pro");
  assert.equal((await check(worker)).allows, false);
  await api.change(
    admin,
    change(target.accountId, { expectedVersion: 1, access: "unlimited" }),
  );
  for (const connection of [db, worker]) {
    const state = await check(connection);
    assert.equal(state.usage?.plan, "unlimited");
    assert.equal(state.usage?.metrics.generation.monthlyLimit, null);
    assert.equal(state.allows, true);
  }
  await api.change(
    admin,
    change(target.accountId, { expectedVersion: 2, access: "default" }),
  );
  memory.configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: ["price_pro"],
  });
  assert.equal((await check(db)).usage?.plan, "free");
  await tenant(db, target.accountId, async (trx) => {
    await trx("billing_customers").insert({
      accountId: target.accountId,
      customerId: "cus_grant",
    });
    await trx("billing_subscriptions").insert({
      id: "sub_grant",
      accountId: target.accountId,
      customerId: "cus_grant",
      priceId: "price_pro",
      status: "active",
      periodEnd: new Date(Date.now() + 86400000),
    });
  });
  assert.equal((await check(db)).usage?.plan, "pro");
});

test("HTTP admin endpoints deny agents and ordinary users before identity lookup, search exact email and keep private responses", async () => {
  const admin = await adminAccount(),
    ordinary = await account();
  let lookups = 0;
  const app = createApp({
    memories: new memory.MemoryService(
      db,
      "system-admin-fixture-cursor-secret-32-characters",
    ),
    auth: {
      principal: async (request) =>
        request.headers.get("authorization") === "Bearer owner"
          ? admin
          : request.headers.get("authorization") === "Bearer agent"
            ? { ...admin, type: "key" as const }
            : ordinary,
    },
    adminDirectory: {
      find: async (email: string) => {
        lookups++;
        assert.equal(email, "person@example.com");
        return [ordinary.subject];
      },
      users: async (subjects: string[]) =>
        subjects.map((subject) => ({
          subject,
          name: "Example Person",
          email: "person@example.com",
        })),
    },
    origin: "https://api.example",
    siteUrl: "https://site.example",
    issuer: "https://clerk.example",
    webhookSecret: "fixture",
    ready: async () => {},
  });
  const search = (token: string, query = "person@example.com") =>
    app.request("/v1/admin/accounts/search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin: "https://site.example",
      },
      body: JSON.stringify({ query }),
    });
  for (const token of ["ordinary", "agent"])
    assert.equal((await search(token)).status, 403);
  assert.equal(lookups, 0);
  const response = await search("owner");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = (await response.json()).data;
  assert.equal(result.length, 1);
  assert.equal(result[0].accountId, ordinary.accountId);
  assert.equal(result[0].email, "person@example.com");
  assert.equal((await search("owner", ordinary.subject)).status, 200);
  assert.equal(lookups, 1, "user ID search does not query email");
  assert.equal((await search("owner", "partial")).status, 400);
  assert.equal(
    (
      await app.request("/v1/admin/accounts", {
        method: "PATCH",
        headers: {
          authorization: "Bearer owner",
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify(change(ordinary.accountId)),
      })
    ).status,
    403,
  );
  const update = await app.request("/v1/admin/accounts", {
    method: "PATCH",
    headers: {
      authorization: "Bearer owner",
      origin: "https://site.example",
      "content-type": "application/json",
    },
    body: JSON.stringify(change(ordinary.accountId)),
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).data.access, "pro");
  assert.equal(
    (
      await app.request("/v1/admin/audit", {
        headers: { authorization: "Bearer owner" },
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (
      await (
        await app.request("/v1/admin", {
          headers: { authorization: "Bearer ordinary" },
        })
      ).json()
    ).data,
    { role: "user" },
  );
});

test("unlimited permits plan-exhausted dispatch but retains the installation daily safety cap", async () => {
  const api = administration(),
    admin = await adminAccount(),
    target = await account();
  memory.configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: ["price_pro"],
  });
  await tenant(db, target.accountId, (trx) =>
    trx("inference_usage").insert({
      accountId: target.accountId,
      role: "generation",
      requests: 100,
    }),
  );
  let calls = 0;
  const dispatch = () =>
    budgetedInference(
      db,
      target.accountId,
      "generation",
      102,
      async () => ++calls,
    );
  await assert.rejects(dispatch());
  await api.change(admin, change(target.accountId, { access: "unlimited" }));
  await dispatch();
  await dispatch();
  assert.equal(calls, 2);
  await assert.rejects(dispatch());
  assert.equal(calls, 2);
});

test("narrow admin functions work under a non-superuser owner without opening private tenant tables", async () => {
  const api = administration(),
    admin = await adminAccount(),
    target = await account();
  const role = `admin_owner_${randomUUID().replaceAll("-", "")}`;
  const tables = ["accounts", "account_administration", "system_admin_audit"];
  const functions = [
    "grove_admin_guard()",
    "grove_admin_state(uuid)",
    "grove_admin_accounts(text[])",
    "grove_admin_change(uuid,uuid,integer,text,text,text)",
    "grove_admin_audit()",
    "grove_bootstrap_system_admin(text,text)",
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
    assert.equal(
      (await api.accounts(admin, [target.subject]))[0].accountId,
      target.accountId,
    );
    assert.equal(
      (await api.change(admin, change(target.accountId))).access,
      "pro",
    );
    assert.equal(
      (await tenant(db, admin.accountId, (trx) => trx("accounts"))).length,
      1,
    );
    assert.equal((await db("accounts")).length, 0);
  } finally {
    for (const table of tables)
      await owner.raw("ALTER TABLE ?? OWNER TO ??", [table, original]);
    for (const signature of functions)
      await owner.raw(`ALTER FUNCTION ${signature} OWNER TO ??`, [original]);
    await owner.raw("REVOKE ALL ON SCHEMA public FROM ??", [role]);
    await authority.raw("DROP ROLE ??", [role]);
  }
});

test("a session revoked while waiting for the admin serialization lock cannot read account metadata", async () => {
  const api = administration(),
    admin = await adminAccount();
  const blocker = await owner.transaction();
  await blocker.raw("SELECT pg_advisory_xact_lock(68142025)");
  const pending = api.accounts(admin);
  // Observe the actual lock wait instead of guessing how long authorization takes.
  try {
    const deadline = Date.now() + 5000;
    while (true) {
      const {
        rows: [row],
      } = await owner.raw(
        "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'",
      );
      if (row.count > 0) break;
      assert(
        Date.now() < deadline,
        "admin operation must reach its serialization lock",
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await owner("session_revocations").insert({ id: admin.sessionId });
    await blocker.commit();
    await assert.rejects(pending, { status: 401 });
  } finally {
    if (!blocker.isCompleted()) await blocker.rollback();
    await pending.catch(() => {});
  }
});
