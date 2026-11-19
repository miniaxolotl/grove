import assert from "node:assert/strict";
import { test } from "node:test";
import { Webhook } from "svix";
import Stripe from "stripe";
import { createLifecycleIngress as handler } from "../../packages/api/src/lifecycle-ingress.ts";

const clerkSecret = `whsec_${Buffer.from("synthetic-clerk-webhook-key-123456").toString("base64")}`;
const stripeSecret = "whsec_synthetic_stripe";
const stripe = new Stripe("sk_test_synthetic");
const body = JSON.stringify({
  type: "user.deleted",
  timestamp: Date.now(),
  data: {
    id: "user_fixture",
    email_addresses: [{ email_address: "discard@example.invalid" }],
  },
});
function clerkRequest(path = "/v1/webhooks/clerk", raw = body) {
  const at = new Date();
  return new Request(`http://localhost${path}`, {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "svix-id": "msg_fixture",
      "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
      "svix-signature": new Webhook(clerkSecret).sign("msg_fixture", at, raw),
    },
  });
}
test("signed lifecycle ingress awaits durable commit and retains only minimized authority fields", async () => {
  let commit!: () => void;
  const committed = new Promise<void>((resolve) => {
    commit = resolve;
  });
  let accepted: unknown;
  const run = handler({
    clerkSecret,
    stripeSecret,
    stripe,
    livemode: false,
    accept: async (event: unknown) => {
      accepted = event;
      await committed;
    },
  });
  assert.equal(typeof run, "function");
  let acknowledged = false;
  const pending = run(clerkRequest()).then((response: Response) => {
    acknowledged = true;
    return response;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(acknowledged, false);
  assert.deepEqual(accepted, {
    provider: "clerk",
    id: "msg_fixture",
    type: "user.deleted",
    subject: "user_fixture",
    eventAt: JSON.parse(body).timestamp,
    disabled: false,
    fingerprint: ingressFingerprint(body),
  });
  assert.doesNotMatch(
    JSON.stringify(accepted),
    /discard@example|email_addresses/,
  );
  commit();
  assert.equal((await pending).status, 202);
});
function ingressFingerprint(raw: string) {
  return requireHash(raw);
}
import { createHash, createHmac } from "node:crypto";
import * as proofs from "../../packages/api/src/lifecycle-proof.ts";
const requireHash = (raw: string) =>
  createHash("sha256").update(raw).digest("hex");

test("only exact signed routes are eligible; general API, query aliases and readiness stay held", async () => {
  let calls = 0;
  const run = handler({
    clerkSecret,
    stripeSecret,
    stripe,
    livemode: false,
    accept: async () => {
      calls++;
    },
  });
  assert.equal(typeof run, "function");
  for (const path of [
    "/v1/me",
    "/mcp",
    "/health/ready",
    "/v1/webhooks/clerk/",
    "/v1/webhooks/clerk?bypass=1",
    "/v1/webhooks/stripe/other",
  ])
    assert.equal((await run(clerkRequest(path))).status, 503);
  const invalid = clerkRequest();
  invalid.headers.set("svix-signature", "invalid");
  assert.equal((await run(invalid)).status, 400);
  const replay = clerkRequest();
  replay.headers.set("svix-timestamp", "1");
  assert.equal((await run(replay)).status, 400);
  assert.equal(calls, 0);
});

test("private process proof needs console custody, source-bound nonce MAC and actual initialized readiness", async () => {
  const create = (
    proofs as unknown as {
      createPrivateProof?: (
        options: unknown,
      ) => (request: Request) => Promise<Response>;
    }
  ).createPrivateProof;
  assert.equal(typeof create, "function");
  if (!create) return;
  const identity = { schema: 1, source: "a".repeat(40) },
    secret = "private-proof-fixture-key",
    challenge = "b".repeat(64);
  let initialized = false,
    reads = 0;
  const proof = create({
    mode: "runtime",
    role: "worker",
    identity,
    approval: "c".repeat(64),
    secret,
    ready: async () => {
      if (!initialized) throw new Error("not initialized");
    },
    evidence: async () => {
      reads++;
      return { generation: "1", caughtUp: true };
    },
  });
  const request = (nonce = challenge, mac?: string) =>
    new Request("http://localhost/_grove/release/runtime", {
      headers: {
        "X-Grove-Release-Challenge": nonce,
        ...(mac ? { "X-Grove-Release-Proof": mac } : {}),
      },
    });
  const mac = createHmac("sha256", secret)
    .update(`/_grove/release/runtime\n${challenge}\nworker\n${identity.source}`)
    .digest("hex");
  assert.equal((await proof(request())).status, 403);
  assert.equal(reads, 0);
  assert.equal((await proof(request(challenge, mac))).status, 503);
  assert.equal(reads, 0);
  initialized = true;
  const response = await proof(request(challenge, mac));
  assert.equal(response.status, 200);
  assert.equal(reads, 1);
  assert.deepEqual(await response.json(), {
    status: "runtime_verified",
    role: "worker",
    identity,
    approval: "c".repeat(64),
    schema: "verified",
    challenge,
    evidence: { generation: "1", caughtUp: true },
  });
  assert.equal((await proof(request("d".repeat(64), mac))).status, 403);
  assert.equal(reads, 1);
});

test("Stripe signature and mode are verified, tenant comes from customer mapping not supplied metadata", async () => {
  const accepted: unknown[] = [];
  const run = handler({
    clerkSecret,
    stripeSecret,
    stripe,
    livemode: false,
    accept: async (event: unknown) => {
      accepted.push(event);
    },
  });
  assert.equal(typeof run, "function");
  const raw = JSON.stringify({
    id: "evt_fixture",
    type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        customer: "cus_fixture",
        metadata: { account_id: "malicious" },
      },
    },
  });
  const request = (payload = raw) =>
    new Request("http://localhost/v1/webhooks/stripe", {
      method: "POST",
      body: payload,
      headers: {
        "content-type": "application/json",
        "stripe-signature": stripe.webhooks.generateTestHeaderString({
          payload,
          secret: stripeSecret,
        }),
      },
    });
  assert.equal((await run(request())).status, 202);
  assert.deepEqual(accepted, [
    {
      provider: "stripe",
      id: "evt_fixture",
      type: "customer.subscription.updated",
      subject: "cus_fixture",
      eventAt: JSON.parse(raw).created * 1000,
      disabled: false,
      fingerprint: ingressFingerprint(raw),
    },
  ]);
  assert.equal(
    (await run(request(raw.replace('"livemode":false', '"livemode":true'))))
      .status,
    400,
  );
  const invalid = request();
  invalid.headers.set("stripe-signature", "invalid");
  assert.equal((await run(invalid)).status, 400);
  assert.equal(accepted.length, 1);
});

test("bounded bodies and durable failures cannot be acknowledged as accepted", async () => {
  let calls = 0;
  const run = handler({
    clerkSecret,
    stripeSecret,
    stripe,
    livemode: false,
    accept: async () => {
      calls++;
      throw new Error("private-database-fixture");
    },
  });
  assert.equal(typeof run, "function");
  const failed = await run(clerkRequest());
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /private-database/);
  assert.equal(
    (await run(clerkRequest("/v1/webhooks/clerk", "x".repeat(262145)))).status,
    413,
  );
  assert.equal(calls, 1);
});
