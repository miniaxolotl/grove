import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, probeDatabase } from "@lib/database";
import { MemoryService } from "@lib/memory";
import { type ConnectAttempt } from "@lib/shared/contracts";
import { Authentication } from "../../packages/api/src/auth.ts";
import { createApp } from "../../packages/api/src/app.ts";

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_MIGRATION_DATABASE_URL)
  throw new Error("Disposable test database required");
const db = createDatabase(process.env.TEST_DATABASE_URL);
const admin = createDatabase(process.env.TEST_MIGRATION_DATABASE_URL);
const subjects = {
  owner: `user_connect_${randomUUID()}`,
  other: `user_connect_${randomUUID()}`,
};
const service = new MemoryService(
  db,
  "connection-test-cursor-secret-at-least-32",
);
const app = createApp({
  memories: service,
  auth: new Authentication(db, {
    async verify(token) {
      const [account, clientId] = token.split(":");
      if (!(account in subjects)) throw new Error("Unknown fixture identity");
      return clientId
        ? {
            type: "oauth",
            subject: subjects[account as keyof typeof subjects],
            clientId,
            issuedAt: Date.now(),
            scopes: ["openid"],
          }
        : {
            type: "session",
            subject: subjects[account as keyof typeof subjects],
            sessionId: `session_${account}`,
          };
    },
  }),
  origin: "http://127.0.0.1:26080",
  siteUrl: "http://127.0.0.1:3000",
  issuer: "https://clerk.example.test",
  webhookSecret: "whsec_dGVzdA==",
  ready: () => probeDatabase(db),
});
after(async () => {
  await Promise.all([db.destroy(), admin.destroy()]);
});

async function request(
  token: string,
  path: string,
  body?: unknown,
  method?: string,
) {
  const response = await app.request(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, ...(await response.json()) };
}
async function begin(
  token = `owner:${randomUUID()}`,
  identity = `git:github.com/fixture/${randomUUID()}`,
) {
  const response = await request(token, "/v1/connect", {
    agent: "opencode",
    project: { name: "Example", identity },
  });
  assert.equal(response.status, 200, JSON.stringify(response));
  return { token, attempt: response.data as ConnectAttempt, identity };
}
const approval = (attempt: ConnectAttempt) => ({
  ...attempt.grant,
  currentProject: true,
});

test("OAuth connection flows from no access to owner-approved project scope, and resumes without widening", async () => {
  assert.equal((await request("", "/v1/connect", {})).status, 401);
  assert.equal(
    (
      await request("owner", "/v1/connect", {
        agent: "opencode",
        project: null,
      })
    ).status,
    403,
  );
  const { token, attempt, identity } = await begin();
  assert.equal(attempt.status, "pending");
  assert.deepEqual(attempt.grant.capabilities, ["memory:read", "memory:write"]);
  assert.equal(attempt.grant.personal, true);
  assert.equal(attempt.grant.allProjects, false);
  assert.deepEqual((await request(token, "/v1/me")).data.capabilities, []);
  assert.equal((await request(token, "/v1/recall", {})).status, 403);
  assert.equal((await admin("projects").where({ identity })).length, 0);
  assert.equal(
    (await begin(token, identity)).attempt.id,
    attempt.id,
    "Resume the same unexpired request",
  );
  assert.equal(
    (await request("other", `/v1/connect/${attempt.id}`)).status,
    404,
  );
  assert.equal(
    (await request(`owner:${randomUUID()}`, `/v1/connect/${attempt.id}`))
      .status,
    404,
  );
  assert.equal(
    (
      await request(
        token,
        `/v1/connect/${attempt.id}/approve`,
        approval(attempt),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("owner", `/v1/connect/${attempt.id}/approve`, {
        ...approval(attempt),
        accountId: randomUUID(),
      })
    ).status,
    400,
  );
  const responses = await Promise.all(
    [1, 2].map(() =>
      request("owner", `/v1/connect/${attempt.id}/approve`, approval(attempt)),
    ),
  );
  assert(
    responses.every((result) => result.status === 200),
    JSON.stringify(responses),
  );
  assert.equal(responses[0].data.projectId, responses[1].data.projectId);
  const approved = responses[0].data as ConnectAttempt;
  assert(approved.projectId);
  assert.equal((await admin("projects").where({ identity })).length, 1);
  assert.deepEqual((await request(token, "/v1/me")).data.grant.projectIds, [
    approved.projectId,
  ]);
  assert.equal(
    (
      await request(token, "/v1/projects", {
        name: "Forbidden",
        identity: `new:${randomUUID()}`,
      })
    ).status,
    403,
  );
  const saved = await request(token, "/v1/memories", {
    content: "A confirmed project decision",
    operationId: randomUUID(),
    projectId: approved.projectId,
  });
  assert.equal(saved.status, 200);
  assert.equal(
    (await request(token, "/v1/recall", { projectId: approved.projectId }))
      .status,
    200,
  );
  assert.equal(
    (
      await request(token, "/v1/memories/delete", {
        operationId: randomUUID(),
        items: [{ id: saved.data.id, expectedVersion: 1 }],
      })
    ).status,
    403,
  );
  const repeated = await request("owner", `/v1/connect/${attempt.id}/approve`, {
    ...approval(attempt),
    allProjects: true,
  });
  assert.equal(
    repeated.data.grant.allProjects,
    false,
    "Replay cannot apply different permissions",
  );
  const resumed = (await begin(token, identity)).attempt;
  assert.equal(resumed.status, "approved");
  assert.equal(resumed.projectId, approved.projectId);
  assert.equal(resumed.grant.allProjects, false);
  assert.equal(
    (await db("connections").where({ id: attempt.connectionId })).length,
    0,
    "RLS blocks missing tenant context",
  );
  const secondAccount = await begin(`other:${randomUUID()}`, identity);
  const secondApproval = await request(
    "other",
    `/v1/connect/${secondAccount.attempt.id}/approve`,
    approval(secondAccount.attempt),
  );
  assert.equal(secondApproval.status, 200);
  assert.notEqual(
    secondApproval.data.projectId,
    approved.projectId,
    "Same repository remains account-owned",
  );
});

test("approval rolls back on invalid scope, cancelled/expired/replaced requests cannot grant access", async () => {
  const { token, attempt, identity } = await begin();
  assert.equal(
    (
      await request("owner", `/v1/connect/${attempt.id}/approve`, {
        ...approval(attempt),
        projectIds: [randomUUID()],
      })
    ).status,
    404,
  );
  assert.equal((await admin("projects").where({ identity })).length, 0);
  assert.equal(
    (await request("other", `/v1/connect/${attempt.id}/cancel`, {})).status,
    404,
  );
  assert.equal(
    (await request(token, `/v1/connect/${attempt.id}/cancel`, {})).data.status,
    "cancelled",
  );
  assert.equal(
    (
      await request(
        "owner",
        `/v1/connect/${attempt.id}/approve`,
        approval(attempt),
      )
    ).status,
    410,
  );
  const next = (await begin(token, identity)).attempt;
  assert.notEqual(next.id, attempt.id);
  assert.equal(
    (
      await request(
        "owner",
        `/v1/connect/${attempt.id}/approve`,
        approval(attempt),
      )
    ).status,
    404,
  );
  await admin("connections")
    .where({ id: next.connectionId })
    .update({
      setup: JSON.stringify({ ...next, expiresAt: new Date(0).toISOString() }),
    });
  assert.equal(
    (await request(token, `/v1/connect/${next.id}`)).data.status,
    "expired",
  );
  assert.equal(
    (await request("owner", `/v1/connect/${next.id}/approve`, approval(next)))
      .status,
    410,
  );
  assert.deepEqual((await request(token, "/v1/me")).data.capabilities, []);
});

test("manual edits and revocation invalidate outstanding approval links and API keys cannot request broader access", async () => {
  const { token, attempt } = await begin();
  const personal = {
    ...attempt.grant,
    name: "Reader",
    capabilities: ["memory:read"],
    personal: true,
    allProjects: false,
    projectIds: [],
  };
  assert.equal(
    (
      await request(
        "owner",
        `/v1/connections/${attempt.connectionId}`,
        personal,
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "owner",
        `/v1/connect/${attempt.id}/approve`,
        approval(attempt),
      )
    ).status,
    404,
  );
  assert.deepEqual((await request(token, "/v1/me")).data.capabilities, [
    "memory:read",
  ]);
  const pending = (await begin(token)).attempt;
  await request(
    "owner",
    `/v1/connections/${attempt.connectionId}`,
    undefined,
    "DELETE",
  );
  assert.equal((await request(token, "/v1/me")).status, 403);
  assert.equal(
    (
      await request(
        "owner",
        `/v1/connect/${pending.id}/approve`,
        approval(pending),
      )
    ).status,
    404,
  );
  const key = (await request("owner", "/v1/keys", personal)).data.secret;
  assert.equal(
    (await request(key, "/v1/connect", { agent: "claude", project: null })).data
      .status,
    "approved",
  );
  assert.equal(
    (
      await request(key, "/v1/connect", {
        agent: "claude",
        project: { name: "New", identity: randomUUID() },
      })
    ).status,
    403,
  );
});

test("resuming a deliberately narrower approval preserves its chosen actions and excluded current project", async () => {
  const { token, attempt, identity } = await begin();
  const result = await request("owner", `/v1/connect/${attempt.id}/approve`, {
    ...approval(attempt),
    capabilities: ["memory:read"],
    currentProject: false,
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.projectId, null);
  assert.equal((await admin("projects").where({ identity })).length, 0);
  const resumed = (await begin(token, identity)).attempt;
  assert.equal(resumed.id, attempt.id);
  assert.equal(resumed.status, "approved");
  assert.equal(resumed.projectId, null);
  assert.deepEqual(resumed.grant.capabilities, ["memory:read"]);
  assert.deepEqual(resumed.grant.projectIds, []);
});
