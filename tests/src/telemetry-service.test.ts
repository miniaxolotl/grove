import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "@lib/database";
import { MemoryService } from "@lib/memory";
import {
  rememberSchema,
  recallSchema,
  listSchema,
} from "@lib/shared/contracts";
import {
  withTelemetry,
  requestCollectionAllowed,
  type TelemetrySink,
} from "@lib/telemetry/context";
import { Authentication } from "../../packages/api/src/auth.ts";
import { createApp } from "../../packages/api/src/app.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "Telemetry service tests require a disposable _test database",
  );
const db = createDatabase(url);
after(() => db.destroy());
const service = () =>
  new MemoryService(db, "test-telemetry-cursor-secret-at-least-32-characters");
function recorder() {
  const events: { event: string; properties: unknown }[] = [];
  const sink: TelemetrySink = {
    capture(event, properties) {
      events.push({ event, properties });
    },
    operation() {},
  };
  return { events, sink };
}
const request = (headers = {}) =>
  new Request("http://localhost/v1/me", {
    headers: { authorization: "Bearer fixture", ...headers },
  });

test("concurrent first authentication counts one committed workspace and honors the caller's opt-out", async () => {
  const created: string[] = [];
  const subject = `user_telemetry_${randomUUID()}`;
  const auth = new Authentication(
    db,
    {
      async verify() {
        return { subject, type: "session" };
      },
    },
    (account, request) => {
      if (requestCollectionAllowed(request.headers)) created.push(account);
    },
  );
  const results = await Promise.all(
    Array.from({ length: 8 }, () => auth.principal(request())),
  );
  assert.equal(new Set(results.map((p) => p.accountId)).size, 1);
  assert.deepEqual(created, [results[0].accountId]);
  await auth.principal(request());
  assert.equal(created.length, 1);
  const disabled = new Authentication(
    db,
    {
      async verify() {
        return { subject: `user_private_${randomUUID()}`, type: "session" };
      },
    },
    (account, request) => {
      if (requestCollectionAllowed(request.headers)) created.push(account);
    },
  );
  for (const headers of [
    { "X-Grove-Telemetry": "off" },
    { DNT: "1" },
    { "Sec-GPC": "1" },
  ])
    await disabled.principal(request(headers));
  assert.equal(created.length, 1);
});

test("milestones follow durable commits, exclude retries and edits, and never include private memory or notebook fields", async () => {
  const memories = service();
  const subject = `user_milestones_${randomUUID()}`;
  const auth = new Authentication(db, {
    async verify() {
      return { subject, type: "session" };
    },
  });
  const principal = await auth.principal(request());
  const { events, sink } = recorder();
  await withTelemetry(sink, async () => {
    const input = rememberSchema.parse({
      operationId: randomUUID(),
      content: "PRIVATE_MEMORY",
    });
    const [first, retry] = await Promise.all([
      memories.remember(principal, input),
      memories.remember(principal, input),
    ]);
    assert.equal(first.id, retry.id);
    assert.equal(events.filter((e) => e.event === "memory_created").length, 1);
    await assert.rejects(
      memories.remember(principal, { ...input, content: "PRIVATE_CONFLICT" }),
    );
    await memories.remember(principal, {
      ...input,
      operationId: randomUUID(),
      id: first.id,
      expectedVersion: first.version,
      content: "PRIVATE_EDIT",
    });
    assert.equal(events.filter((e) => e.event === "memory_created").length, 1);
    const notebook = {
      name: "PRIVATE_NOTEBOOK",
      identity: `PRIVATE_REPOSITORY_${randomUUID()}`,
    };
    await Promise.all([
      memories.project(principal, notebook),
      memories.project(principal, notebook),
    ]);
    assert.equal(
      events.filter((e) => e.event === "notebook_created").length,
      1,
    );
    const failing = service();
    failing.jobProfiles = async () => {
      throw new Error("PRIVATE_DATABASE_FAILURE");
    };
    await assert.rejects(
      failing.remember(
        principal,
        rememberSchema.parse({
          operationId: randomUUID(),
          content: "PRIVATE_ROLLED_BACK",
        }),
      ),
    );
    assert.equal(events.filter((e) => e.event === "memory_created").length, 1);
    assert.equal(
      (await memories.list(principal, listSchema.parse({}))).items.length,
      1,
    );
    await memories.recall(principal, recallSchema.parse({}));
    assert.equal(events.filter((e) => e.event === "memory_recalled").length, 1);
    assert.ok(!JSON.stringify(events).includes("PRIVATE"));
    assert.ok(!JSON.stringify(events).includes(principal.accountId));
  });
});

test("concurrent API contexts retain opt-out and do not leak a request's analytics into another request", async () => {
  const memories = service();
  const subject = `user_api_telemetry_${randomUUID()}`;
  const auth = new Authentication(db, {
    async verify() {
      return { subject, type: "session" };
    },
  });
  const { events, sink } = recorder();
  let operations = 0;
  const app = createApp({
    memories,
    auth,
    origin: "http://localhost",
    siteUrl: "http://localhost",
    issuer: "https://fixture.invalid",
    webhookSecret: "whsec_dGVzdA==",
    ready: async () => {},
    telemetry: {
      operation() {
        operations++;
      },
      forIdentity(_identity, enabled) {
        return enabled ? sink : { capture() {}, operation() {} };
      },
    },
  });
  const save = (disabled: boolean) =>
    app.request("/v1/memories", {
      method: "POST",
      headers: {
        authorization: "Bearer fixture",
        "Content-Type": "application/json",
        ...(disabled ? { "X-Grove-Telemetry": "off" } : {}),
      },
      body: JSON.stringify({
        operationId: randomUUID(),
        content: "PRIVATE_API_CONTENT",
      }),
    });
  const responses = await Promise.all([save(true), save(false), save(true)]);
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "memory_created");
  assert.equal(operations, 1);
});
