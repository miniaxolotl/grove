import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiClient } from "@lib/integration-core";
import { bearer, saveCredentials } from "@lib/integration-core/node";

for (const mismatch of [
  "resource",
  "issuer",
  "token-issuer",
  "metadata-issuer",
  "malformed-issuer",
] as const)
  test(`OAuth ${mismatch} migration is actionable without presenting or moving old credentials`, async () => {
    const previous = process.env.GROVE_CONFIG_HOME;
    const home = await mkdtemp(join(tmpdir(), "grove-resource-test-"));
    process.env.GROVE_CONFIG_HOME = home;
    let origin = "";
    let credentialRequests = 0;
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "application/json");
      if (request.url?.startsWith("/.well-known/oauth-protected-resource"))
        return response.end(
          JSON.stringify({
            resource:
              mismatch === "resource"
                ? "https://api.grovenote.app/mcp"
                : `${origin}/mcp`,
            authorization_servers: [origin],
          }),
        );
      if (request.url?.startsWith("/.well-known/"))
        return response.end(
          JSON.stringify({
            issuer:
              mismatch === "metadata-issuer"
                ? "https://unrelated.example"
                : origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
          }),
        );
      credentialRequests++;
      response.writeHead(500).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      await saveCredentials({
        origin,
        agent: "opencode",
        accountId: "synthetic-account",
        expiresAt: 1,
        redirectUrl: "http://127.0.0.1:34142/callback",
        client: {
          client_id: "synthetic-client",
          ...(mismatch === "issuer"
            ? { issuer: "https://previous.example" }
            : {}),
          ...(mismatch === "malformed-issuer"
            ? { issuer: "PRIVATE malformed issuer" }
            : {}),
        },
        tokens: {
          access_token: "PRIVATE_OLD_ACCESS",
          refresh_token: "PRIVATE_OLD_REFRESH",
          token_type: "Bearer",
          ...(mismatch === "token-issuer"
            ? { issuer: "https://previous.example" }
            : {}),
        },
      });
      const files = await readdir(home);
      const before = await Promise.all(
        files.map((file) => readFile(join(home, file), "utf8")),
      );
      const api = new ApiClient(origin, (signal) =>
        bearer(origin, "opencode", signal),
      );
      await assert.rejects(
        api.request("/v1/me"),
        (error: { code?: string; message?: string }) => {
          assert.equal(
            error.code,
            `oauth_${mismatch === "resource" ? "resource" : "issuer"}_mismatch`,
          );
          assert.match(error.message!, /grove connect opencode/);
          assert.doesNotMatch(error.message!, /PRIVATE|synthetic-client/);
          return true;
        },
      );
      assert.equal(credentialRequests, 0);
      assert.deepEqual(await readdir(home), files);
      assert.deepEqual(
        await Promise.all(
          files.map((file) => readFile(join(home, file), "utf8")),
        ),
        before,
      );
    } finally {
      if (previous === undefined) delete process.env.GROVE_CONFIG_HOME;
      else process.env.GROVE_CONFIG_HOME = previous;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
