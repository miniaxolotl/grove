import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant } from "@lib/database";
import {
  MemoryService,
  runTask,
  configureBillingQuotas,
} from "@lib/memory";
import { resourceUsage } from "../../lib/memory/src/billing-quotas.ts";
import { resourceLimits } from "@lib/shared/billing";
import { Authentication } from "../../packages/api/src/auth.ts";
import type { Principal } from "@lib/shared/contracts";
import * as writing from "../../lib/memory/src/writing-jobs.ts";

test("AI rewrites consume a dedicated writing allowance with daily and monthly caps", async (t) => {
  assert.equal(typeof writing.WritingTools, "function");
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(
    url && new URL(url).pathname.endsWith("_test"),
    "Use a disposable database",
  );
  const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert.ok(
    migrationUrl && new URL(migrationUrl).pathname.endsWith("_test"),
    "Use a disposable migration database",
  );
  const ownerDb = createDatabase(migrationUrl),
    database = `grove_writing_limits_${randomUUID().replaceAll("-", "")}_test`;
  await ownerDb.raw("CREATE DATABASE ??", [database]);
  const target = (value: string) => {
    const parsed = new URL(value);
    parsed.pathname = `/${database}`;
    return parsed.href;
  };
  const migration = createDatabase(target(migrationUrl));
  await migration.migrate.latest();
  await migration.destroy();
  const db = createDatabase(target(url)),
    worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  const key = "31".repeat(32);
  const generation = {
    profile: "writing-limits-fixture-v1",
    async generate<T>() {
      return {
        alternatives: ["I'm Elias.", "My name's Elias.", "I am Elias."],
      } as T;
    },
  };
  const service = new MemoryService(
    db,
    "writing-limits-test-cursor-secret-32-characters",
    undefined,
    { generation },
  );
  configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: [],
    resourceLimits: {
      free: { ...resourceLimits.free, writing: 2 },
      pro: { ...resourceLimits.pro, writing: 2000 },
    },
  });
  configureBillingQuotas(worker, {
    enabled: async () => true,
    priceIds: [],
    resourceLimits: {
      free: { ...resourceLimits.free, writing: 2 },
      pro: { ...resourceLimits.pro, writing: 2000 },
    },
  });
  const api = new writing.WritingTools(service, key, notice());
  const handlers = writing.writingHandlers(service, key, worker, notice());
  const auth = new Authentication(db, {
    async verify(token) {
      return { subject: token, type: "session" as const };
    },
  });
  const makeOwner = () =>
    auth.principal(
      new Request("http://localhost/v1/me", {
        headers: { authorization: `Bearer writing_${randomUUID()}` },
      }),
    );
  const owner = await makeOwner();
  const makeClient = async (account: typeof owner, authorized = true) => {
    const clientId = randomUUID();
    const grant = {
      name: "Writing limits test",
      capabilities: ["memory:read"] as ["memory:read"],
      personal: true,
      allProjects: false,
      projectIds: [],
      writingEnabled: authorized,
    };
    const { connection } = await service.grant(account, grant, { clientId });
    return {
      accountId: account.accountId,
      subject: account.subject,
      type: "oauth",
      clientId,
      connectionId: connection.id,
      issuedAt: Date.now(),
      capabilities: ["memory:read"],
    } as Principal;
  };
  const request = (tool = "concise") => ({
    id: randomUUID(),
    sessionId: randomUUID(),
    language: "en",
    tool,
    sentence: "My name is Elias.",
  });
  const usage = (accountId: string) =>
    tenant(db, accountId, (trx) => resourceUsage(db, trx, accountId));
  const actionRows = (accountId: string) =>
    tenant(db, accountId, (trx) =>
      trx("action_usage").where({ accountId }).select("metric", "status"),
    );

  function notice() {
    return "Synthetic provider; no live transmission.";
  }

  try {
    await t.test(
      "fresh rewrites consume writing, never assistance",
      async () => {
        const client = await makeClient(owner);
        const policy = (await api.describe(client)).policy;
        await api.consent(client, { policy, accepted: true });
        const input = request();
        assert.equal((await api.request(client, input)).status, "queued");
        assert.equal(await runTask(worker, handlers, { id: input.id }), true);
        assert.equal((await api.get(client, input.id)).status, "completed");
        const rows = await actionRows(owner.accountId);
        console.log(
          "DEBUG usage:",
          JSON.stringify((await usage(owner.accountId))?.metrics?.writing),
        );
        assert.ok(
          rows.some(
            (row) => row.metric === "writing" && row.status === "completed",
          ),
          "completed rewrite must reserve the writing metric",
        );
        assert.equal(
          rows.filter((row) => row.metric === "assistance").length,
          0,
          "rewrites must not consume the assistance allowance",
        );
        const metrics = (await usage(owner.accountId))!.metrics;
        assert.equal(metrics.writing.used, 1);
        assert.equal(metrics.writing.limit, 2);
        assert.equal(metrics.assistance.used, 0);
      },
    );

    await t.test(
      "reopening the same completed request is free",
      async () => {
        const client = await makeClient(owner);
        const policy = (await api.describe(client)).policy;
        await api.consent(client, { policy, accepted: true });
        const input = request();
        await api.request(client, input);
        await runTask(worker, handlers, { id: input.id });
        const before = (await actionRows(owner.accountId)).length;
        const reopened = await api.request(client, input);
        assert.equal(reopened.status, "completed");
        assert.equal(
          (await actionRows(owner.accountId)).length,
          before,
          "replay must not reserve another action",
        );
      },
    );

    await t.test(
      "monthly writing quota rejects with a reset date",
      async () => {
        const client = await makeClient(owner);
        const policy = (await api.describe(client)).policy;
        await api.consent(client, { policy, accepted: true });
        // Account already used its 2 monthly rewrites above; the next fresh
        // request must fail while cached reopen stays free.
        const rejected = request();
        const error = await api
          .request(client, rejected)
          .then(
            () => null,
            (failure: unknown) => failure,
          );
        assert.ok(error && typeof error === "object");
        assert.equal(
          (error as { code?: string }).code,
          "usage_limit",
        );
        const resetAt = new Date(
          (error as { resetAt?: string }).resetAt!,
        );
        const firstOfNextMonth = new Date(
          Date.UTC(
            resetAt.getUTCFullYear(),
            resetAt.getUTCMonth(),
            1,
          ),
        );
        assert.equal(resetAt.getTime(), firstOfNextMonth.getTime());
        assert.match(
          (error as Error).message,
          /writing allowance is reached/,
        );
      },
    );

    await t.test(
      "quotas are per account",
      async () => {
        const second = await makeOwner();
        const client = await makeClient(second);
        const policy = (await api.describe(client)).policy;
        await api.consent(client, { policy, accepted: true });
        const input = request();
        assert.equal((await api.request(client, input)).status, "queued");
        assert.equal(await runTask(worker, handlers, { id: input.id }), true);
        assert.equal((await api.get(client, input.id)).status, "completed");
      },
    );
  } finally {
    await db.destroy();
    await worker.destroy();
    await ownerDb.raw("DROP DATABASE ?? WITH (FORCE)", [database]);
    await ownerDb.destroy();
  }
});

test(
  "daily rewrite burst cap rejects before the monthly allowance",
  { timeout: 300000 },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
    const ownerDb = createDatabase(migrationUrl),
      database =
        `grove_writing_daily_${randomUUID().replaceAll("-", "")}_test`;
    await ownerDb.raw("CREATE DATABASE ??", [database]);
    const target = (value: string) => {
      const parsed = new URL(value);
      parsed.pathname = `/${database}`;
      return parsed.href;
    };
    const migration = createDatabase(target(migrationUrl));
    await migration.migrate.latest();
    await migration.destroy();
    const db = createDatabase(target(url)),
      worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
    const key = "32".repeat(32);
    const generation = {
      profile: "writing-daily-fixture-v1",
      async generate<T>() {
        return { alternatives: ["One.", "Two.", "Three."] } as T;
      },
    };
    const service = new MemoryService(
      db,
      "writing-daily-test-cursor-secret-32-characters",
      undefined,
      { generation },
    );
    configureBillingQuotas(db, {
      enabled: async () => true,
      priceIds: [],
      resourceLimits: {
        free: { ...resourceLimits.free, writing: 2000 },
        pro: { ...resourceLimits.pro, writing: 2000 },
      },
    });
    configureBillingQuotas(worker, {
      enabled: async () => true,
      priceIds: [],
      resourceLimits: {
        free: { ...resourceLimits.free, writing: 2000 },
        pro: { ...resourceLimits.pro, writing: 2000 },
      },
    });
    const note = "Synthetic provider; no live transmission.";
    const api = new writing.WritingTools(service, key, note);
    const handlers = writing.writingHandlers(service, key, worker, note);
    const auth = new Authentication(db, {
      async verify(token) {
        return { subject: token, type: "session" as const };
      },
    });
    try {
      const owner = await auth.principal(
        new Request("http://localhost/v1/me", {
          headers: { authorization: `Bearer writing_${randomUUID()}` },
        }),
      );
      const clientId = randomUUID();
      const { connection } = await service.grant(
        owner,
        {
          name: "Writing daily test",
          capabilities: ["memory:read"] as ["memory:read"],
          personal: true,
          allProjects: false,
          projectIds: [],
          writingEnabled: true,
        },
        { clientId },
      );
      const client = {
        accountId: owner.accountId,
        subject: owner.subject,
        type: "oauth",
        clientId,
        connectionId: connection.id,
        issuedAt: Date.now(),
        capabilities: ["memory:read"],
      } as Principal;
      const policy = (await api.describe(client)).policy;
      await api.consent(client, { policy, accepted: true });
      for (let done = 0; done < 30; done++) {
        const input = {
          id: randomUUID(),
          sessionId: randomUUID(),
          language: "en",
          tool: "concise",
          sentence: `Sentence number ${done}.`,
        };
        assert.equal((await api.request(client, input)).status, "queued");
        assert.equal(await runTask(worker, handlers, { id: input.id }), true);
      }
      const error = await api
        .request(client, {
          id: randomUUID(),
          sessionId: randomUUID(),
          language: "en",
          tool: "concise",
          sentence: "One too many.",
        })
        .then(
          () => null,
          (failure: unknown) => failure,
        );
      assert.equal((error as { code?: string }).code, "usage_limit");
      assert.match((error as Error).message, /writing allowance is reached/);
      const resetAt = new Date((error as { resetAt?: string }).resetAt!);
      const tomorrow = new Date();
      tomorrow.setUTCHours(24, 0, 0, 0);
      assert.equal(resetAt.getTime(), tomorrow.getTime());
    } finally {
      await db.destroy();
      await worker.destroy();
      await ownerDb.raw("DROP DATABASE ?? WITH (FORCE)", [database]);
      await ownerDb.destroy();
    }
  },
);
