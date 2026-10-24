import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const pending = {
  id: "00000000-0000-4000-a000-000000000081",
  name: "Awaiting approval",
  state: "a".repeat(64),
  clientId: "synthetic_chatgpt_client",
  capabilities: [] as string[],
  personal: true,
  allProjects: false,
  projectIds: [],
  revokedAt: null,
  createdAt: "2026-10-24T10:00:00Z",
  lastUsedAt: "2026-10-24T10:01:00Z",
};

test("web chat setup uses OAuth URLs and Personal examples, never a terminal command", async ({
  page,
}) => {
  await page.goto("/install");
  for (const [choice, host] of [
    ["ChatGPT", "https://chatgpt.com/plugins"],
    ["Claude web", "https://claude.ai/customize/connectors"],
  ]) {
    await page.getByRole("tab", { name: choice, exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: choice, exact: true });
    await expect(
      panel.getByLabel("MCP server URL", { exact: true }),
    ).toHaveValue("https://api.usegrove.cloud/mcp");
    await expect(
      panel.getByRole("link", { name: new RegExp(`Open ${choice}`) }),
    ).toHaveAttribute("href", host);
    await expect(panel).toContainText(/register automatically/i);
    await expect(panel).toContainText("No terminal");
    await expect(page.getByText(/Keep the terminal open/)).toHaveCount(0);
    await expect(panel).not.toContainText("npx");
    await expect(
      page.getByText(/personal notes:.*concise answers/),
    ).toBeVisible();
    await expect(panel.getByText(/host decides when to call/)).toBeVisible();
  }
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Claude web", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Claude Code", exact: true }).click();
  await expect(
    page.getByRole("tabpanel", { name: "Claude Code", exact: true }),
  ).toContainText("connect claude");
});

test("hosted setup remains usable without storage or clipboard at phone widths", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Unavailable");
      },
    });
    Object.defineProperty(navigator, "clipboard", { value: undefined });
  });
  await page.goto("/install");
  await page.getByRole("tab", { name: "ChatGPT", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "ChatGPT", exact: true });
  await panel
    .getByRole("button", { name: "Copy MCP server URL", exact: true })
    .click();
  await expect(
    panel.getByText("Select the text below to copy manually."),
  ).toBeVisible();
  await panel
    .getByLabel("MCP server URL", { exact: true })
    .evaluate((input) => (input as HTMLInputElement).select());
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
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
});

test("browser approval identifies the exact OAuth client, preserves narrowed choices on retry and never claims host verification", async ({
  page,
}) => {
  let connection = structuredClone(pending);
  let fail = true;
  let writes = 0;
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "PATCH" && path.endsWith(pending.id)) {
      writes++;
      const body = route.request().postDataJSON();
      expect(body.capabilities).toEqual(["memory:read"]);
      expect(body.personal).toBe(true);
      expect(body.allProjects).toBe(false);
      expect(body.projectIds).toEqual([]);
      expect(body.expectedState).toBe(pending.state);
      if (fail)
        return route.fulfill({
          status: 503,
          json: {
            success: false,
            error: {
              code: "unavailable",
              message: "Approval unavailable. Retry.",
            },
          },
        });
      connection = { ...connection, ...body };
      return route.fulfill({ json: { success: true, data: { connection } } });
    }
    return route.fulfill({
      json: {
        success: true,
        data: path.endsWith("/connections")
          ? [
              connection,
              {
                ...pending,
                id: "00000000-0000-4000-a000-000000000082",
                clientId: "synthetic_claude_client",
              },
            ]
          : [],
      },
    });
  });
  await page.goto(`${base}/app/settings/connections`);
  await expect(
    page.getByText("Awaiting approval", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Connection access" });
  await expect(dialog).toContainText("synthetic_chatgpt_client");
  await expect(dialog).not.toContainText("synthetic_claude_client");
  await dialog.getByLabel("Name", { exact: true }).fill("ChatGPT test");
  await expect(
    dialog.getByLabel("Delete notes", { exact: true }),
  ).not.toBeChecked();
  await expect(
    dialog.getByLabel("All current and future notebooks", { exact: true }),
  ).not.toBeChecked();
  await dialog.getByLabel("Save and update notes", { exact: true }).uncheck();
  await dialog
    .getByRole("button", { name: "Approve access", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Approval unavailable");
  await expect(
    dialog.getByLabel("Save and update notes", { exact: true }),
  ).not.toBeChecked();
  fail = false;
  await dialog
    .getByRole("button", { name: "Approve access", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const status = page
    .getByRole("status")
    .filter({ hasText: "Access approved" });
  await expect(status).toContainText("Access approved. Return to your chat");
  await expect(status).toContainText("save and recall");
  expect(writes).toBe(2);
});

test("Connections offers an explicit refresh for newly signed-in hosted clients", async ({
  page,
}) => {
  let appeared = false;
  await page.route("**/api/grove/**", async (route) =>
    route.fulfill({
      json: {
        success: true,
        data:
          new URL(route.request().url()).pathname.endsWith("/connections") &&
          appeared
            ? [pending]
            : [],
      },
    }),
  );
  await page.goto(`${base}/app/settings/connections`);
  await expect(page.getByText("Your agents are welcome here.")).toBeVisible();
  appeared = true;
  await page
    .getByRole("button", { name: "Refresh connections", exact: true })
    .click();
  await expect(
    page.getByText("synthetic_chatgpt_client", { exact: false }),
  ).toBeVisible();
});

test("stale approval preserves the review, blocks duplicate submissions and requires an explicit refresh", async ({
  page,
}) => {
  let connection = structuredClone(pending);
  let writes = 0;
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "PATCH" && path.endsWith(pending.id)) {
      writes++;
      await held;
      connection = {
        ...connection,
        name: "Updated elsewhere",
        capabilities: ["memory:read"],
        state: "b".repeat(64),
      };
      return route.fulfill({
        status: 409,
        json: {
          success: false,
          error: {
            code: "connection_conflict",
            message:
              "Connection access changed. Close this dialog, refresh Connections, and review the current permissions before saving.",
          },
        },
      });
    }
    return route.fulfill({
      json: {
        success: true,
        data: path.endsWith("/connections") ? [connection] : [],
      },
    });
  });
  await page.goto(`${base}/app/settings/connections`);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Connection access" });
  await dialog.getByLabel("Name", { exact: true }).fill("My retained review");
  await dialog.getByLabel("Save and update notes", { exact: true }).uncheck();
  await dialog.locator("form").evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });
  await expect(
    dialog.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect.poll(() => writes).toBe(1);
  finish();
  await expect(dialog.getByRole("alert")).toContainText(
    "Connection access changed",
  );
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
    "My retained review",
  );
  await expect(
    dialog.getByLabel("Save and update notes", { exact: true }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Refresh connections", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit scope", exact: true }).click();
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
    "Updated elsewhere",
  );
  await expect(
    dialog.getByLabel("Save and update notes", { exact: true }),
  ).not.toBeChecked();
  expect(writes).toBe(1);
});
