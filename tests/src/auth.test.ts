import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { clerkVerifier } from "../../packages/api/src/auth.ts";
import { readServerEnvironment } from "@lib/environment";

test("actual RS256 verification rejects wrong issuer, audience party, signature, expiry and machine escalation", async () => {
  const key = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(key.publicKey)),
    kid: "grove-auth-test",
    alg: "RS256",
    use: "sig",
  };
  const server = createServer((_request, response) =>
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ keys: [jwk] })),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address && typeof address !== "string");
  const issuer = `http://127.0.0.1:${address.port}`;
  const env = readServerEnvironment({
    API_ORIGIN: "http://localhost:26080",
    SITE_URL: "http://localhost:3000",
    DATABASE_URL: "unused",
    CLERK_ISSUER: issuer,
    CLERK_SECRET_KEY: "sk_test_fixture",
    CLERK_PUBLISHABLE_KEY:
      "pk_test_d2FudGVkLWJpc29uLTM5NTAuY2xlcmsuYWNjb3VudHMuZGV2JA",
    CLERK_WEBHOOK_SIGNING_SECRET: "whsec_test",
    CURSOR_SECRET: "a".repeat(32),
  });
  const verifier = clerkVerifier(env);
  const make = (claims: Record<string, unknown> = {}, wrongKey = false) =>
    new SignJWT({
      sub: "user_alice",
      sid: "sess_test",
      azp: env.SITE_URL,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      iss: issuer,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
      .sign(wrongKey ? other.privateKey : key.privateKey);
  try {
    assert.equal((await verifier.verify(await make())).subject, "user_alice");
    for (const claims of [
      { iss: "https://foreign.example" },
      { azp: "https://foreign.example" },
      { exp: 1 },
      { client_id: "machine" },
      { sub: "m2m_bot" },
      { sts: "pending" },
    ])
      await assert.rejects(verifier.verify(await make(claims)), {
        code: "unauthorized",
      });
    await assert.rejects(verifier.verify(await make({}, true)), {
      code: "unauthorized",
    });
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
