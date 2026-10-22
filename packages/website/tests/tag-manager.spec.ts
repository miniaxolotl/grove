import { test, expect } from "@playwright/test";

const origin = "https://usegrove.cloud";
const container = "GTM-M5WKD5LZ";
const preference = "grove.telemetry.optout";
const proxyResponses: Promise<void>[] = [];

test.afterEach(async ({ context, page }) => {
  // Settle document and prefetch responses before removing the local proxy.
  await page.waitForLoadState("networkidle");
  await Promise.all(proxyResponses);
  await context.unrouteAll({ behavior: "wait" });
});

test("a compact notice can be dismissed once without optional requests", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      /googletagmanager|posthog\.com|sentry\.io|_vercel\/(insights|speed-insights)/.test(
        request.url(),
      )
    )
      requests.push(request.url());
  });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(origin);
  const notice = page.getByRole("complementary", { name: "Cookie choices" });
  await expect(notice).toBeVisible();
  expect((await notice.boundingBox())!.height).toBeLessThan(210);
  await page.getByRole("button", { name: "No thanks", exact: true }).click();
  await expect(notice).toBeHidden();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(notice).toBeHidden();
  expect(requests).toEqual([]);
  await page
    .getByRole("button", { name: "Cookie settings", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Analytics", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Advertising", exact: true }),
  ).not.toBeChecked();
});

for (const category of ["Analytics", "Advertising"]) {
  test(`${category} consent is independent and survives a reload`, async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(origin);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("checkbox", { name: category, exact: true }).check();
    await page
      .getByRole("button", { name: "Save choices", exact: true })
      .click();
    await page.waitForLoadState("networkidle");
    expect(requests.some((url) => url.includes("googletagmanager.com"))).toBe(
      category === "Advertising",
    );
    expect(requests.some((url) => /posthog\.com|sentry\.io/.test(url))).toBe(
      category === "Analytics",
    );
    requests.length = 0;
    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(requests.some((url) => url.includes("googletagmanager.com"))).toBe(
      category === "Advertising",
    );
    expect(requests.some((url) => /posthog\.com|sentry\.io/.test(url))).toBe(
      category === "Analytics",
    );
  });
}

test.beforeEach(async ({ context, baseURL }) => {
  proxyResponses.length = 0;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      const response = route
        .fetch({
          url: `${baseURL}${url.pathname}${url.search}`,
        })
        .then((response) => route.fulfill({ response }));
      proxyResponses.push(response);
      return response;
    }
    if (url.hostname === "www.googletagmanager.com")
      return route.fulfill({
        contentType: "application/javascript",
        body: "window.__gtmTestLoaded = true;",
      });
    if (url.origin === baseURL) return route.continue();
    return route.abort();
  });
});

test("loads the matching container once and unloads tags on opt-out", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("googletagmanager.com"))
      requests.push(request.url());
  });
  await page.goto(`${origin}/`);
  await page.waitForLoadState("networkidle");
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toBe(
    `https://www.googletagmanager.com/gtm.js?id=${container}`,
  );
  await page
    .getByRole("button", { name: "Cookie settings", exact: true })
    .click();
  await page.getByRole("button", { name: "No thanks", exact: true }).click();
  await expect(page).toHaveURL(/tracking=off/);
  await page.waitForLoadState("networkidle");
  expect(requests).toHaveLength(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page
    .getByRole("button", { name: "Cookie settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page).not.toHaveURL(/tracking=off/);
});

for (const veto of ["stored", "gpc", "dnt", "storage"]) {
  test(`${veto} prevents tag requests`, async ({ page }) => {
    await page.addInitScript(
      ({ veto, preference }) => {
        if (veto === "stored") localStorage.setItem(preference, "true");
        if (veto === "gpc")
          Object.defineProperty(navigator, "globalPrivacyControl", {
            value: true,
          });
        if (veto === "dnt")
          Object.defineProperty(navigator, "doNotTrack", { value: "1" });
        if (veto === "storage")
          Storage.prototype.getItem = () => {
            throw new Error("unavailable");
          };
      },
      { veto, preference },
    );
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("googletagmanager.com"))
        requests.push(request.url());
    });
    await page.goto(`${origin}/`);
    if (veto !== "stored")
      await page
        .getByRole("button", { name: "Accept all", exact: true })
        .click();
    await page.waitForLoadState("networkidle");
    expect(requests).toEqual([]);
  });
}

test("local hosts, private paths and sensitive query parameters never load tags", async ({
  page,
  context,
  baseURL,
}) => {
  const consent = encodeURIComponent(
    JSON.stringify({
      categories: ["necessary", "advertising"],
      revision: 1,
      consentId: "7cb1f2a0-1b21-43b3-9d36-6bbf71224239",
      services: {},
      consentTimestamp: new Date().toISOString(),
      lastConsentTimestamp: new Date().toISOString(),
      expirationTime: Date.now() + 86400000,
    }),
  );
  await context.addCookies(
    [origin, baseURL!].map((url) => ({
      name: "cc_cookie",
      url,
      value: consent,
    })),
  );
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("googletagmanager.com"))
      requests.push(request.url());
  });
  for (const url of [
    baseURL!,
    `${origin}/s/private-canary`,
    `${origin}/?token=private-canary`,
  ]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
  }
  expect(requests).toEqual([]);
});

test("marketing navigation leaves the tag document before entering sign-up", async ({
  page,
}) => {
  await page.goto(`${origin}/`);
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(
    1,
  );
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__documentCanary = true;
  });
  await page.getByRole("link", { name: "Start your notebook" }).first().click();
  await expect(page).toHaveURL(/\/sign-up/);
  expect(await page.evaluate(() => "__documentCanary" in window)).toBe(false);
  await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(
    0,
  );
});
