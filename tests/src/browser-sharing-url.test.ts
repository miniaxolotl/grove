import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveShareUrl } from "../../packages/browser-extension/src/sharing.ts";

const token = `gsh_${"A".repeat(43)}`;
const siteOrigin = "https://usegrove.cloud";
const now = Date.parse("2026-11-07T00:00:00.000Z");

function state(url: string | undefined, expiresAt?: string | null) {
  return {
    target: { version: 1 },
    available: true,
    canShare: true,
    direct:
      url === undefined
        ? null
        : {
            id: "00000000-0000-4000-a000-000000000001",
            url,
            version: 1,
            duration: "1w",
            expiresAt: expiresAt === undefined ? null : expiresAt,
            active: true,
          },
  } as never;
}

test("share URLs require active same-origin tokens without smuggled parts", async (t) => {
  await t.test("accepts exact same-origin token links", () => {
    assert.equal(
      resolveShareUrl(state(`${siteOrigin}/s/${token}`), siteOrigin, now),
      `${siteOrigin}/s/${token}`,
    );
  });

  await t.test("rejects missing, inactive, expired or foreign links", () => {
    assert.equal(resolveShareUrl(undefined, siteOrigin, now), null);
    assert.equal(resolveShareUrl(state(undefined), siteOrigin, now), null);
    assert.equal(
      resolveShareUrl(
        state(`${siteOrigin}/s/${token}`, "2026-11-06T00:00:00.000Z"),
        siteOrigin,
        now,
      ),
      null,
    );
    assert.equal(
      resolveShareUrl(
        state(`https://evil.example/s/${token}`),
        siteOrigin,
        now,
      ),
      null,
    );
    assert.equal(
      resolveShareUrl(state(`${siteOrigin}/s/short`), siteOrigin, now),
      null,
    );
  });

  await t.test("rejects query, hash and path smuggling", () => {
    for (const url of [
      `${siteOrigin}/s/${token}?x=1`,
      `${siteOrigin}/s/${token}#x`,
      `${siteOrigin}/s/${token}/extra`,
      `${siteOrigin}/other/${token}`,
    ])
      assert.equal(resolveShareUrl(state(url), siteOrigin, now), null);
  });
});
