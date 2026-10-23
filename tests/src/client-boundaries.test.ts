import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiClient } from "@lib/integration-core";
import {
  loadCredentials,
  readConfig,
  saveCredentials,
} from "@lib/integration-core/node";

test("malformed API envelopes are not reported as network outages", async () => {
  let payload = "not JSON";
  const server = createServer((_request, response) =>
    response.setHeader("Content-Type", "application/json").end(payload),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address && typeof address !== "string");
  const client = new ApiClient(
    `http://127.0.0.1:${address.port}`,
    async () => "fixture",
  );
  try {
    for (const value of [
      "not JSON",
      "null",
      "[]",
      '{"success":true}',
      '{"success":"true","data":{}}',
    ]) {
      payload = value;
      await assert.rejects(client.request("/v1/me"), {
        code: "invalid_response",
      });
    }
    payload =
      '{"success":false,"error":{"code":"connection_revoked","message":"Revoked"}}';
    await assert.rejects(client.request("/v1/me"), {
      code: "connection_revoked",
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

test("API calls preserve the caller's cancellation instead of converting it into timeout", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Fixture cancellation", "AbortError");
  controller.abort(reason);
  const client = new ApiClient("http://127.0.0.1:1", async () => "fixture");
  await assert.rejects(
    client.request("/v1/me", { signal: controller.signal }),
    (error) => error === reason,
  );
});

test("an interrupted API response body remains a network outage", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": "128",
    });
    response.write('{"success":true,"data":', () =>
      setImmediate(() => response.destroy()),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    const client = new ApiClient(
      `http://127.0.0.1:${address.port}`,
      async () => "fixture",
    );
    await assert.rejects(client.request("/v1/me"), { code: "unreachable" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

test("saved credentials require a complete authentication payload without discarding refreshable OAuth", async () => {
  const directory = await mkdtemp(
    join(
      process.env.CI ? tmpdir() : "/tmp/opencode",
      "grove-credential-shape-",
    ),
  );
  const previous = process.env.GROVE_CONFIG_HOME;
  process.env.GROVE_CONFIG_HOME = directory;
  const identity = {
    origin: "https://fixture.test",
    agent: "codex" as const,
    accountId: "fixture-account",
  };
  const oauth = {
    tokens: {
      access_token: "private-access-canary",
      refresh_token: "private-refresh-canary",
      token_type: "Bearer",
    },
    expiresAt: 1,
    client: { client_id: "fixture-client" },
    redirectUrl: "http://127.0.0.1:34144/callback",
  };
  try {
    await saveCredentials({ ...identity, key: "private-key-canary" });
    const credential = join(
      directory,
      (await readdir(directory)).find((file) =>
        file.startsWith("credentials-"),
      )!,
    );
    const config = await readFile(join(directory, "config.json"), "utf8");
    for (const payload of [
      {},
      { key: "" },
      { key: "   " },
      { key: 42 },
      { tokens: null },
      { ...oauth, tokens: {} },
      { ...oauth, tokens: { ...oauth.tokens, access_token: "" } },
      { ...oauth, tokens: { ...oauth.tokens, refresh_token: 42 } },
      { ...oauth, expiresAt: "tomorrow" },
      { ...oauth, client: {} },
      { ...oauth, redirectUrl: "not a URL" },
      { ...oauth, redirectUrl: undefined },
    ]) {
      const source = JSON.stringify({ ...identity, ...payload });
      await writeFile(credential, source);
      await assert.rejects(
        loadCredentials(identity.origin, identity.agent),
        (error: unknown) => {
          assert.equal(
            (error as { code: string }).code,
            "credential_store_unavailable",
          );
          assert.doesNotMatch(String(error), /private-.*-canary/);
          return true;
        },
      );
      assert.equal(await readFile(credential, "utf8"), source);
      assert.equal(
        await readFile(join(directory, "config.json"), "utf8"),
        config,
      );
    }
    const refreshable = { ...identity, ...oauth };
    await writeFile(credential, JSON.stringify(refreshable));
    assert.deepEqual(
      await loadCredentials(identity.origin, identity.agent),
      refreshable,
    );
  } finally {
    if (previous === undefined) delete process.env.GROVE_CONFIG_HOME;
    else process.env.GROVE_CONFIG_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid local configuration and damaged credentials never trigger implicit reauthentication", async () => {
  const directory = await mkdtemp(
    join(process.env.CI ? tmpdir() : "/tmp/opencode", "grove-damaged-store-"),
  );
  const previous = process.env.GROVE_CONFIG_HOME;
  process.env.GROVE_CONFIG_HOME = directory;
  try {
    for (const value of [
      "null",
      "[]",
      '{"paused":"false"}',
      '{"origins":[]}',
      '{"accounts":{"https://fixture.test":null}}',
    ]) {
      await writeFile(join(directory, "config.json"), value);
      await assert.rejects(readConfig(), { code: "invalid_config" });
    }
    await writeFile(join(directory, "config.json"), "{}");
    await saveCredentials({
      origin: "https://fixture.test",
      agent: "codex",
      accountId: "fixture-account",
      key: "private-canary",
    });
    const credential = (await readdir(directory)).find((file) =>
      file.startsWith("credentials-"),
    )!;
    await writeFile(
      join(directory, credential),
      "private-canary: damaged JSON",
    );
    await assert.rejects(
      loadCredentials("https://fixture.test", "codex"),
      (error: unknown) => {
        assert.equal(
          (error as { code: string }).code,
          "credential_store_unavailable",
        );
        assert.doesNotMatch(String(error), /private-canary/);
        return true;
      },
    );
  } finally {
    if (previous === undefined) delete process.env.GROVE_CONFIG_HOME;
    else process.env.GROVE_CONFIG_HOME = previous;
  }
});
