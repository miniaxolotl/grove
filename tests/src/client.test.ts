import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  bearer,
  saveCredentials,
  loadCredentials,
  clearCredentials,
  automaticContext,
  canonicalRepository,
  projectIdentity,
  updateConfig,
} from "@lib/integration-core/node";

test(
  "shared OAuth refresh is serialized with logout and pending context is discarded on account switch",
  { timeout: 15000 },
  async () => {
    const directory = await mkdtemp(
      join(process.env.CI ? tmpdir() : "/tmp/opencode", "grove-client-"),
    );
    process.env.GROVE_CONFIG_HOME = directory;
    delete process.env.GROVE_API_KEY;
    delete process.env.GROVE_API_URL;
    let origin = "";
    let tokenCalls = 0;
    let blockMe = false;
    let calls = 0;
    let refreshStarted!: () => void;
    const started = new Promise<void>((done) => {
      refreshStarted = done;
    });
    let releaseRefresh!: () => void;
    const refreshWait = new Promise<void>((done) => {
      releaseRefresh = done;
    });
    let recallStarted!: () => void;
    let releaseRecall!: () => void;
    const recallWait = new Promise<void>((done) => {
      releaseRecall = done;
    });
    const recalled = new Promise<void>((done) => {
      recallStarted = done;
    });
    const server = createServer(async (request, response) => {
      calls++;
      response.setHeader("Content-Type", "application/json");
      const reply = (body: unknown) => response.end(JSON.stringify(body));
      if (request.url?.startsWith("/.well-known/oauth-protected-resource"))
        return reply({
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
        });
      if (request.url?.startsWith("/.well-known/"))
        return reply({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      if (request.url === "/token") {
        let body = "";
        for await (const chunk of request) body += chunk;
        const form = new URLSearchParams(body);
        assert.equal(form.get("grant_type"), "refresh_token");
        assert.equal(form.get("refresh_token"), "old-refresh");
        assert.equal(form.get("resource"), `${origin}/mcp`);
        tokenCalls++;
        refreshStarted();
        await refreshWait;
        return reply({
          access_token: "new-access",
          refresh_token: "new-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (request.url === "/v1/me") {
        if (blockMe) return;
        return reply({
          success: true,
          data: {
            accountId: "account-a",
            recallEnabled: true,
            captureEnabled: true,
          },
        });
      }
      if (request.url === "/v1/projects")
        return reply({ success: true, data: [] });
      if (request.url === "/v1/recall") {
        recallStarted();
        await recallWait;
        return reply({
          success: true,
          data: {
            items: [
              {
                id: "old-account",
                version: 1,
                projectId: null,
                kind: "fact",
                source: { agent: "cli" },
                content: "Do not inject this after switching account.",
              },
            ],
            mode: "profile",
            contentVersion: 1,
          },
        });
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    assert(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    try {
      await Promise.all([
        saveCredentials({
          origin,
          agent: "cli",
          accountId: "account-a",
          tokens: {
            access_token: "expired",
            refresh_token: "old-refresh",
            token_type: "Bearer",
            expires_in: 1,
          },
          expiresAt: 1,
          redirectUrl: "http://127.0.0.1:34141/callback",
          client: { client_id: "fixture-client" },
        }),
        saveCredentials({
          origin,
          agent: "claude",
          accountId: "account-b",
          key: "other-agent",
        }),
      ]);
      assert.equal(
        (await loadCredentials(origin, "claude")).key,
        "other-agent",
      );
      await assert.rejects(loadCredentials("http://localhost:1", "cli"), {
        code: "sign_in_required",
      });
      const refresh = bearer(origin, "cli");
      await started;
      const logout = clearCredentials(origin, "cli");
      releaseRefresh();
      assert.equal(await refresh, "new-access");
      await logout;
      assert.equal(tokenCalls, 1);
      await assert.rejects(loadCredentials(origin, "cli"), {
        code: "sign_in_required",
      });
      await saveCredentials({
        origin,
        agent: "cli",
        accountId: "account-a",
        key: "first-account",
      });
      const context = automaticContext("cli", directory);
      await recalled;
      await saveCredentials({
        origin,
        agent: "cli",
        accountId: "account-b",
        key: "second-account",
      });
      releaseRecall();
      assert.equal(await context, "");
      await updateConfig({ paused: true });
      assert.equal(await automaticContext("cli", directory), "");
      assert.equal(
        (await loadCredentials(origin, "cli")).accountId,
        "account-b",
      );
      await updateConfig({ paused: false });
      process.env.GROVE_PRIVATE = "1";
      const privateCalls = calls;
      assert.equal(await automaticContext("cli", directory), "");
      assert.equal(calls, privateCalls);
      delete process.env.GROVE_PRIVATE;
      blockMe = true;
      const began = performance.now();
      assert.equal(await automaticContext("cli", directory), "");
      assert(
        performance.now() - began < 1900,
        "Optional context must respect its 1.5-second deadline",
      );
    } finally {
      releaseRefresh();
      releaseRecall();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      delete process.env.GROVE_CONFIG_HOME;
    }
  },
);

test("repository identity strips credentials and is stable across worktrees", async () => {
  assert.equal(
    canonicalRepository(
      "https://user:secret@github.com/owner/repo.git?token=private",
    ),
    "git:github.com/owner/repo",
  );
  assert.equal(
    canonicalRepository("git@github.com:owner/repo.git"),
    "git:github.com/owner/repo",
  );
  const directory = await mkdtemp(
    join(process.env.CI ? tmpdir() : "/tmp/opencode", "grove-repository-"),
  );
  const repo = join(directory, "repo");
  const worktree = join(directory, "worktree");
  const run = promisify(execFile);
  await mkdir(repo);
  await run("git", ["init", repo]);
  await writeFile(join(repo, "example.txt"), "fixture\n");
  await run("git", ["add", "."], { cwd: repo });
  await run(
    "git",
    [
      "-c",
      "user.name=Grove Test",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd: repo },
  );
  await run("git", ["worktree", "add", worktree], { cwd: repo });
  assert.deepEqual(
    await projectIdentity(repo),
    await projectIdentity(worktree),
  );
  assert.equal(await projectIdentity(directory), null);
});
