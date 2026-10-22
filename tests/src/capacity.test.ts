import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import { createDatabase, tenant, withDatabaseSignal } from "@lib/database";
import { Tasks, withMemoryOperation } from "@lib/memory";
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

test("background transactions preserve authorization without charging foreground admission", async () => {
  const principal = fixture.principals[0];
  const count = async () =>
    Number(
      (
        await fixture
          .admin("rate_buckets")
          .where({ accountId: principal.accountId })
          .sum("count as total")
          .first()
      )?.total ?? 0,
    );
  const before = await count();
  await tenant(fixture.workerDb, principal.accountId, (trx) =>
    fixture.worker
      .inTransaction(trx)
      .access(principal, "memory:read", async () => {}),
  );
  assert.equal(await count(), before);
  const revoked = { ...principal, sessionId: randomUUID() };
  await fixture.admin("session_revocations").insert({ id: revoked.sessionId });
  await assert.rejects(
    tenant(fixture.db, principal.accountId, (trx) =>
      fixture.service
        .inTransaction(trx)
        .access(revoked, "memory:read", async () =>
          assert.fail("Revoked work ran"),
        ),
    ),
    { code: "unauthorized" },
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

for (const sized of [false, true]) {
  test(`a stalled ${sized ? "fixed-length" : "chunked"} body owns admission and observes the request deadline`, async () => {
    const reading = deferred();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          source = controller;
        },
        pull() {
          reading.resolve();
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const server = app({
      capacity: { concurrency: 1, queued: 0, requestTimeoutMs: 500 },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      body,
      duplex: "half",
      headers: {
        authorization: "Bearer 0",
        "content-type": "application/json",
        ...(sized ? { "content-length": "2" } : {}),
      },
    };
    const pending = server.request(
      new Request("http://localhost/v1/memories/search", init),
    );
    try {
      await reading.promise;
      assert.equal((await server.request("/health/live")).status, 200);
      assert.equal((await server.request("/missing")).status, 503);
      const response = await Promise.race([
        pending,
        setTimeout(2000).then(() => {
          throw new Error("Body ignored the request deadline");
        }),
      ]);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, "request_timeout");
      assert.equal(cancelled, true);
      assert.equal((await server.request("/missing")).status, 404);
    } finally {
      if (!cancelled) {
        source.enqueue(new TextEncoder().encode("{}"));
        source.close();
      }
      await pending;
    }
  });
}

test("body limits check received bytes even when Content-Length understates them", async () => {
  const response = await app().request("/v1/memories/search", {
    method: "POST",
    headers: {
      authorization: "Bearer 0",
      "content-type": "application/json",
      "content-length": "2",
    },
    body: "{}" + " ".repeat(128 * 1024),
  });
  assert.equal(response.status, 413);
});

test("the Node HTTP adapter returns a deadline response to an unfinished upload", async () => {
  const server = serve({
    fetch: app({
      capacity: { concurrency: 1, queued: 0, requestTimeoutMs: 500 },
    }).fetch,
    hostname: "127.0.0.1",
    port: 0,
  });
  if (!server.listening)
    await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const request = httpRequest(
    `http://127.0.0.1:${address.port}/v1/memories/search`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer 0",
        "content-type": "application/json",
      },
    },
  );
  try {
    const response = new Promise<{ status: number | undefined; body: string }>(
      (resolve, reject) => {
        request.on("error", reject);
        request.setTimeout(4000, () =>
          request.destroy(new Error("Upload deadline was not enforced")),
        );
        request.on("response", (incoming) => {
          let body = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk) => {
            body += chunk;
          });
          incoming.on("error", reject);
          incoming.on("end", () =>
            resolve({ status: incoming.statusCode, body }),
          );
        });
      },
    );
    request.write("{"); // Keep the chunked body open after headers have arrived.
    const result = await response;
    assert.equal(result.status, 503);
    assert.equal(JSON.parse(result.body).error.code, "request_timeout");
  } finally {
    request.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("interactive saturation leaves foreground reads available and cancellation reaches inference", async () => {
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
  const inference = deferred();
  const controller = new AbortController();
  let stopped = false;
  fixture.service.providers.embedding = {
    ...embedder,
    async embed(_text, _purpose, options) {
      assert.ok(options?.signal);
      inference.resolve();
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
    const pending = app().request("/v1/memories/search", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: "Bearer 0",
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "garden" }),
    });
    await inference.promise;
    controller.abort();
    const result = await pending;
    assert.equal(result.status, 503);
    assert.equal(stopped, true);
  } finally {
    controller.abort();
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

for (const interruption of ["deadline", "client", "storage"] as const) {
  test(`${interruption} interruption closes queued export storage and releases its interactive permit`, async () => {
    const task = await new Tasks(fixture.service, true).export(
      fixture.principals[0],
      {
        id: randomUUID(),
        includeDescendants: false,
      },
    );
    const content = Buffer.from('{"type":"fixture"}\n');
    await fixture
      .admin("background_tasks")
      .where({ id: task.id })
      .update({
        status: "succeeded",
        result: JSON.stringify({
          key: "fixture.ndjson",
          bytes: content.length,
        }),
      });
    const closed = deferred();
    let source: Readable | undefined,
      held = true;
    const server = app({
      capacity: {
        interactiveConcurrency: 1,
        interactiveTimeoutMs: 3000,
        queueTimeoutMs: 20,
      },
      artifacts: {
        async ready() {},
        async write() {},
        async remove() {},
        async read(_key, signal) {
          source = new Readable({ read() {}, signal });
          source.once("close", closed.resolve);
          source.push(content);
          if (!held) source.push(null);
          return source;
        },
      },
    });
    const download = () =>
      server.request(`/v1/tasks/${task.id}/download`, {
        headers: { authorization: "Bearer 0" },
      });
    try {
      const response = await download();
      assert.equal(response.status, 200);
      assert.equal(
        (await download()).status,
        503,
        "stream owns its interactive permit",
      );
      assert.equal(
        (
          await server.request("/v1/projects", {
            headers: { authorization: "Bearer 0" },
          })
        ).status,
        200,
        "foreground reads retain capacity",
      );
      if (interruption === "client") await response.body!.cancel();
      else {
        const failed = assert.rejects(
          response.text(),
          interruption === "deadline" ? /too long/ : /aborted/,
        );
        if (interruption === "storage")
          source!.destroy(new Error("Interrupted fixture storage"));
        await failed;
      }
      await closed.promise;
      assert.equal(source!.destroyed, true);
      held = false;
      const next = await download();
      assert.equal(next.status, 200);
      assert.equal(await next.text(), content.toString());
    } finally {
      source?.destroy();
    }
  });
}
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
