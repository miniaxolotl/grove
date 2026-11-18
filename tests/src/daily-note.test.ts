import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createDatabase, tenant } from "@lib/database";
import { MemoryService, cleanupHandlers, runTask } from "@lib/memory";
import { Authentication } from "../../packages/api/src/auth.ts";
import { createApp } from "../../packages/api/src/app.ts";
import type { Memory } from "@lib/shared/contracts";

const url = process.env.TEST_DATABASE_URL;
const workerUrl = process.env.TEST_WORKER_DATABASE_URL;
const adminUrl = process.env.TEST_MIGRATION_DATABASE_URL;
if (!url || !workerUrl || !adminUrl)
  throw new Error("Tests require disposable database URLs");
const db = createDatabase(url);
const worker = createDatabase(workerUrl);
const admin = createDatabase(adminUrl);
const service = new MemoryService(
  db,
  "test-cursor-secret-with-at-least-32-characters",
);
const subject = `user_daily_${randomUUID()}`;
const auth = new Authentication(db, {
  async verify(token) {
    return {
      subject: token.endsWith("-account") ? `${subject}_${token}` : subject,
      type: "session",
      sessionId: `sess_${token}`,
    };
  },
});
const app = createApp({
  memories: service,
  auth,
  origin: "http://127.0.0.1:53312",
  siteUrl: "http://127.0.0.1:53313",
  issuer: "https://clerk.example.test",
  webhookSecret: "whsec_dGVzdA==",
  ready: async () => {},
});
after(() => Promise.all([db.destroy(), worker.destroy(), admin.destroy()]));

const call = (path: string, body?: object, token = "first-device") =>
  app.request(`/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
async function data<T>(response: Response): Promise<T> {
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).data;
}
const daily = (day: string) => `/memories/daily/${day}`;
const draft = (content: string, extra?: object) => ({
  operationId: randomUUID(),
  content,
  ...extra,
});

test("opening a date is read-only and does not claim an ordinary note with the same heading", async () => {
  const path = daily("2026-11-17");
  const heading = "# Tuesday, November 17, 2026";
  const old = await data<Memory>(await call("/memories", draft(heading)));
  const { accountId } = await data<{ accountId: string }>(await call("/me"));
  const counts = () =>
    tenant(db, accountId, async (trx) => ({
      notes: await trx("memories").count().first(),
      revisions: await trx("memory_revisions").count().first(),
      contentVersion: (await trx("accounts").first("contentVersion"))
        .contentVersion,
    }));
  const before = await counts();
  assert.deepEqual(await data(await call(path)), { state: "empty" });
  assert.deepEqual(await counts(), before);
  const saved = await data<Memory>(await call(path, draft(heading)));
  assert.notEqual(saved.id, old.id);
  assert.deepEqual(await data(await call(path, undefined, "second-device")), {
    state: "saved",
    id: saved.id,
  });
  assert.deepEqual(await data(await call(path, undefined, "second-account")), {
    state: "empty",
  });
  const other = await data<Memory>(
    await call(path, draft("Other account"), "second-account"),
  );
  assert.notEqual(other.id, saved.id);
  assert.equal(
    (await call(`/memories/${saved.id}`, undefined, "second-account")).status,
    404,
  );
});

test("concurrent first saves from two devices have one winner and support safe operation replay", async () => {
  const path = daily("2026-11-18");
  const drafts = [draft("First tab"), draft("Second tab")];
  const results = await Promise.all(
    drafts.map((input, i) => call(path, input, `device-${i}`)),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = results.findIndex((result) => result.ok);
  const saved = await data<Memory>(results[winner]);
  assert.equal(
    (await results[1 - winner].json()).error.code,
    "daily_note_exists",
  );
  const replayed = await data<Memory>(
    await call(path, drafts[winner], `device-${winner}`),
  );
  assert.equal(replayed.id, saved.id);
  assert.equal(replayed.content, drafts[winner].content);
  assert.equal(replayed.version, 1);
  assert.deepEqual(await data(await call(path)), {
    state: "saved",
    id: saved.id,
  });
  const history = await data<unknown[]>(
    await call(`/memories/${saved.id}/revisions`),
  );
  assert.equal(history.length, 1);
  assert.equal((await call(daily("2026-11-19"), drafts[winner])).status, 409);
  assert.deepEqual(await data(await call(daily("2026-11-19"))), {
    state: "empty",
  });
});

test("daily identity survives filing, renaming, archive and restore; deletion never recreates it", async () => {
  const path = daily("2026-11-20");
  const notebook = await data<{ id: string }>(
    await call("/projects", {
      name: "Daily test notebook",
      identity: "daily-test",
    }),
  );
  const first = draft("# Original heading", { projectId: notebook.id });
  const saved = await data<Memory>(await call(path, first));
  assert.equal(saved.projectId, notebook.id);
  const updated = await data<Memory>(
    await call(
      "/memories",
      draft("# A new heading", {
        id: saved.id,
        expectedVersion: saved.version,
        projectId: null,
      }),
    ),
  );
  assert.equal(updated.projectId, null);
  const archived = await data<Memory>(
    await call(`/memories/${saved.id}/archive`, {
      operationId: randomUUID(),
      expectedVersion: updated.version,
    }),
  );
  assert.equal(archived.status, "archived");
  const replay = await data<Memory>(await call(path, first));
  assert.equal(replay.id, saved.id);
  assert.equal(replay.version, archived.version);
  assert.equal(replay.status, "archived");
  assert.deepEqual(await data(await call(path)), {
    state: "saved",
    id: saved.id,
  });
  const restored = await data<Memory>(
    await call(`/memories/${saved.id}/restore`, {
      operationId: randomUUID(),
      expectedVersion: archived.version,
    }),
  );
  await data(
    await call("/memories/delete", {
      operationId: randomUUID(),
      items: [{ id: saved.id, expectedVersion: restored.version }],
    }),
  );
  assert.deepEqual(await data(await call(path)), { state: "deleted" });
  assert.equal((await call(path, first)).status, 410);
  assert.equal((await call(path, draft("A stale unsaved tab"))).status, 410);
  const next = await data<Memory>(
    await call(daily("2026-11-21"), draft("Next day")),
  );
  assert.notEqual(next.id, saved.id);
});

test("invalid calendar values and correction payloads cannot bind a date", async () => {
  assert.equal((await call(daily("2026-02-29"))).status, 400);
  assert.equal((await call(daily("2026-11-7"), draft("Invalid"))).status, 400);
  const path = daily("2028-02-29");
  assert.equal(
    (
      await call(
        path,
        draft("Correct existing", { id: randomUUID(), expectedVersion: 1 }),
      )
    ).status,
    400,
  );
  assert.deepEqual(await data(await call(path)), { state: "empty" });
});

test("account erasure removes the daily reservations, even for hidden notes", async () => {
  const token = "erasure-account";
  const path = daily("2026-11-22");
  const saved = await data<Memory>(
    await call(path, draft("Erase this"), token),
  );
  const { accountId } = await data<{ accountId: string }>(
    await call("/me", undefined, token),
  );
  await data(
    await call(
      "/memories/delete",
      {
        operationId: randomUUID(),
        items: [{ id: saved.id, expectedVersion: saved.version }],
      },
      token,
    ),
  );
  const owner = await auth.principal(
    new Request("http://localhost/v1/me", {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  await service.deleteAccount(owner);
  const task = await admin("background_tasks")
    .where({ accountId, kind: "account_cleanup" })
    .first();
  for (let i = 0; i < 25; i++)
    await runTask(
      worker,
      cleanupHandlers(worker, async () => {}),
      { id: task.id, lane: "maintenance" },
    );
  assert.equal(
    (await admin("accounts").where({ id: accountId }).first()).status,
    "deleted",
  );
  assert.deepEqual(await admin("daily_notes").where({ accountId }), []);
});
