import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { ConnectAttempt } from "@lib/shared/contracts";
import { catalogResponse } from "./fixtures/notebook-catalog";

test("approval summary opens contextual access editors without granting access or losing narrowed choices", async ({
  page,
}) => {
  let approvals = 0;
  const projects = Array.from({ length: 205 }, (_, index) => ({
    id: `00000000-0000-4000-a000-${String(index + 1).padStart(12, "0")}`,
    name: `Field notebook ${index + 1}`,
    identity: `fixture:${index}`,
    parentId: null,
  }));
  await page.route("**/api/grove/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/approve")) approvals++;
    return route.fulfill({
      json: {
        success: true,
        data: path.includes("/connect/")
          ? initial
          : catalogResponse(route.request().url(), projects),
      },
    });
  });
  await page.goto(`${base}/app/connect/${initial.id}`);
  const summary = page.getByRole("region", {
    name: "Permission summary",
    exact: true,
  });
  expect(
    (await summary
      .getByRole("button", { name: "Edit actions", exact: true })
      .boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  await summary
    .getByRole("button", { name: "Edit actions", exact: true })
    .click();
  const deleting = page.getByLabel("Delete notes", { exact: true });
  await expect(page.getByLabel("Read notes", { exact: true })).toBeFocused();
  await deleting.uncheck();
  await summary
    .getByRole("button", { name: "Edit notebooks", exact: true })
    .click();
  const all = page.getByLabel("All current and future notebooks", {
    exact: true,
  });
  await expect(all).toBeFocused();
  await all.uncheck();
  await page.getByLabel("Field notebook 205", { exact: true }).check();
  await expect(deleting).not.toBeChecked();
  await expect(summary).toContainText("Read notes");
  await expect(summary).not.toContainText("Delete notes");
  expect(approvals).toBe(0);
});

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
    capabilities: ["memory:read", "memory:write", "memory:delete"],
    personal: true,
    allProjects: true,
    projectIds: [],
  },
};

test("browser setup asks for scoped approval without a Settings visit", async ({
  page,
}) => {
  const id = initial.connectionId;
  let requests = 0;
  let fail = true;
  const connection = {
    ...initial.grant,
    id,
    name: "Awaiting approval",
    capabilities: [],
    clientId: "extension-client",
    state: "signed-fixture",
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/connections/${id}`)) {
      expect(route.request().method()).toBe("PATCH");
      requests++;
      expect(route.request().postDataJSON()).toMatchObject({
        name: "My writing browser",
        expectedState: "signed-fixture",
        capabilities: ["memory:read"],
        personal: true,
        allProjects: false,
        projectIds: [],
        writingEnabled: false,
        sharingEnabled: false,
      });
      if (fail)
        return route.fulfill({
          status: 503,
          json: { success: false, error: { message: "Try again shortly." } },
        });
    }
    await route.fulfill({
      json: {
        success: true,
        data: path.endsWith("/connections")
          ? [connection]
          : path.endsWith(`/connections/${id}`)
            ? {}
            : catalogResponse(route.request().url(), []),
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const url = `${base}/app/connect/browser/${id}`;
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Connect your browser" }),
  ).toBeVisible();
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("Grove browser extension");
  await name.fill("My writing browser");
  await expect(
    page.getByLabel("Delete notes", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("All current and future notebooks"),
  ).not.toBeChecked();
  await expect(page.getByLabel("Allow AI writing tools")).not.toBeChecked();
  expect(requests).toBe(0);
  const save = page.getByLabel("Save and update notes", { exact: true });
  await save.uncheck();
  const approve = page.getByRole("button", { name: "Approve access" });
  await approve.click();
  await expect(page.getByRole("alert")).toContainText("Try again shortly.");
  await expect(save).not.toBeChecked();
  await expect(name).toHaveValue("My writing browser");
  fail = false;
  await approve.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Browser connected" }),
  ).toBeVisible();
  await expect(page).toHaveURL(url);
  expect(requests).toBe(2);
  await page.goto(`${base}/app/connect/browser/${initial.id}`);
  await expect(
    page.getByText("This connection is unavailable.", { exact: false }),
  ).toBeVisible();
  await expect(approve).toHaveCount(0);
});

test("hiding a connection is reversible and does not change its grant", async ({
  page,
}) => {
  const url = `${base}/app/settings/connections`;
  const id = initial.connectionId;
  const connection = {
    ...initial.grant,
    id,
    name: "Old laptop",
    clientId: "extension-client",
    createdAt: "2026-10-01T00:00:00Z",
    revokedAt: null,
  };
  const writes: string[] = [];
  await page.route("**/api/grove/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (
      pathname.includes("/connections/") &&
      route.request().method() !== "GET"
    )
      writes.push(pathname);
    return route.fulfill({
      json: {
        success: true,
        data: pathname.endsWith("/connections") ? [connection] : [],
      },
    });
  });
  await page.goto(url);
  const title = page.getByRole("heading", { name: "Old laptop" });
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(title).toBeHidden();
  const hidden = page
    .locator("summary")
    .getByText("Hidden connections (1)", { exact: true });
  await expect(hidden).toBeFocused();
  await page.reload();
  await expect(hidden).toBeVisible();
  await expect(title).toBeHidden();
  await page.goto(`${url}#connection-${id}`);
  await expect(title).toBeVisible();
  await page.goto(url);
  await hidden.click();
  await page.getByRole("button", { name: "Show again", exact: true }).click();
  await expect(title).toBeVisible();
  await expect(hidden).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("contextual approval starts with every permission selected, preserves narrowed choices after failure and completes without a dashboard detour", async ({
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
    await route.fulfill({
      json: {
        success: true,
        data: catalogResponse(route.request().url(), data),
      },
    });
  });
  await page.goto(`${base}/app/connect/${initial.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Connect OpenCode.",
  );
  await expect(page.getByLabel("Unfiled notes", { exact: true })).toBeChecked();
  await expect(page.getByLabel("This notebook: My project")).toBeChecked();
  await expect(page.getByLabel("Permission summary")).toHaveText(
    /Read notesSave and update notesDelete notesAll current and future notebooks/,
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
  await expect(page.getByLabel("Delete notes", { exact: true })).toBeChecked();
  await expect(
    page.getByLabel("All current and future notebooks", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("Delete notes", { exact: true }).uncheck();
  await page
    .getByLabel("All current and future notebooks", { exact: true })
    .uncheck();
  await page.getByLabel("Save and update notes", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Connect OpenCode", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Please retry your connection",
  );
  await expect(
    page.getByLabel("Save and update notes", { exact: true }),
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
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Connect OpenCode", exact: true }),
  ).toBeEnabled();
});

test("optional projects failure leaves compact approval usable and retries preserve choices", async ({
  page,
}, info) => {
  let fail = true;
  await page.setViewportSize({ width: 320, height: 640 });
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/projects/catalog") && fail)
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
      json: {
        success: true,
        data: path.includes("/connect/")
          ? initial
          : catalogResponse(route.request().url(), []),
      },
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
  await page.screenshot({ path: info.outputPath("approval-320.png") });
  await page.getByLabel("Unfiled notes", { exact: true }).uncheck();
  await page.getByText("Customize access", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Other projects could not load",
  );
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByLabel("Unfiled notes", { exact: true }),
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
  await page.getByLabel("Unfiled notes", { exact: true }).uncheck();
  await expect(page.getByRole("status")).toContainText("Reconnecting to Grove");
  await expect(
    page.getByRole("heading", { name: "Connection expired." }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Unfiled notes", { exact: true }),
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
  await expect(page.getByLabel("This notebook: My project")).toBeChecked();
});
