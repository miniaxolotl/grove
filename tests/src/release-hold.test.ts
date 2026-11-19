import assert from "node:assert/strict";
import { test } from "node:test";
import {
  releaseEntry as entry,
  serveHeldStatus,
} from "../../packages/api/src/release-hold.ts";

const identity = {
  schema: 1,
  source: "a".repeat(40),
  production: "b".repeat(40),
  tag: "v1.11.30",
  run: 123,
  attempt: 1,
  digest: `sha256:${"c".repeat(64)}`,
  publication: "d".repeat(64),
};
const binary = {
  revision: identity.source,
  version: "1.11.30",
  productVersion: "1.11.30",
  component: "api",
  enabled: true,
  holdRequired: true,
};
test("held worker enters only the bounded probe surface, before any runtime/effect initialization", async () => {
  const calls: string[] = [];
  await entry(
    "worker",
    async () => {
      calls.push("effects");
    },
    { GROVE_RELEASE_HOLD: JSON.stringify(identity) },
    {
      identity: async () => binary,
      listen: async (value: unknown) => {
        assert.deepEqual(value, identity);
        calls.push("held");
      },
    },
  );
  assert.deepEqual(calls, ["held"]);
});

test("held identity follows the admitted product stamp, not a separately preserved API package version", async () => {
  let held = false;
  await entry(
    "worker",
    async () => assert.fail("effects"),
    { GROVE_RELEASE_HOLD: JSON.stringify(identity) },
    {
      required: true,
      identity: async () => ({ ...binary, version: "1.11.28" }),
      listen: async () => {
        held = true;
      },
    },
  );
  assert.equal(held, true);
  await assert.rejects(
    entry(
      "worker",
      async () => assert.fail("effects"),
      { GROVE_RELEASE_HOLD: JSON.stringify(identity) },
      {
        identity: async () => ({ ...binary, productVersion: "1.11.29" }),
        listen: async () => {},
      },
    ),
    /held release configuration/i,
  );
});

test("a held-build cannot start effects by omitting its latch; only the exact explicit approval identity releases it", async () => {
  let effects = 0;
  const dependencies = {
    required: true,
    identity: async () => binary,
    listen: async () => {},
  };
  await assert.rejects(
    entry(
      "worker",
      async () => {
        effects++;
      },
      {},
      dependencies,
    ),
    /held release configuration/i,
  );
  assert.equal(effects, 0);
  const approval = { schema: 1, identity, approval: "9".repeat(64) };
  await entry(
    "worker",
    async () => {
      effects++;
    },
    { GROVE_RELEASE_APPROVAL: JSON.stringify(approval) },
    dependencies,
  );
  assert.equal(effects, 1);
  for (const env of [
    { GROVE_RELEASE_APPROVAL: "private-invalid" },
    {
      GROVE_RELEASE_APPROVAL: JSON.stringify({
        ...approval,
        identity: { ...identity, source: "e".repeat(40) },
      }),
    },
    {
      GROVE_RELEASE_APPROVAL: JSON.stringify(approval),
      GROVE_RELEASE_HOLD: JSON.stringify(identity),
    },
  ])
    await assert.rejects(
      entry(
        "worker",
        async () => {
          effects++;
        },
        env,
        dependencies,
      ),
      /held release configuration/i,
    );
  assert.equal(effects, 1);
});
test("held API also blocks effectful runtime initialization; absence preserves normal startup", async () => {
  const calls: string[] = [];
  const dependencies = {
    identity: async () => binary,
    listen: async () => {
      calls.push("held");
    },
  };
  await entry(
    "api",
    async () => {
      calls.push("effects");
    },
    { GROVE_RELEASE_HOLD: JSON.stringify(identity) },
    dependencies,
  );
  await entry(
    "worker",
    async () => {
      calls.push("normal");
    },
    {},
    dependencies,
  );
  assert.deepEqual(calls, ["held", "normal"]);
});
test("malformed, empty, foreign-source and wrong-version holds fail closed without printing their input", async () => {
  for (const value of [
    "",
    "private-fixture",
    "{}",
    JSON.stringify({ ...identity, source: "e".repeat(40) }),
    JSON.stringify({ ...identity, tag: "v1.11.29" }),
    JSON.stringify({ ...identity, extra: "private-fixture" }),
  ]) {
    let called = false;
    await assert.rejects(
      async () =>
        entry(
          "worker",
          async () => {
            called = true;
          },
          { GROVE_RELEASE_HOLD: value },
          {
            identity: async () => binary,
            listen: async () => {
              called = true;
            },
          },
        ),
      (error: unknown) => {
        assert.match(String(error), /held release configuration/i);
        assert.doesNotMatch(String(error), /private-fixture|aaa|eee/);
        return true;
      },
    );
    assert.equal(called, false);
  }
});

test("held HTTP proves the fresh challenge only after a bounded probe, never exposes mutation or public readiness", async () => {
  let probes = 0;
  const { server, close } = await serveHeldStatus(
    identity as Parameters<typeof serveHeldStatus>[0],
    "worker",
    { PORT: "0" },
    async () => {
      probes++;
    },
  );
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${origin}/health/live`)).status, 200);
    assert.equal((await fetch(`${origin}/health/ready`)).status, 503);
    assert.equal(
      (
        await fetch(`${origin}/v1/webhooks/clerk`, {
          method: "POST",
          body: "private",
        })
      ).status,
      503,
    );
    assert.equal(probes, 0);
    assert.equal((await fetch(`${origin}/_grove/release/held`)).status, 400);
    const challenge = "f".repeat(64);
    const response = await fetch(`${origin}/_grove/release/held`, {
      headers: { "X-Grove-Release-Challenge": challenge },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
    assert.deepEqual(await response.json(), {
      status: "release_held",
      role: "worker",
      identity,
      schema: "verified",
      challenge,
    });
    assert.equal(probes, 1);
  } finally {
    await close();
  }
});
