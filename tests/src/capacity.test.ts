import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { createDatabase, tenant, withDatabaseSignal } from "@lib/database";
import { withMemoryOperation } from "@lib/memory";
import { listSchema } from "@lib/shared/contracts";
import { capacityFixture } from "./fixtures/capacity.ts";
import { createApp } from "../../packages/api/src/app.ts";

let fixture: Awaited<ReturnType<typeof capacityFixture>>;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
before(async () => {
  fixture = await capacityFixture({ accounts: 2, notes: 100 });
});

test("same-account reads overlap, internal checks count once, and failed work retains admission", async () => {
  await fixture.admin("rate_buckets").delete();
  const entered = deferred(),
    release = deferred();
  const principal = fixture.principals[0];
  const first = withMemoryOperation(() =>
    fixture.service.access(principal, "memory:read", async () => {
      entered.resolve();
      await release.promise;
    }),
  );
  await entered.promise;
  try {
    // This used to wait on the first operation's minute row until its whole read committed.
    await fixture.service.access(principal, "memory:read", async () => {});
    const count = await fixture
      .admin("rate_buckets")
      .sum("count as total")
      .first();
    assert.equal(Number(count?.total), 2);
  } finally {
    release.resolve();
    await first;
  }
  await assert.rejects(
    withMemoryOperation(async () => {
      await fixture.service.access(principal, "memory:read", async () => {});
      await fixture.service.access(principal, "memory:read", async () => {
        throw new Error("fixture failure");
      });
    }),
    /fixture failure/,
  );
  const count = await fixture
    .admin("rate_buckets")
    .sum("count as total")
    .first();
  assert.equal(Number(count?.total), 3);
});

test("HTTP search has one admission and cancellation rolls back a pending write", async () => {
  await fixture.admin("rate_buckets").delete();
  const response = await fixture.app.request("/v1/memories/search", {
    method: "POST",
    headers: { authorization: "Bearer 0", "content-type": "application/json" },
    body: JSON.stringify({ query: "garden", limit: 30 }),
  });
  assert.equal(response.status, 200);
  const count = await fixture
    .admin("rate_buckets")
    .sum("count as total")
    .first();
  assert.equal(Number(count?.total), 1);
  const principal = fixture.principals[0];
  const account = await fixture
    .admin("accounts")
    .where({ id: principal.accountId })
    .first();
  const controller = new AbortController();
  await assert.rejects(
    withDatabaseSignal(controller.signal, () =>
      tenant(fixture.db, principal.accountId, async (trx) => {
        await trx("accounts")
          .where({ id: principal.accountId })
          .increment("contentVersion", 1);
        controller.abort(new Error("fixture cancellation"));
      }),
    ),
    /fixture cancellation/,
  );
  assert.equal(
    (await fixture.admin("accounts").where({ id: principal.accountId }).first())
      .contentVersion,
    account.contentVersion,
  );
});

const app = (options: Partial<Parameters<typeof createApp>[0]> = {}) =>
  createApp({
    memories: fixture.service,
    auth: fixture.auth,
    origin: "http://127.0.0.1:26080",
    siteUrl: "http://127.0.0.1:3000",
    issuer: "https://clerk.example.test",
    webhookSecret: "whsec_dGVzdA==",
    ready: async () => {},
    ...options,
  });

test("bounded HTTP waiting cancels, times out, rejects excess work and recovers", async () => {
  const entered = deferred(),
    release = deferred();
  let held = true;
  const server = app({
    capacity: { concurrency: 1, queued: 1, queueTimeoutMs: 100 },
    auth: {
      async principal(request) {
        if (held) {
          entered.resolve();
          await release.promise;
        }
        return fixture.auth.principal(request);
      },
    },
  });
  const request = (signal?: AbortSignal) =>
    server.request("/v1/projects", {
      headers: { authorization: "Bearer 0" },
      signal,
    });
  const active = request();
  await entered.promise;
  try {
    const controller = new AbortController();
    const queued = request(controller.signal);
    assert.equal((await request()).status, 503);
    controller.abort();
    assert.equal((await queued).status, 503);
    const timedOut = await request();
    assert.equal(timedOut.status, 503);
    assert.equal(timedOut.headers.get("retry-after"), "1");
    assert.equal((await server.request("/health/live")).status, 200);
  } finally {
    held = false;
    release.resolve();
  }
  assert.equal((await active).status, 200);
  assert.equal((await request()).status, 200);
});

test("interactive saturation leaves foreground reads available and deadlines cancel inference", async () => {
  const entered = deferred(),
    release = deferred();
  const server = app({
    capacity: { interactiveConcurrency: 1, queueTimeoutMs: 10 },
    auth: {
      async principal(request) {
        if (new URL(request.url).pathname === "/v1/models/test") {
          entered.resolve();
          await release.promise;
        }
        return fixture.auth.principal(request);
      },
    },
  });
  const held = server.request("/v1/models/test", {
    method: "POST",
    headers: { authorization: "Bearer 0", "content-type": "application/json" },
    body: JSON.stringify({ role: "embedding" }),
  });
  await entered.promise;
  try {
    assert.equal(
      (
        await server.request("/v1/projects", {
          headers: { authorization: "Bearer 0" },
        })
      ).status,
      200,
    );
  } finally {
    release.resolve();
    await held;
  }

  const embedder = fixture.service.providers.embedding!;
  let stopped = false;
  fixture.service.providers.embedding = {
    ...embedder,
    async embed(_text, _purpose, options) {
      assert.ok(options?.signal);
      await new Promise<void>((_resolve, reject) => {
        options.signal!.addEventListener(
          "abort",
          () => {
            stopped = true;
            reject(options.signal!.reason);
          },
          { once: true },
        );
      });
      return [];
    },
  };
  try {
    const deadline = app({ capacity: { requestTimeoutMs: 500 } });
    const result = await deadline.request("/v1/memories/search", {
      method: "POST",
      headers: {
        authorization: "Bearer 0",
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "garden" }),
    });
    assert.equal(result.status, 503);
    assert.equal((await result.json()).error.code, "request_timeout");
    assert.equal(stopped, true);
  } finally {
    fixture.service.providers.embedding = embedder;
  }
});

test("pool acquisition and SQL timeouts are bounded and connections recover", async () => {
  const db = createDatabase(fixture.databaseUrl, {
    max: 1,
    acquireTimeoutMs: 100,
    statementTimeoutMs: 100,
  });
  try {
    const trx = await db.transaction();
    try {
      await assert.rejects(
        db.raw("SELECT 1"),
        /Timeout acquiring a connection/,
      );
    } finally {
      await trx.rollback();
    }
    await assert.rejects(
      tenant(db, fixture.principals[0].accountId, (t) =>
        t.raw("SELECT pg_sleep(1)"),
      ),
      /statement timeout/,
    );
    assert.equal((await db.raw("SELECT 1 AS ready")).rows[0].ready, 1);
  } finally {
    await db.destroy();
  }
});

test("interrupted exports fail the download and release their interactive permit", async () => {
  const original = fixture.service.exportPage.bind(fixture.service);
  const entered = deferred(),
    release = deferred();
  fixture.service.exportPage = async (principal, after) => {
    if (after) {
      entered.resolve();
      await release.promise;
    }
    return original(principal, after);
  };
  const server = app({
    capacity: { interactiveConcurrency: 1, interactiveTimeoutMs: 3000 },
  });
  try {
    const response = await server.request("/v1/account/export", {
      headers: { authorization: "Bearer 0" },
    });
    assert.equal(response.status, 200);
    const download = assert.rejects(response.text(), /too long/);
    await entered.promise;
    await download;
  } finally {
    fixture.service.exportPage = original;
    release.resolve();
  }
  const next = await server.request("/v1/account/export", {
    headers: { authorization: "Bearer 0" },
  });
  assert.equal(next.status, 200);
  await next.body!.cancel();
});
after(async () => {
  await fixture?.close();
});

test("a session revoked during an account-lock wait cannot start admitted work", async () => {
  const principal = { ...fixture.principals[0], sessionId: randomUUID() };
  await withMemoryOperation(async () => {
    // Admission has already committed; exercise the post-inference reauthorization.
    await fixture.service.access(principal, "memory:read", async () => {});
    const blocker = await fixture.admin.transaction();
    await blocker("accounts")
      .where({ id: principal.accountId })
      .forUpdate()
      .first();
    let ran = false;
    const result = fixture.service
      .access(principal, "memory:read", async () => {
        ran = true;
      })
      .then(
        () => null,
        (error: { code?: string }) => error,
      );
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const state = await fixture.admin.raw(
          "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%accounts%' LIMIT 1",
        );
        if (state.rows.length) {
          waiting = true;
          break;
        }
        await setTimeout(10);
      }
      assert.ok(
        waiting,
        "Service must actually be waiting for the held account lock",
      );
      await blocker("session_revocations").insert({ id: principal.sessionId });
      await blocker.commit();
      assert.equal((await result)?.code, "unauthorized");
      assert.equal(ran, false);
    } finally {
      if (!blocker.isCompleted()) await blocker.rollback();
      await result;
    }
  });
});

test("presentation query budget is independent of page size, with tenant and revision fences", async () => {
  const principal = fixture.principals[0];
  const list = async (limit: number) => {
    let queries = 0;
    const onQuery = () => queries++;
    fixture.db.on("query", onQuery);
    try {
      return {
        page: await fixture.service.list(
          principal,
          listSchema.parse({ limit }),
        ),
        queries,
      };
    } finally {
      fixture.db.off("query", onQuery);
    }
  };
  const small = await list(1),
    large = await list(100);
  assert.equal(small.queries, large.queries);
  assert.ok(large.queries <= 25, `Page used ${large.queries} SQL queries`);
  assert.equal(large.page.items.length, 100);
  assert.ok(
    large.page.items.every(
      (item) =>
        item.indexing === "ready" && item.enrichment?.status === "ready",
    ),
  );
  const foreign = await fixture.service.list(
    fixture.principals[1],
    listSchema.parse({ limit: 100 }),
  );
  assert.ok(
    foreign.items.every(
      (item) => !large.page.items.some((own) => own.id === item.id),
    ),
  );

  const [stale, failed, archived, expired] = large.page.items;
  await fixture
    .admin("memories")
    .where({ id: stale.id })
    .update({ version: 2 });
  await fixture
    .admin("memory_embeddings")
    .where({ memoryId: failed.id })
    .delete();
  await fixture.admin("jobs").insert({
    accountId: principal.accountId,
    memoryId: failed.id,
    version: 1,
    kind: "embedding",
    profile: fixture.providers.embedding!.profile,
    target: failed.id,
    failedAt: new Date(),
  });
  await fixture
    .admin("memories")
    .where({ id: archived.id })
    .update({ status: "archived" });
  await fixture
    .admin("memories")
    .where({ id: expired.id })
    .update({
      retentionDays: 1,
      expiresAt: new Date(0),
      purgeAt: new Date(86400000),
    });
  const updated = (await list(100)).page.items;
  assert.equal(
    updated.find((item) => item.id === stale.id)?.indexing,
    "pending",
  );
  assert.equal(
    updated.find((item) => item.id === stale.id)?.enrichment?.status,
    "disabled",
  );
  assert.equal(
    updated.find((item) => item.id === failed.id)?.indexing,
    "failed",
  );
  assert.ok(
    !updated.some((item) => item.id === archived.id || item.id === expired.id),
  );
  const historical = await fixture.service.list(
    principal,
    listSchema.parse({ status: "archived" }),
  );
  assert.equal(historical.items[0].indexing, "disabled");
  assert.equal(historical.items[0].enrichment?.status, "disabled");
  await fixture
    .admin("accounts")
    .where({ id: principal.accountId })
    .update({ classificationEnabled: false, titlesTagsEnabled: false });
  assert.ok(
    (await list(100)).page.items.every(
      (item) =>
        item.enrichment?.status === "disabled" &&
        !item.enrichment.title &&
        !item.enrichment.suggestedKind &&
        !item.enrichment.tags.length,
    ),
  );
});
