import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { modelConfigSchema, type ModelSettings } from "@lib/shared/models";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const config = () =>
  modelConfigSchema.parse({
    embedding: {
      provider: "openai-compatible",
      baseUrl: "https://api.deepinfra.com/v1/openai",
      model: "Qwen/Qwen3-Embedding-8B",
      dimensions: 4096,
    },
    decision: {
      provider: "system-one",
      baseUrl: "https://api.deepinfra.com/v1",
      model: "Cloudflare/clef-flash",
    },
    generation: {
      provider: "minimax",
      baseUrl: "https://api.minimax.io/v1",
      model: "MiniMax-M3.1-Flash",
    },
  });

test("preferences retain newer edits during saving and errors do not move the form", async ({
  page,
}) => {
  const preferences = {
    captureEnabled: true,
    recallEnabled: true,
    organizeEnabled: true,
    summariesEnabled: true,
  };
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const saves: Record<string, boolean>[] = [];
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/account/settings")) {
      saves.push(route.request().postDataJSON());
      if (saves.length === 1) {
        started.resolve();
        await release.promise;
      }
      if (saves.length === 3) {
        await route.fulfill({
          status: 503,
          json: {
            success: false,
            error: {
              code: "unavailable",
              message: "Please try again shortly.",
            },
          },
        });
        return;
      }
      await route.fulfill({ json: { success: true, data: saves.at(-1) } });
      return;
    }
    await route.fulfill({
      json: { success: true, data: path.endsWith("/me") ? preferences : [] },
    });
  });
  await page.goto(`${base}/app/settings`);
  const button = page.getByRole("button", { name: "Save preferences" });
  await expect(button).toBeDisabled();
  const checks = page.getByRole("checkbox");
  await checks.nth(0).uncheck();
  // Another tab can refresh /me to the same values as our unsaved draft.
  // Reverting still compares with our loaded base, not that background snapshot.
  preferences.recallEnabled = false;
  const refreshed = page.waitForResponse("**/api/grove/me");
  await page.evaluate(() => {
    const channel = new BroadcastChannel("grove-workspace:fixture-user");
    channel.postMessage({ resource: "/me" });
    channel.close();
  });
  await (await refreshed).finished();
  await checks.nth(0).check();
  await expect(button).toBeDisabled();
  await checks.nth(0).uncheck();
  await expect(page.locator(".settings-save-status")).toHaveText(
    "Unsaved changes",
  );
  const form = page.locator(".settings-content form");
  await button.scrollIntoViewIfNeeded();
  // Check layout within the settings scroller, independently of the browser
  // bringing different controls into view on a short screen.
  const geometry = () =>
    form.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const scroll = element.closest(".settings-page")!.scrollTop;
      return {
        x: rect.x,
        y: rect.y + scroll,
        width: rect.width,
        height: rect.height,
      };
    });
  const before = await geometry();
  await button.click();
  await started.promise;
  await expect(page.locator(".settings-save-status")).toHaveText("Saving…");
  expect(await geometry()).toEqual(before);
  await checks.nth(1).uncheck();
  release.resolve();
  await expect(page.locator(".settings-save-status")).toHaveText(
    "Unsaved changes",
  );
  await expect(button).toBeEnabled();
  expect(saves[0]).toMatchObject({
    recallEnabled: false,
    captureEnabled: true,
  });
  await button.click();
  await expect(page.locator(".settings-save-status")).toHaveText(
    "All changes saved",
  );
  expect(saves[1]).toMatchObject({
    recallEnabled: false,
    captureEnabled: false,
  });
  await checks.nth(2).uncheck();
  await button.click();
  await expect(page.getByRole("alert")).toHaveText("Please try again shortly.");
  await expect(checks.nth(2)).not.toBeChecked();
  expect(await geometry()).toEqual(before);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator(".settings-save-status")).toHaveText(
    "All changes saved",
  );
  expect(await geometry()).toEqual(before);
});

test("settings share persistent navigation and scrolling, and feedback leaves forms in place", async ({
  page,
}, info) => {
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/me")
      ? {
          captureEnabled: true,
          recallEnabled: true,
          organizeEnabled: true,
          summariesEnabled: true,
        }
      : path.endsWith("/models")
        ? {
            edition: "cloud",
            editable: false,
            config: config(),
            version: 1,
            credentials: {},
            profiles: {},
          }
        : path.endsWith("/usage")
          ? { today: [], dailyRequestLimit: 2000, failedJobs: 0 }
          : [];
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${base}/app/settings`);
  const header = page.locator(".settings-header");
  await header.evaluate((element) =>
    element.setAttribute("data-retained", "yes"),
  );
  const tabs = page.getByRole("navigation", { name: "Settings sections" });
  const before = await tabs.boundingBox();
  await page.getByRole("checkbox").first().uncheck();
  await page
    .getByRole("button", { name: "Save preferences" })
    .scrollIntoViewIfNeeded();
  const formBefore = await page
    .getByRole("button", { name: "Save preferences" })
    .boundingBox();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.locator(".workspace-toast")).toContainText(
    "Preferences saved",
  );
  expect(
    await page.getByRole("button", { name: "Save preferences" }).boundingBox(),
  ).toEqual(formBefore);
  await page
    .locator(".workspace-toast")
    .getByRole("button", { name: "Dismiss notification" })
    .click();
  for (const name of [
    "Account",
    "Connections",
    "Search & organization",
    "Your data",
    "Preferences",
  ]) {
    await tabs.getByRole("link", { name, exact: true }).click();
    await expect(tabs.getByRole("link", { name, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(header).toHaveAttribute("data-retained", "yes");
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toHaveCount(1);
    expect(await tabs.boundingBox()).toEqual(before);
  }
  await page.setViewportSize({ width: 320, height: 750 });
  await tabs.getByRole("link", { name: "Your data", exact: true }).click();
  await page
    .locator(".settings-page")
    .evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeInViewport();
  await expect(tabs).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
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
  await page
    .locator(".settings-page")
    .evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("settings-mobile-stable.png"),
  });
});
for (const editable of [true, false])
  test(`model settings ${editable ? "save masked credentials and diagnose saved providers" : "show deployment-managed cloud configuration"}`, async ({
    page,
  }, testInfo) => {
    let settings: ModelSettings = {
      edition: editable ? "self-hosted" : "cloud",
      editable,
      version: 1,
      config: config(),
      credentials: { embedding: true, decision: true, generation: true },
      profiles: {
        embedding: "embedding-qwen",
        decision: "decision-clef",
        generation: "generation-minimax",
      },
    };
    let saved = false;
    await page.route("**/api/grove/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = settings;
      if (path.endsWith("/usage"))
        data = {
          today: [
            {
              role: "generation",
              requests: 5,
              inputTokens: "200",
              outputTokens: "80",
            },
          ],
          dailyRequestLimit: 2000,
          failedJobs: 0,
        };
      else if (path.endsWith("/test"))
        data = { latencyMs: 25, dimensions: 4096 };
      else if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        expect(body.expectedVersion).toBe(1);
        expect(body.config.embedding.apiKey).toBe("new-secret-fixture");
        settings = {
          ...settings,
          version: 2,
          config: {
            ...body.config,
            embedding: { ...body.config.embedding, apiKey: "" },
          },
        };
        data = settings;
        saved = true;
      }
      await route.fulfill({ json: { success: true, data } });
    });
    await page.goto(`${base}/app/settings/models`);
    await expect(
      page.getByRole("heading", {
        name: "Search & organization",
      }),
    ).toBeVisible();
    if (editable) {
      await expect(page.getByLabel("Dimensions", { exact: true })).toHaveValue(
        "4096",
      );
      await page
        .getByLabel("API key", { exact: true })
        .first()
        .fill("new-secret-fixture");
      await page
        .getByRole("button", { name: "Save model settings", exact: true })
        .click();
      await expect(
        page.locator(".workspace-toast").getByRole("status"),
      ).toContainText("Model settings saved");
      await expect(
        page.getByLabel("API key", { exact: true }).first(),
      ).toHaveValue("");
      expect(saved).toBe(true);
      await page
        .getByRole("button", { name: "Test saved embedding configuration" })
        .click();
      await expect(
        page.locator(".workspace-toast").getByRole("status"),
      ).toContainText("4096 dimensions");
    } else {
      await expect(page.getByText(/4,096 dimensions/)).not.toBeVisible();
      await expect(
        page.getByText("Technical details", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Search your notes", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Save model settings" }),
      ).toHaveCount(0);
      await expect(
        page.getByText(/Qwen|MiniMax|embedding|dimensions/i),
      ).toHaveCount(0);
    }
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
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
    await page.screenshot({
      path: testInfo.outputPath("model-settings.png"),
      fullPage: true,
    });
  });

test("source-linked personal context exposes current revision links and honest queued refresh", async ({
  page,
}, testInfo) => {
  let pending = false;
  const id = "00000000-0000-4000-8000-000000000001";
  await page.route("**/api/grove/**", async (route) => {
    if (route.request().url().endsWith("/projects")) {
      await route.fulfill({ json: { success: true, data: [] } });
      return;
    }
    if (route.request().url().endsWith("/refresh")) pending = true;
    await route.fulfill({
      json: {
        success: true,
        data: {
          scope: { projectId: null },
          status: pending ? "pending" : "ready",
          profile: "generation-minimax",
          updatedAt: "2026-10-19T10:00:00Z",
          sourceCount: 1,
          truncated: false,
          content: pending
            ? null
            : {
                title: "Your working preferences",
                sections: [
                  {
                    heading: "Communication",
                    statements: [
                      {
                        text: "Prefers concise explanations with examples.",
                        sources: [{ id, version: 3 }],
                      },
                    ],
                  },
                ],
              },
        },
      },
    });
  });
  await page.goto(`${base}/app/profile`);
  await expect(
    page.getByText("Prefers concise explanations with examples."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Source.*revision 3/ }),
  ).toHaveAttribute("href", `/app/memories/${id}`);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("personal-context.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Refresh summary" }).click();
  await expect(
    page.getByText("Updating this summary. You can keep working."),
  ).toBeVisible();
  await expect(
    page.getByText("Prefers concise explanations with examples."),
  ).toHaveCount(0);
});
