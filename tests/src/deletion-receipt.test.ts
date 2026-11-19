import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createDatabase,
  migrationSource,
  tenant,
  type Knex,
} from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { readServerEnvironment } from "@lib/environment";
import {
  clerkDeletionRecipient,
  openDeletionRecipient,
  prepareDeletionReceipt,
} from "../../packages/api/src/deletion-recipient.ts";
import { deliverDeletionReceipt } from "../../packages/api/src/deletion-receipt-worker.ts";
import { createApp } from "../../packages/api/src/app.ts";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_test"));
const authority = createDatabase(url),
  name = `grove_receipt_${randomUUID().replaceAll("-", "")}_test`;
let admin: Knex, api: Knex, worker: Knex;
const receiptKey = randomBytes(32).toString("hex"),
  address = "owner@example.org";
const mail = {
  key: "fixture",
  from: "grove@example.org",
  siteUrl: "https://grove.example.org",
  receiptKey,
};
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const connect = (url: string) => {
    const u = new URL(url);
    u.pathname = `/${name}`;
    return createDatabase(u.href);
  };
  admin = connect(url);
  api = connect(process.env.TEST_DATABASE_URL!);
  worker = connect(process.env.TEST_WORKER_DATABASE_URL!);
  const all = await migrationSource.getMigrations([]);
  await admin.migrate.latest({
    migrationSource: {
      ...migrationSource,
      getMigrations: async () => all.filter((m) => m.name < "20261119_047"),
    },
  });
  await admin("accounts").insert({ clerkSubject: "existing_receipt_owner" });
  const [, applied] = await admin.migrate.latest();
  assert.equal(applied[0], "20261119_047_deletion_receipt");
  assert.equal((await admin("deletion_receipts")).length, 0);
  assert.equal((await admin("transactional_emails")).length, 1);
});
after(async () => {
  await Promise.all([admin?.destroy(), api?.destroy(), worker?.destroy()]);
  await authority.raw("DROP DATABASE IF EXISTS ??", [name]);
  await authority.destroy();
});
async function fixture() {
  const subject = `receipt_${randomUUID()}`,
    accountId = (await api.raw("SELECT id FROM grove_account(?)", [subject]))
      .rows[0].id as string;
  const principal = sessionPrincipal(accountId, subject),
    service = new MemoryService(
      api,
      "disposable-receipt-fixture-signing-secret",
    );
  const intent = await prepareDeletionReceipt(principal, {
    key: receiptKey,
    recipient: async () => address,
  });
  assert(intent);
  return { principal, accountId, service, intent, id: intent.id };
}
test("deletion receipts default off, with a separate optional 256-bit key", () => {
  const env = {
    DATABASE_URL: "postgres://localhost/grove_test",
    API_ORIGIN: "https://api.example",
    SITE_URL: "https://site.example",
    CLERK_PUBLISHABLE_KEY: "pk_fixture",
    CLERK_SECRET_KEY: "sk_fixture",
    CLERK_ISSUER: "https://clerk.example",
    CLERK_WEBHOOK_SIGNING_SECRET: "fixture",
    CURSOR_SECRET: "fixture-cursor-secret-32-characters",
  };
  assert.equal(
    readServerEnvironment(env).EMAIL_DELETION_RECEIPT_ENABLED,
    false,
  );
  assert.equal(
    readServerEnvironment({ ...env, EMAIL_DELETION_RECEIPT_ENABLED: "true" })
      .DELETION_RECEIPT_KEY,
    undefined,
  );
  assert.throws(() =>
    readServerEnvironment({ ...env, DELETION_RECEIPT_KEY: "no" }),
  );
  assert.throws(() =>
    readServerEnvironment({
      ...env,
      CURSOR_SECRET: receiptKey.toUpperCase(),
      DELETION_RECEIPT_KEY: receiptKey,
    }),
  );
});
test("only the authenticated subject's verified primary is available; missing key skips lookup", async () => {
  const { principal } = await fixture();
  let calls = 0;
  const lookup = (primary: string, verified: boolean) =>
    clerkDeletionRecipient("sk_fixture", async (url, opts) => {
      calls++;
      assert(String(url).endsWith(`/${principal.subject}`));
      assert(opts?.signal);
      return Response.json({
        id: principal.subject,
        primary_email_address_id: primary,
        email_addresses: [
          {
            id: "primary",
            email_address: address,
            verification: { status: verified ? "verified" : "unverified" },
          },
          {
            id: "secondary",
            email_address: "other@example.org",
            verification: { status: "verified" },
          },
        ],
      });
    });
  assert.equal(
    await prepareDeletionReceipt(principal, {
      recipient: lookup("primary", true),
    }),
    undefined,
  );
  assert.equal(calls, 0);
  assert.equal(await lookup("primary", false)(principal.subject), null);
  assert.equal(await lookup("missing", true)(principal.subject), null);
  assert.equal(await lookup("primary", true)(principal.subject), address);
  assert.equal(
    await prepareDeletionReceipt(principal, {
      key: receiptKey,
      recipient: async () => {
        throw new Error("provider offline");
      },
    }),
    undefined,
  );
});
test("delete endpoint rejects an address in the form and commits when Clerk times out", async () => {
  const { service, principal, accountId } = await fixture();
  let lookups = 0;
  const app = createApp({
    memories: service,
    auth: { principal: async () => principal },
    origin: "https://api.example",
    siteUrl: mail.siteUrl,
    issuer: "https://clerk.example",
    webhookSecret: "fixture",
    ready: async () => {},
    deletionReceipt: {
      key: receiptKey,
      recipient: clerkDeletionRecipient("sk_fixture", async (_url, options) => {
        lookups++;
        return new Promise<Response>((_resolve, reject) =>
          options!.signal!.addEventListener(
            "abort",
            () => reject(new Error("timeout")),
            { once: true },
          ),
        );
      }),
    },
  });
  const request = (body: object) =>
    app.request("https://api.example/v1/account/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await request({ confirm: "delete my account", email: address })).status,
    400,
  );
  assert.equal(lookups, 0);
  assert.equal((await request({ confirm: "delete my account" })).status, 202);
  assert.equal(lookups, 1);
  assert.equal(
    (await admin("accounts").where({ id: accountId }).first()).status,
    "deleting",
  );
  assert.equal(
    (await admin("deletion_receipts").where({ accountId })).length,
    0,
  );
});
test("receipt insert is atomic, single-submit, and optional even when staging fails", async () => {
  const { service, principal, intent, accountId } = await fixture();
  await admin.raw(`CREATE FUNCTION fixture_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='deleting' THEN RAISE EXCEPTION 'fixture_rollback'; END IF; RETURN NEW; END $$;
    CREATE CONSTRAINT TRIGGER fixture_abort AFTER UPDATE ON accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fixture_abort()`);
  try {
    await assert.rejects(
      service.deleteAccount(principal, intent),
      /fixture_rollback/,
    );
  } finally {
    await admin.raw("DROP TRIGGER fixture_abort ON accounts");
  }
  assert.equal(
    (await admin("accounts").where({ id: accountId }).first()).status,
    "active",
  );
  assert.equal(
    (await admin("deletion_receipts").where({ accountId })).length,
    0,
  );
  const outcomes = await Promise.allSettled([
    service.deleteAccount(principal, intent),
    service.deleteAccount(principal, intent),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  const rows = await admin("deletion_receipts").where({ accountId });
  assert.equal(rows.length, 1);
  assert(!rows[0].snapshot.includes(address));
  assert.throws(() =>
    openDeletionRecipient(receiptKey, { ...rows[0], accountId: randomUUID() }),
  );
  await assert.rejects(
    tenant(api, accountId, (trx) =>
      trx("deletion_receipts").select("snapshot"),
    ),
  );
  assert.equal(
    (
      await tenant(worker, randomUUID(), (trx) =>
        trx("deletion_receipts").where({ accountId }),
      )
    ).length,
    0,
  );
  const bad = await fixture();
  assert.deepEqual(
    await bad.service.deleteAccount(bad.principal, {
      ...bad.intent,
      snapshot: Buffer.alloc(0),
    }),
    { status: "deleting" },
  );
  assert.equal(
    (await admin("deletion_receipts").where({ accountId: bad.accountId }))
      .length,
    0,
  );
  const webhook = await fixture();
  await api.raw("SELECT grove_webhook(?,?,?,?)", [
    randomUUID(),
    "user.deleted",
    webhook.principal.subject,
    Date.now(),
  ]);
  assert.equal(
    (await admin("accounts").where({ id: webhook.accountId }).first()).status,
    "deleting",
  );
  assert.equal(
    (await admin("deletion_receipts").where({ accountId: webhook.accountId }))
      .length,
    0,
  );
});
test("deleted identity receipt retries an uncertain acceptance with identical bytes; ordinary mail stays fenced", async () => {
  const { service, principal, intent, accountId, id } = await fixture();
  await service.deleteAccount(principal, intent);
  await admin("accounts")
    .where({ id: accountId })
    .update({ status: "deleted", providerDeletedAt: admin.fn.now() });
  const welcome = await admin("transactional_emails")
    .where({ accountId })
    .first();
  assert.deepEqual(
    (await worker.raw("SELECT * FROM grove_claim_email(?)", [welcome.id])).rows,
    [],
  );
  assert(
    (await worker.raw("SELECT * FROM grove_dispatch_receipts()")).rows.some(
      (r: { id: string }) => r.id === id,
    ),
  );
  const sent: string[] = [];
  const transport: typeof fetch = async (_url, opts) => {
    assert.deepEqual(JSON.parse(String(opts?.body)).to, [address]);
    sent.push(
      JSON.stringify([
        opts?.body,
        new Headers(opts?.headers).get("Idempotency-Key"),
      ]),
    );
    if (sent.length === 1) throw new Error("connection lost after acceptance");
    return Response.json({ id: "provider-accepted" });
  };
  const first = await Promise.all([
    deliverDeletionReceipt(worker, mail, id, transport),
    deliverDeletionReceipt(worker, mail, id, transport),
  ]);
  assert.deepEqual(first.sort(), [false, true]);
  assert.equal(sent.length, 1);
  await admin("deletion_receipts")
    .where({ id })
    .update({ dueAt: admin.fn.now() });
  assert(await deliverDeletionReceipt(worker, mail, id, transport));
  assert.deepEqual(sent, [sent[0], sent[0]]);
  const row = await admin("deletion_receipts").where({ id }).first();
  assert(row.acceptedAt);
  assert.equal(row.snapshot, null);
  assert.equal(row.fingerprint, null);
});
test("receipt dispatch marks publication only after a matching confirmation token", async () => {
  const { service, principal, intent, id } = await fixture();
  await service.deleteAccount(principal, intent);
  const dispatch = (
    await worker.raw("SELECT * FROM grove_dispatch_receipts()")
  ).rows.find((r: { id: string }) => r.id === id);
  assert(dispatch?.dispatch_id);
  assert.equal(
    (await admin("deletion_receipts").where({ id }).first()).dispatchedAt,
    null,
  );
  await worker.raw("SELECT grove_mark_receipt_dispatched(?, ?)", [
    id,
    randomUUID(),
  ]);
  assert.equal(
    (await admin("deletion_receipts").where({ id }).first()).dispatchedAt,
    null,
  );
  await worker.raw("SELECT grove_mark_receipt_dispatched(?, ?)", [
    id,
    dispatch.dispatch_id,
  ]);
  assert((await admin("deletion_receipts").where({ id }).first()).dispatchedAt);
});

test("changed retry content, permanent rejection, expiry and pause erase the snapshot", async () => {
  for (const reason of ["changed", "rejected", "expired", "paused"]) {
    const { service, principal, intent, id } = await fixture();
    await service.deleteAccount(principal, intent);
    if (reason === "expired" || reason === "paused") {
      if (reason === "expired")
        await admin("deletion_receipts")
          .where({ id })
          .update({ createdAt: admin.raw("now()-interval '23 hours'") });
      await worker.raw("SELECT grove_sweep_receipts(?)", [reason === "paused"]);
    } else {
      await deliverDeletionReceipt(
        worker,
        mail,
        id,
        async () =>
          new Response(null, {
            status: reason === "changed" ? 429 : 422,
            headers: { "Retry-After": "1200" },
          }),
      );
      if (reason === "changed") {
        const row = await admin("deletion_receipts").where({ id }).first();
        assert(+new Date(row.dueAt) - Date.now() > 1190000);
        await admin("deletion_receipts")
          .where({ id })
          .update({ dueAt: admin.fn.now() });
        let called = false;
        await deliverDeletionReceipt(
          worker,
          { ...mail, siteUrl: "https://changed.example.org" },
          id,
          async () => {
            called = true;
            return Response.json({ id: "unused" });
          },
        );
        assert.equal(called, false);
      }
    }
    const row = await admin("deletion_receipts").where({ id }).first();
    assert(row.failedAt);
    assert.equal(row.snapshot, null);
    assert.equal(row.fingerprint, null);
    assert.deepEqual(
      (await worker.raw("SELECT * FROM grove_claim_receipt(?)", [id])).rows,
      [],
    );
  }
});
