import { test } from "node:test";
import assert from "node:assert/strict";
import * as oauth from "../../packages/browser-extension/src/oauth.ts";

test("extension OAuth binds callback, public registration and private session secrets", async () => {
  assert.equal(typeof oauth.authorizationCode, "function");
  assert.equal(typeof oauth.BrowserOAuth, "function");
  const redirect = "https://example.chromiumapp.org/";
  assert.equal(
    oauth.authorizationCode(
      `${redirect}?code=valid&state=csrf&iss=https%3A%2F%2Fissuer.example`,
      redirect,
      "csrf",
      "https://issuer.example",
    ),
    "valid",
  );
  for (const callback of [
    `${redirect}?code=x&state=wrong`,
    "https://evil.example/?code=x&state=csrf",
    `${redirect}extra?code=x&state=csrf`,
    `${redirect}?code=x&state=csrf&iss=https://evil.example`,
    `${redirect}?error=denied&state=csrf`,
    `${redirect}?code=x&code=y&state=csrf`,
  ])
    assert.throws(() =>
      oauth.authorizationCode(
        callback,
        redirect,
        "csrf",
        "https://issuer.example",
      ),
    );
  const local = new Map<string, unknown>(),
    session = new Map<string, unknown>();
  const store = (map: Map<string, unknown>) => ({
    async get(key: string) {
      return map.get(key);
    },
    async set(key: string, value: unknown) {
      map.set(key, structuredClone(value));
    },
    async remove(key: string) {
      map.delete(key);
    },
  });
  const provider = new oauth.BrowserOAuth(
    { apiOrigin: "https://api.example", issuer: "https://issuer.example" },
    store(local),
    store(session),
    {
      getRedirectURL: () => redirect,
      launchWebAuthFlow: async () => `${redirect}?code=x&state=bad`,
    },
  );
  await assert.rejects(
    provider.saveClientInformation({
      client_id: "public",
      client_secret: "not-allowed",
    }),
  );
  await provider.saveClientInformation({
    client_id: "public",
    issuer: "https://issuer.example",
  });
  await provider.saveTokens({
    access_token: "private-access",
    refresh_token: "private-refresh",
    token_type: "Bearer",
    expires_in: 300,
    issuer: "https://issuer.example",
  });
  assert.ok(!JSON.stringify([...local.values()]).includes("private-access"));
  assert.ok(!JSON.stringify([...local.values()]).includes("private-refresh"));
  assert.equal(await provider.bearer(), "private-access");
  assert.deepEqual(provider.clientMetadata.redirect_uris, [redirect]);
  assert.equal(provider.clientMetadata.token_endpoint_auth_method, "none");
  assert.equal(provider.clientMetadata.scope, "openid offline_access");
  await provider.invalidateCredentials("tokens");
  assert.equal(await provider.tokens(), undefined);
});

test("SDK discovery performs public PKCE exchange and single-flight renewal without leaking browser secrets", async () => {
  const local = new Map<string, unknown>(),
    session = new Map<string, unknown>();
  const store = (values: Map<string, unknown>) => ({
    async get(key: string) {
      return values.get(key);
    },
    async set(key: string, value: unknown) {
      values.set(key, structuredClone(value));
    },
    async remove(key: string) {
      values.delete(key);
    },
  });
  const original = globalThis.fetch,
    requests: { url: string; body: URLSearchParams }[] = [];
  let verifier = "",
    refreshes = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input),
      body = new URLSearchParams(String(init?.body ?? ""));
    requests.push({ url, body });
    if (url.includes("oauth-protected-resource"))
      return Response.json({
        resource: "https://api.example/mcp",
        authorization_servers: ["https://issuer.example"],
        scopes_supported: ["openid", "offline_access"],
      });
    if (url.includes(".well-known/"))
      return Response.json({
        issuer: "https://issuer.example",
        authorization_endpoint: "https://issuer.example/authorize",
        token_endpoint: "https://issuer.example/token",
        registration_endpoint: "https://issuer.example/register",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (url.endsWith("/register")) {
      const metadata = JSON.parse(String(init?.body));
      assert.equal(metadata.token_endpoint_auth_method, "none");
      return Response.json(
        { ...metadata, client_id: "fixture-public" },
        { status: 201 },
      );
    }
    if (url.endsWith("/token")) {
      assert.equal(body.get("client_id"), "fixture-public");
      assert.equal(body.has("client_secret"), false);
      if (body.get("grant_type") === "authorization_code") {
        verifier = body.get("code_verifier")!;
        assert.ok(verifier.length >= 43);
        assert.equal(body.get("code"), "fixture-code");
      } else {
        assert.equal(body.get("grant_type"), "refresh_token");
        refreshes++;
      }
      return Response.json({
        access_token: refreshes ? "renewed-private" : "initial-private",
        refresh_token: "refresh-private",
        token_type: "Bearer",
        expires_in: refreshes ? 3600 : 1,
      });
    }
    throw new Error(`Unexpected OAuth request ${url}`);
  };
  try {
    const provider = new oauth.BrowserOAuth(
      { apiOrigin: "https://api.example", issuer: "https://issuer.example" },
      store(local),
      store(session),
      {
        getRedirectURL: () => "https://fixture.chromiumapp.org/",
        async launchWebAuthFlow({ url }) {
          const authorization = new URL(url);
          assert.equal(authorization.origin, "https://issuer.example");
          assert.equal(
            authorization.searchParams.get("code_challenge_method"),
            "S256",
          );
          assert.ok(authorization.searchParams.get("code_challenge"));
          return `https://fixture.chromiumapp.org/?code=fixture-code&state=${authorization.searchParams.get("state")}`;
        },
      },
    );
    assert.equal(await provider.signIn(), "initial-private");
    assert.ok(verifier);
    assert.deepEqual(
      await Promise.all([provider.bearer(), provider.bearer()]),
      ["renewed-private", "renewed-private"],
    );
    assert.equal(refreshes, 1);
    assert.ok(requests.length > 3);
    assert.ok(!JSON.stringify([...local.values()]).includes("private"));
    assert.ok(
      ![...session.keys()].some(
        (key) => key.endsWith(":state") || key.endsWith(":verifier"),
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});
