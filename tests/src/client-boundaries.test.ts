import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
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
