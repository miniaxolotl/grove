import assert from "node:assert/strict";
import { test } from "node:test";
import { readGitHubJson, parseGitHubResponse } from "./github-json.mjs";

const ok = (body = '{"id":1}') => ({ status: 200, headers: {}, body });
function fixture(responses) {
  let time = 0;
  const calls = [];
  return {
    calls,
    options: {
      request: (endpoint, options) => {
        calls.push({ endpoint, ...options });
        const result = responses.shift();
        if (result instanceof Error) throw result;
        return result;
      },
      now: () => time,
      sleep: (ms) => {
        time += ms;
      },
    },
  };
}

test("GitHub JSON reads are bounded GETs and retain complete JSON", () => {
  const io = fixture([ok('[{"id":1}]')]);
  assert.deepEqual(readGitHubJson("repos/owner/repo", io.options), [{ id: 1 }]);
  assert.equal(io.calls.length, 1);
  assert.equal(io.calls[0].method, "GET");
  assert.ok(io.calls[0].timeoutMs > 0);
});
test("transient provider and truncated JSON reads recover without replaying writes", () => {
  const io = fixture([
    { status: 503, headers: {}, body: "private body" },
    ok("{"),
    ok(),
  ]);
  assert.deepEqual(readGitHubJson("repos/owner/repo", io.options), { id: 1 });
  assert.equal(io.calls.length, 3);
  assert.ok(io.calls.every((call) => call.method === "GET"));
});
test("auth, missing resources and persistent invalid evidence fail closed and redacted", () => {
  for (const status of [401, 403, 404, 422]) {
    const io = fixture([{ status, headers: {}, body: "private-secret" }]);
    assert.throws(
      () => readGitHubJson("repos/owner/repo", io.options),
      (error) => !error.message.includes("private-secret"),
    );
    assert.equal(io.calls.length, 1);
  }
  const io = fixture([ok("{"), ok("null"), ok("false")]);
  assert.throws(() => readGitHubJson("repos/owner/repo", io.options));
  assert.equal(io.calls.length, 3);
});
test("rate limits honor the absolute budget and late evidence cannot succeed", () => {
  const io = fixture([
    { status: 429, headers: { "retry-after": "60" }, body: "{}" },
    ok(),
  ]);
  assert.throws(() =>
    readGitHubJson("repos/owner/repo", { ...io.options, timeoutMs: 1000 }),
  );
  assert.equal(io.calls.length, 1);
  let now = 0;
  assert.throws(() =>
    readGitHubJson("repos/owner/repo", {
      now: () => now,
      timeoutMs: 1000,
      request: () => {
        now = 1000;
        return ok();
      },
    }),
  );
});
test("CLI parsing requires real status headers and rejects unsafe endpoints", () => {
  assert.deepEqual(
    parseGitHubResponse(
      'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"id":1}',
    ),
    { ...ok(), headers: { "content-type": "application/json" } },
  );
  assert.throws(() => parseGitHubResponse('{"id":1}'));
  for (const endpoint of [
    "--method=POST",
    "https://foreign.invalid/repos/x",
    "repos/x\nsecret",
  ]) {
    assert.throws(() =>
      readGitHubJson(endpoint, {
        request: () => assert.fail("unsafe request"),
      }),
    );
  }
});
