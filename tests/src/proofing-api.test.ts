import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tenant } from "@lib/database";
import { cleanupHandlers, scheduleCleanup, runTask } from "@lib/memory";
import { GroveError } from "@lib/shared/contracts";
import { writingSettingsSchema } from "@lib/shared/writing-settings";
import { createApp, type AppDependencies } from "../../packages/api/src/app.ts";
import { languageTool } from "../../packages/api/src/proofing.ts";
import { capacityFixture } from "./fixtures/capacity.ts";

const marker = "PRIVATE_PROOFING_FIXTURE";
const rules = { ...writingSettingsSchema.parse({}).rules, spelling: true };
const input = {
  revision: 9,
  text: `😀 I hope your well. \`${marker}\``,
  rules,
};
const off = { enabled: false, automatic: false };
const on = { enabled: true, automatic: false };
let fixture: Awaited<ReturnType<typeof capacityFixture>>;
let app: ReturnType<typeof createApp>;
let deps: AppDependencies;
let calls = 0;
let sessionExpiresAt = Date.now() + 3600000;
let respond: (res: ServerResponse, form: URLSearchParams) => void;
const seen: string[] = [];
const server = createServer(async (req, res) => {
  calls++;
  let body = "";
  for await (const data of req) body += data;
  seen.push(JSON.stringify({ url: req.url, headers: req.headers, body }));
  respond(res, new URLSearchParams(body));
});
const request = async (
  path: string,
  method: string,
  payload?: unknown,
  token = "0",
  origin = "http://site.example.test",
  signal?: AbortSignal,
  mode?: string,
) =>
  app.request(`/v1/proofing/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
      ...(mode ? { "x-grove-proofing-mode": mode } : {}),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal,
  });
const put = (payload: unknown, token?: string) =>
  request("consent", "PUT", payload, token);
const check = (payload: unknown = input, token?: string) =>
  request("check", "POST", payload, token);
const latch = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { resolve, promise };
};

before(async () => {
  fixture = await capacityFixture({ notes: 0, pool: 1 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  deps = {
    memories: fixture.service,
    auth: {
      principal: async (req) => {
        if (req.headers.get("authorization") === "Bearer expired")
          throw new GroveError("unauthorized", "Expired", 401);
        for (const type of ["oauth", "key"] as const)
          if (req.headers.get("authorization") === `Bearer ${type}`)
            return { ...fixture.principals[0], type };
        return {
          ...(await fixture.auth.principal(req)),
          get sessionExpiresAt() {
            return sessionExpiresAt;
          },
        };
      },
    },
    origin: "http://api.example.test",
    siteUrl: "http://site.example.test",
    issuer: "http://issuer.example.test",
    webhookSecret: "unused",
    ready: async () => {},
    languageToolUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
  app = createApp(deps);
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await fixture?.close();
});

test("consent is session-only, tenant-isolated metadata, defaults off and records revocation", async () => {
  assert.deepEqual(await (await request("consent", "GET")).json(), off);
  assert.equal((await put({ enabled: false, automatic: true })).status, 400);
  assert.equal((await put({ ...on, text: marker })).status, 400);
  for (const token of ["oauth", "key"])
    assert.equal((await put(on, token)).status, 403);
  assert.deepEqual(
    await (await put({ enabled: true, automatic: true })).json(),
    { enabled: true, automatic: true },
  );
  assert.deepEqual(
    await (await request("consent", "GET", undefined, "1")).json(),
    off,
  );
  assert.equal(
    (
      await tenant(fixture.db, fixture.principals[1].accountId, (trx) =>
        trx("proofing_consents").select(),
      )
    ).length,
    0,
  );
  assert.deepEqual(await (await put(off)).json(), off);
  const row = await fixture
    .admin("proofing_consents")
    .where({ accountId: fixture.principals[0].accountId })
    .first();
  assert.equal(row.scope, "grove-note-editor");
  assert.equal(row.version, 1);
  assert.ok(row.revokedAt);
  assert.equal(row.automatic, false);
});

test("no LT calls for guests, expired sessions, non-session principals, foreign origins, revoked grants or invalid input", async () => {
  const start = calls;
  await put(off);
  assert.equal((await check()).status, 403);
  await put(on);
  for (const [token, status] of [
    ["", 401],
    ["expired", 401],
    ["oauth", 403],
    ["key", 403],
    ["1", 403],
  ] as const)
    assert.equal((await check(input, token)).status, status);
  assert.equal(
    (await request("check", "POST", input, "0", "http://foreign.example.test"))
      .status,
    403,
  );
  for (const bad of [
    { ...input, revision: -1 },
    { ...input, text: "x".repeat(1501) },
    { ...input, rules: { confusion: true } },
    { ...input, rules: { ...rules, extra: true } },
    { ...input, url: "https://external.example.test" },
    { ...input, text: "two\n\nparagraphs" },
  ])
    assert.equal((await check(bad)).status, 400);
  assert.equal(
    (await check({ ...input, text: "x".repeat(20000) })).status,
    413,
  );
  await fixture.admin("session_revocations").insert({ id: "capacity-0" });
  try {
    assert.equal((await check()).status, 401);
  } finally {
    await fixture
      .admin("session_revocations")
      .where({ id: "capacity-0" })
      .delete();
  }
  assert.equal(calls, start);
});

test("a different policy version is not a grant; explicit revocation invalidates it even across rollback", async () => {
  await put(on);
  const key = { accountId: fixture.principals[0].accountId };
  await fixture.admin("proofing_consents").where(key).update({ version: 2 });
  assert.deepEqual(await (await request("consent", "GET")).json(), off);
  assert.equal((await check()).status, 403);
  await put(off);
  assert.ok(
    (await fixture.admin("proofing_consents").where(key).first()).revokedAt,
  );
});

test("forwards only masked UTF-16 prose and enabled LT IDs; strips context, hostile spans, identity and headers", async () => {
  await put(on);
  let sent: URLSearchParams | undefined;
  respond = (res, form) => {
    sent = form;
    const from = input.text.indexOf("your");
    const match = {
      rule: { id: "YOUR_YOU_2" },
      offset: from,
      length: 4,
      replacements: [{ value: "you're" }],
      message: marker,
      context: { text: marker },
      sentence: marker,
    };
    res
      .writeHead(200, {
        "content-type": "application/json",
        "x-private": marker,
      })
      .end(
        JSON.stringify({
          warnings: { incompleteResults: true },
          matches: [
            match,
            { ...match, offset: 1 },
            { ...match, offset: input.text.indexOf("`") },
            { ...match, rule: { id: "__proto__" } },
            { ...match, rule: { id: "MORFOLOGIK_RULE_EN_US" } },
          ],
        }),
      );
  };
  const response = await check({
    ...input,
    rules: { ...rules, spelling: false },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-private"), null);
  const from = input.text.indexOf("your");
  assert.deepEqual(await response.json(), {
    revision: 9,
    complete: false,
    issues: [
      {
        id: `confusion:${from}:${from + 4}`,
        rule: "confusion",
        message: "confusion",
        from,
        to: from + 4,
        original: "your",
        replacements: ["you're"],
      },
    ],
  });
  assert.equal(sent?.get("language"), "en-US");
  assert.equal(sent?.get("enabledOnly"), "true");
  assert.equal(
    sent?.get("text"),
    input.text.replace(/`[^`]+`/, (value) => " ".repeat(value.length)),
  );
  assert.match(sent!.get("enabledRules")!, /YOUR_YOU_2/);
  assert.doesNotMatch(sent!.get("enabledRules")!, /MORFOLOGIK/);
  const wire = seen.at(-1)!;
  assert.match(wire, /\/v2\/check/);
  assert.doesNotMatch(
    wire,
    /authorization|cookie|capacity|PRIVATE_PROOFING_FIXTURE|Bearer|user_/i,
  );
});

test("busy checks never queue; revocation proceeds with the sole DB connection and discards pending results", async () => {
  await put(on);
  await put(on, "1");
  const entered = latch();
  let finish = () => {};
  respond = (res) => {
    finish = () =>
      res
        .writeHead(200, { "content-type": "application/json" })
        .end('{"matches":[]}');
    entered.resolve();
  };
  const start = calls;
  const pending = check();
  assert.equal(
    await Promise.race([
      entered.promise.then(() => "sent"),
      pending.then(() => "not sent"),
    ]),
    "sent",
  );
  try {
    assert.equal((await check(input, "1")).status, 503);
    assert.equal((await put(off)).status, 200);
    assert.equal((await put(on)).status, 200); // a new grant cannot release the old request
  } finally {
    finish();
  }
  assert.equal((await pending).status, 403);
  assert.equal(calls, start + 1);
});

test("upstream redirect, oversize, malformed JSON, schema and deadline failures are content-free, never replayed", async (t) => {
  await put(on);
  const logs: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) =>
    logs.push(JSON.stringify(args)),
  );
  for (const [status, headers, body] of [
    [307, { location: `${deps.languageToolUrl}/redirected` }, marker],
    [500, { "content-type": "text/plain" }, marker],
    [200, { "content-type": "text/html" }, '{"matches":[]}'],
    [200, { "content-type": "application/json" }, marker],
    [
      200,
      { "content-type": "application/json" },
      JSON.stringify({ matches: "bad", message: marker }),
    ],
    [
      200,
      { "content-type": "application/json" },
      JSON.stringify({ matches: [], sentence: marker.repeat(5000) }),
    ],
  ] as const) {
    const start = calls;
    respond = (res) => {
      res.writeHead(status, headers);
      res.write(body);
      res.end();
    };
    const response = await check();
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), new RegExp(marker));
    assert.equal(calls, start + 1);
  }
  respond = (res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"matches":');
  };
  const response = await check();
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), new RegExp(marker));
  assert.doesNotMatch(logs.join(""), new RegExp(marker));
});

test("only the editor origin is eligible, and automatic checks require the current automatic grant", async () => {
  await put(on);
  const start = calls;
  respond = (res) =>
    res
      .writeHead(200, { "content-type": "application/json" })
      .end('{"matches":[]}');
  for (const origin of ["", deps.origin])
    assert.equal(
      (await request("check", "POST", input, "0", origin)).status,
      403,
    );
  const mode = (value: string) =>
    request("check", "POST", input, "0", undefined, undefined, value);
  assert.equal((await mode("automatic")).status, 403);
  assert.equal((await mode("bogus")).status, 400);
  assert.equal(calls, start);
  await put({ ...on, automatic: true });
  assert.equal((await mode("automatic")).status, 200);
  await put(on);
  assert.equal((await mode("automatic")).status, 403);
  assert.equal((await mode("manual")).status, 200);
});

test("matched LT 6.8 mid-clause contraction keeps lowercase when the engine offers both cases", async () => {
  await put(on);
  respond = (res) =>
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        matches: [
          {
            rule: { id: "ITS_TO_IT_S" },
            offset: 6,
            length: 3,
            replacements: [{ value: "It's" }, { value: "it's" }],
          },
        ],
      }),
    );
  const result = await (
    await check({ ...input, text: "Okay, its still there." })
  ).json();
  assert.equal(result.issues[0].replacements[0], "it's");
});

test("client disconnect aborts the LT stream and releases capacity; no prose reaches SQL or telemetry", async (t) => {
  await put(on);
  const needle = "PrivateFixtureUnmaskedProse",
    queries: string[] = [];
  const query = (q: unknown) => {
    queries.push(JSON.stringify(q));
  };
  fixture.db.on("query", query);
  const logs: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) =>
    logs.push(JSON.stringify(args)),
  );
  const entered = latch(),
    disconnected = latch(),
    controller = new AbortController();
  respond = (res) => {
    res.on("close", disconnected.resolve);
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"matches":');
    entered.resolve();
  };
  try {
    const pending = request(
      "check",
      "POST",
      { ...input, text: needle },
      "0",
      undefined,
      controller.signal,
    );
    assert.equal(
      await Promise.race([
        entered.promise.then(() => "sent"),
        pending.then(() => "not sent"),
      ]),
      "sent",
    );
    controller.abort();
    assert.equal((await pending).status, 503);
    await disconnected.promise;
    respond = (res) =>
      res
        .writeHead(200, { "content-type": "application/json" })
        .end('{"matches":[]}');
    assert.equal((await check({ ...input, text: needle })).status, 200);
    assert.doesNotMatch([...queries, ...logs].join(""), new RegExp(needle));
  } finally {
    fixture.db.off("query", query);
  }
});

test("deleting account fences pending and new checks; cleanup purges the grant", async () => {
  const id = fixture.principals[1].accountId;
  await put(on, "1");
  let entered!: () => void;
  const arrival = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finish = () => {};
  respond = (res) => {
    finish = () =>
      res
        .writeHead(200, { "content-type": "application/json" })
        .end('{"matches":[]}');
    entered();
  };
  const pending = check(input, "1");
  assert.equal(
    await Promise.race([
      arrival.then(() => "sent"),
      pending.then(() => "not sent"),
    ]),
    "sent",
  );
  try {
    await fixture.service.deleteAccount(fixture.principals[1]);
  } finally {
    finish();
  }
  assert.equal((await pending).status, 403);
  const count = calls;
  assert.equal((await check(input, "1")).status, 403);
  assert.equal(calls, count);
  await scheduleCleanup(fixture.workerDb);
  const task = await fixture
    .admin("background_tasks")
    .where({ kind: "account_cleanup", accountId: id })
    .first();
  for (let step = 0; step < 40; step++) {
    if (
      !(await runTask(
        fixture.workerDb,
        cleanupHandlers(fixture.workerDb, async () => {}),
        { id: task.id },
      ))
    )
      break;
  }
  assert.equal(
    (await fixture.admin("accounts").where({ id }).first()).status,
    "deleted",
  );
  assert.equal(
    (await fixture.admin("proofing_consents").where({ accountId: id })).length,
    0,
  );
});

test("a verified session in its JWT clock-tolerance window cannot dispatch; expiry during LT fences the response", async () => {
  await put(on);
  const start = calls;
  respond = (res) =>
    res
      .writeHead(200, { "content-type": "application/json" })
      .end('{"matches":[]}');
  try {
    sessionExpiresAt = Date.now() - 1;
    assert.equal((await check()).status, 401);
    assert.equal(calls, start);
    sessionExpiresAt = Date.now() + 60000;
    respond = (res) => {
      sessionExpiresAt = Date.now() - 1;
      res
        .writeHead(200, { "content-type": "application/json" })
        .end('{"matches":[]}');
    };
    assert.equal((await check()).status, 401);
    assert.equal(calls, start + 1);
  } finally {
    sessionExpiresAt = Date.now() + 3600000;
  }
});

test("blank, public, credential-bearing or non-origin configuration cannot dispatch any paragraph", async (t) => {
  const fetcher = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ matches: [] }),
  );
  for (const invalid of [
    undefined,
    "https://public-checker.example.test",
    "http://languagetool:8081/v2/check",
    "http://user:pw@languagetool:8081",
    "http://127.0.0.1:8888/?route=elsewhere",
  ])
    await assert.rejects(
      languageTool(invalid)(input, new AbortController().signal),
      { code: "proofing_unavailable" },
    );
  assert.equal(fetcher.mock.callCount(), 0);
});
