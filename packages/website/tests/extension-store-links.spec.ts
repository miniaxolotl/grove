import { expect, test } from "@playwright/test";

const connections = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}/app/settings/connections`;
const install = "/install#browser-extension";
const stores = [
  "https://addons.mozilla.org/firefox/addon/grove-private-notes/",
  "https://microsoftedge.microsoft.com/addons/detail/epmjpecpdnjbgbjnjkfjafonocecffmo",
  "https://chromewebstore.google.com/detail/ghcndbpbnocjiefnbikdoakajemflcaa",
];

for (const [name, ua, brand, expected, width] of [
  ["Edge", "Windows NT Chrome/156.0 Edg/156.0", "Chromium", 1, 1280],
  ["Chrome", "Windows NT Chrome/156.0", "Google Chrome", 2, 1280],
  ["Firefox", "X11 Firefox/159.0", "", 0, 1280],
  ["unbranded Chromium", "X11 Chrome/156.0", "Chromium", -1, 1280],
  ["unsupported Firefox", "X11 Firefox/141.0", "", -1, 1280],
  ["mobile", "Android Chrome/156.0 Mobile", "Google Chrome", -1, 320],
  ["iPhone", "iPhone Mobile Safari", "", -1, 390],
] as const) {
  test(`${name}: Install and Connections keep direct store choices`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(
      ({ ua, brand }) => {
        Object.defineProperty(navigator, "userAgent", { value: ua });
        Object.defineProperty(navigator, "userAgentData", {
          value: { brands: [{ brand }] },
        });
      },
      { ua, brand },
    );
    await page.route("**/api/grove/**", (route) =>
      route.fulfill({ json: { success: true, data: [] } }),
    );
    await page.goto("/writing");
    await page
      .getByRole("link", { name: "browser extension", exact: true })
      .press("Enter");
    await expect(page).toHaveURL(new RegExp(`${install}$`));
    for (const url of [install, connections]) {
      if (url === connections) await page.goto(url);
      const links = page
        .getByRole("list", { name: "Browser extension stores" })
        .getByRole("link");
      await expect(links).toHaveCount(3);
      if (url === connections) {
        await expect(links.nth(2)).toContainText("Chrome setup guide");
        const recommended = links.filter({ hasText: "(your browser)" });
        await expect(recommended).toHaveCount(expected === -1 ? 0 : 1);
        if (expected !== -1)
          await expect(links.nth(expected)).toHaveAccessibleName(
            /your browser/,
          );
      } else {
        await expect(links.nth(2)).toContainText("not yet available");
        if (expected !== -1)
          await expect(links.nth(expected)).toContainText("Your browser");
        await expect(links.filter({ hasText: "Your browser" })).toHaveCount(
          expected === -1 ? 0 : 1,
        );
      }
      await links.first().focus();
      for (const [index, href] of stores.entries()) {
        const link = links.nth(index);
        await expect(link).toBeFocused();
        await expect(link).toHaveAttribute(
          "href",
          url === connections && index === 2 ? install : href,
        );
        await expect(link).toBeInViewport({ ratio: 1 });
        if (index < 2) await page.keyboard.press("Tab");
      }
    }
  });
}

test("without JavaScript, Install serves three neutral store choices", async ({
  browser,
  baseURL,
}) => {
  const page = await browser.newPage({
    baseURL,
    javaScriptEnabled: false,
    userAgent: "X11 Firefox/159.0",
  });
  await page.goto(install);
  const list = page.getByRole("list", { name: "Browser extension stores" });
  await expect(list.getByRole("link")).toHaveCount(3);
  await expect(list).not.toContainText("Your browser");
  await page.close();
});
