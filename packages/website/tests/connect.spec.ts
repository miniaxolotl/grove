import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { ConnectAttempt } from "@lib/shared/contracts";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const initial: ConnectAttempt = {
  id: "00000000-0000-4000-a000-000000000007",
  connectionId: "00000000-0000-4000-a000-000000000008",
  clientId: "client_example",
  agent: "opencode",
  project: { name: "My project", identity: "git:github.com/example/project" },
  projectId: null,
  status: "pending",
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  grant: {
    name: "OpenCode · My project",
    capabilities: ["memory:read", "memory:write"],
    personal: true,
    allProjects: false,
    projectIds: [],
  },
};

test("contextual approval has scoped defaults, preserves choices after failure and completes without a dashboard detour", async ({
  page,
}) => {
  let fail = true;
  let attempt = structuredClone(initial);
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith("/approve")) {
      if (fail)
        return route.fulfill({
          status: 503,
          json: {
            success: false,
            error: {
              code: "unavailable",
              message: "Please retry your connection",
            },
          },
        });
      const body = route.request().postDataJSON();
      expect(body.personal).toBe(true);
      expect(body.allProjects).toBe(false);
      expect(body.currentProject).toBe(true);
      expect(body.capabilities).toEqual(["memory:read"]);
      attempt = {
        ...attempt,
        status: "approved",
        projectId: "00000000-0000-4000-a000-000000000009",
      };
    }
    if (path.includes("/connect/")) data = attempt;
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${base}/app/connect/${initial.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Connect OpenCode.",
  );
  await expect(
    page.getByLabel("Personal memories", { exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("This project: My project")).toBeChecked();
  await expect(page.getByLabel("Permission summary")).toHaveText(
    /Read memoriesSave and update memories/,
  );
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page.getByText("Customize access", { exact: true }).click();
  await expect(
    page.getByLabel("Delete memories", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("All current and future projects", { exact: true }),
  ).not.toBeChecked();
  await page.getByLabel("Save and update memories", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Connect OpenCode", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Please retry your connection",
  );
  await expect(
    page.getByLabel("Save and update memories", { exact: true }),
  ).not.toBeChecked();
  fail = false;
  await page
    .getByRole("button", { name: "Connect OpenCode", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Access approved. Back to your terminal.",
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/app/connect/${initial.id}$`));
});

test("cancelled, expired and wrong-account links never display an approved state", async ({
  page,
}) => {
  let mode = "pending";
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/cancel")) mode = "cancelled";
    if (mode === "wrong")
      return route.fulfill({
        status: 404,
        json: {
          success: false,
          error: {
            code: "connection_unavailable",
            message: "Use the same Grove account as your terminal",
          },
        },
      });
    await route.fulfill({
      json: {
        success: true,
        data: path.includes("/connect/") ? { ...initial, status: mode } : [],
      },
    });
  });
  await page.goto(`${base}/app/connect/${initial.id}`);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Connection cancelled." }),
  ).toBeVisible();
  mode = "expired";
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Connection expired." }),
  ).toBeVisible();
  mode = "wrong";
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("same Grove account");
  await expect(
    page.getByRole("button", { name: "Connect OpenCode", exact: true }),
  ).toHaveCount(0);
  mode = "pending";
  await page.getByRole("button", { name: "Try loading again" }).click();
  await expect(
    page.getByRole("button", { name: "Connect OpenCode", exact: true }),
  ).toBeEnabled();
});

test("optional projects failure leaves compact approval usable and retries preserve choices", async ({
  page,
}) => {
  let fail = true;
  await page.setViewportSize({ width: 320, height: 640 });
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/projects") && fail)
      return route.fulfill({
        status: 503,
        json: {
          success: false,
          error: {
            code: "unavailable",
            message: "Other projects could not load",
          },
        },
      });
    return route.fulfill({
      json: { success: true, data: path.includes("/connect/") ? initial : [] },
    });
  });
  await page.goto(`${base}/app/connect/${initial.id}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByRole("button", { name: "Connect OpenCode", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    page.getByText("Use the same Grove account", { exact: false }),
  ).toHaveCount(0);
  await page.getByLabel("Personal memories", { exact: true }).uncheck();
  await page.getByText("Customize access", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Other projects could not load",
  );
  fail = false;
  await page.getByRole("button", { name: "Try loading again" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByLabel("Personal memories", { exact: true }),
  ).not.toBeChecked();
});

test("a stale tab recovers server state instead of inventing expiration", async ({
  page,
}) => {
  let reads = 0;
  let approved = false;
  const attempt = {
    ...initial,
    expiresAt: new Date(Date.now() + 1500).toISOString(),
  };
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/connect/") && ++reads > 1 && !approved)
      return route.fulfill({
        status: 503,
        json: {
          success: false,
          error: { code: "unavailable", message: "Temporary outage" },
        },
      });
    await route.fulfill({
      json: {
        success: true,
        data: path.includes("/connect/")
          ? { ...attempt, status: approved ? "approved" : "pending" }
          : [],
      },
    });
  });
  await page.goto(`${base}/app/connect/${initial.id}`);
  await page.getByLabel("Personal memories", { exact: true }).uncheck();
  await expect(page.getByRole("status")).toContainText("Reconnecting to Grove");
  await expect(
    page.getByRole("heading", { name: "Connection expired." }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Personal memories", { exact: true }),
  ).not.toBeChecked();
  approved = true;
  await expect(
    page.getByRole("heading", {
      name: "Access approved. Back to your terminal.",
    }),
  ).toBeVisible();
});

test("Connections resumes the contextual approval instead of editing its grant", async ({
  page,
}) => {
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/connections")
      ? [
          {
            ...initial.grant,
            id: initial.connectionId,
            clientId: initial.clientId,
            capabilities: [],
            setup: initial,
          },
        ]
      : path.includes("/connect/")
        ? initial
        : [];
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${base}/app/connections`);
  await page.getByRole("link", { name: "Continue setup", exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/connect/${initial.id}`);
  await expect(page.getByLabel("This project: My project")).toBeChecked();
});
