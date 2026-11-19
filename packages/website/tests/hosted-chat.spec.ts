import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { catalogResponse } from "./fixtures/notebook-catalog";

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

test("review last use and explicitly approve every scope", async ({
  page,
}, info) => {
  const writes: unknown[] = [];
  const expiresAt = "2099-11-18T15:30:00Z";
  const notebook = {
    id: "00000000-0000-4000-a000-000000000085",
    name: "Field research",
  };
  let reader = {
    ...pending,
    name: "Research assistant",
    personal: false,
    capabilities: ["memory:read"],
    expiresAt,
    projectIds: [notebook.id],
  };
  const key = {
    ...pending,
    id: "00000000-0000-4000-a000-000000000084",
    name: "Notebook export",
    clientId: null,
    capabilities: ["memory:read"],
    lastUsedAt: null,
  };
  await page.route("**/api/grove/**", (route) => {
    const url = route.request().url();
    if (
      route.request().method() === "PATCH" &&
      url.endsWith(`/connections/${reader.id}`)
    ) {
      const body = route.request().postDataJSON();
      reader = { ...reader, ...body };
      writes.push(body);
      return route.fulfill({
        json: { success: true, data: { connection: reader } },
      });
    }
    return route.fulfill({
      json: {
        success: true,
        data: url.endsWith("/connections")
          ? [reader, key]
          : catalogResponse(
              url,
              url.endsWith("/projects/catalog") ||
                url.includes("/projects/catalog?")
                ? [notebook]
                : [],
            ),
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/app/settings/connections`);
  await expect(page.locator(".connection-last-use time")).toHaveAttribute(
    "datetime",
    pending.lastUsedAt,
  );
  const row = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: reader.name }) });
  await expect(row.getByText(/Last used/)).toBeVisible();
  await expect(page.getByText("Not used yet")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: info.outputPath("setup.png") });
  await row.locator("..").screenshot({ path: info.outputPath("last-use.png") });
  await row.getByRole("button", { name: "Edit scope" }).press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Read notes", { exact: true }).uncheck();
  await expect(
    dialog.getByRole("button", { name: "Approve access" }),
  ).toBeDisabled();
  const all = dialog.getByRole("button", { name: "Approve all scopes" });
  await expect(all).toHaveAccessibleDescription(
    /all current and future notebooks, plus AI writing tools and sharing links/,
  );
  await all.press("Space");
  await expect(dialog).toBeHidden();
  await expect(row).toContainText("All notebooks");
  expect(writes).toEqual([
    {
      name: reader.name,
      capabilities: ["memory:read", "memory:write", "memory:delete"],
      personal: true,
      allProjects: true,
      projectIds: [],
      writingEnabled: true,
      sharingEnabled: true,
      expectedState: pending.state,
      expiresAt,
    },
  ]);
});

test.describe("phone setup", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("open agent and API key setup by touch and return to the same action", async ({
    page,
  }, info) => {
    await page.route("**/api/grove/**", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: catalogResponse(route.request().url(), []),
        },
      }),
    );
    await page.goto(`${base}/app/settings/connections`);
    const setup = page.getByRole("region", { name: "Add a connection" });
    await expect(setup).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await setup.screenshot({ path: info.outputPath("setup-mobile.png") });
    for (const [name, title] of [
      ["Connect an agent", "Connect an agent"],
      ["Create API key", "Create a scoped API key"],
    ]) {
      const action = setup.getByRole("button", { name });
      await action.tap();
      const dialog = page.getByRole("dialog", { name: title });
      if (name === "Connect an agent") {
        const tab = dialog.getByRole("tab", { name: "ChatGPT", exact: true });
        await tab.tap();
        await expect(
          dialog.getByRole("link", { name: /Open ChatGPT/ }),
        ).toHaveAttribute("href", "https://chatgpt.com/plugins");
      } else {
        await expect(
          dialog.getByRole("button", { name: "Create key" }),
        ).toBeEnabled();
        await expect(
          dialog.getByRole("button", { name: "Approve all scopes" }),
        ).toHaveCount(0);
      }
      expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
        true,
      );
      await dialog.getByRole("button", { name: "Close dialog" }).tap();
      await expect(dialog).toBeHidden();
      await expect(action).toBeInViewport();
    }
  });
});

test("revoked keys cannot be reapproved and revoked OAuth requires deliberate reapproval", async ({
  page,
}) => {
  const revoked = {
    ...pending,
    capabilities: ["memory:read"],
    revokedAt: "2026-10-25T12:00:00Z",
  };
  const key = {
    ...revoked,
    id: "00000000-0000-4000-a000-000000000083",
    clientId: null,
    name: "Retired script",
  };
  const writes: unknown[] = [];
  await page.route("**/api/grove/**", (route) => {
    if (route.request().method() === "PATCH")
      writes.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        success: true,
        data: route.request().url().endsWith("/connections")
          ? [key, revoked]
          : [],
      },
    });
  });
  await page.goto(`${base}/app/settings/connections`);
  const keyRow = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: key.name }) });
  await expect(keyRow).toContainText("This key cannot be used again");
  await expect(
    keyRow.getByRole("button", { name: /approve|scope/i }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Review reapproval" }).press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Approve all scopes" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Reapprove selected access" }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Review reapproval" }),
  ).toBeFocused();
  expect(writes).toEqual([]);
});

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
  ).toBeChecked();
  await expect(
    dialog.getByLabel("All current and future notebooks", { exact: true }),
  ).toBeChecked();
  await dialog.getByLabel("Delete notes", { exact: true }).uncheck();
  await dialog
    .getByLabel("All current and future notebooks", { exact: true })
    .uncheck();
  await dialog.getByLabel("Save and update notes", { exact: true }).uncheck();
  await dialog.getByLabel("Name", { exact: true }).press("Enter");
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

test("new API keys select every permission and scope while existing connections keep saved choices", async ({
  page,
}) => {
  await page.route("**/api/grove/**", async (route) =>
    route.fulfill({
      json: {
        success: true,
        data: new URL(route.request().url()).pathname.endsWith("/connections")
          ? [
              {
                ...pending,
                name: "Existing reader",
                capabilities: ["memory:read"],
                personal: false,
                allProjects: false,
              },
            ]
          : [],
      },
    }),
  );
  await page.goto(`${base}/app/settings/connections`);
  await page
    .getByRole("button", { name: "Create API key", exact: true })
    .click();
  const key = page.getByRole("dialog", { name: "Create a scoped API key" });
  for (const name of [
    "Read notes",
    "Save and update notes",
    "Delete notes",
    "Personal memories",
    "All current and future notebooks",
  ])
    await expect(key.getByLabel(name, { exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit scope", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Connection access" });
  await expect(edit.getByLabel("Read notes", { exact: true })).toBeChecked();
  for (const name of [
    "Save and update notes",
    "Delete notes",
    "Personal memories",
    "All current and future notebooks",
  ])
    await expect(edit.getByLabel(name, { exact: true })).not.toBeChecked();
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
  await expect(page.getByText("No connections yet.")).toBeVisible();
  appeared = true;
  await page
    .getByRole("button", { name: "Refresh connections", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toBeVisible();
  await page.getByText("Connection details", { exact: true }).press("Enter");
  await expect(
    page.getByText("synthetic_chatgpt_client", { exact: false }),
  ).toBeVisible();
});

test("AI sentence permission is explicit and independent of note scope", async ({
  page,
}) => {
  let connection = {
    ...pending,
    name: "Browser extension",
    capabilities: ["memory:read"],
    writingEnabled: false,
  };
  let saved: Record<string, unknown> | undefined;
  await page.route("**/api/grove/**", async (route) => {
    if (route.request().method() === "PATCH") {
      saved = route.request().postDataJSON();
      connection = { ...connection, ...saved };
      return route.fulfill({ json: { success: true, data: { connection } } });
    }
    return route.fulfill({
      json: {
        success: true,
        data: new URL(route.request().url()).pathname.endsWith("/connections")
          ? [connection]
          : [],
      },
    });
  });
  await page.goto(`${base}/app/settings/connections`);
  await page.getByRole("button", { name: "Edit scope", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Connection access" });
  await expect(dialog.getByLabel("Allow AI writing tools")).not.toBeChecked();
  await expect(dialog.getByLabel("Read notes", { exact: true })).toBeChecked();
  await dialog.getByLabel("Allow AI writing tools").check();
  await dialog
    .getByRole("button", { name: "Approve access", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(saved?.writingEnabled).toBe(true);
  expect(saved?.capabilities).toEqual(["memory:read"]);
  await page.getByRole("button", { name: "Edit scope", exact: true }).click();
  await expect(dialog.getByLabel("Allow AI writing tools")).toBeChecked();
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
  await dialog
    .getByRole("button", { name: "Approve all scopes" })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(
    dialog.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect.poll(() => writes).toBe(1);
  await expect(
    dialog.getByRole("button", { name: "Approve all scopes" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  finish();
  await expect(dialog.getByRole("alert")).toContainText(
    "Connection access changed",
  );
  await expect(
    dialog.getByRole("button", { name: "Approve all scopes" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Approve access" }),
  ).toBeDisabled();
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
