import { fixturePath, catalogResponse } from "./fixtures/notebook-catalog";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { modelConfigSchema, type ModelSettings } from "@lib/shared/models";
import { preferencesFor } from "@lib/shared/preferences";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const aiSettings = `${base}/app/settings/models`;
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
  // The narrowest two-column layout must accommodate the longer error status.
  await page.setViewportSize({ width: 1200, height: 900 });
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
    const path = fixturePath(route.request().url());
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
      json: {
        success: true,
        data: catalogResponse(
          route.request().url(),
          path.endsWith("/me") ? preferences : [],
        ),
      },
    });
  });
  await page.goto(aiSettings);
  await page
    .locator("summary")
    .getByText("Connected agents", { exact: true })
    .click();
  await page
    .locator("summary")
    .getByText("Organization", { exact: true })
    .click();
  const button = page.getByRole("button", { name: "Save preferences" });
  await expect(button).toBeDisabled();
  const recall = page.getByRole("checkbox", {
    name: "Automatic recall",
    exact: true,
  });
  const capture = page.getByRole("checkbox", {
    name: "Automatic capture",
    exact: true,
  });
  const titles = page.getByRole("checkbox", {
    name: "Titles and tags",
    exact: true,
  });
  await recall.uncheck();
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
  await recall.check();
  await expect(button).toBeDisabled();
  await recall.uncheck();
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
  await capture.uncheck();
  release.resolve();
  await expect(page.locator(".settings-save-status")).toHaveText(
    "Unsaved changes",
  );
  await expect(button).toBeEnabled();
  expect(saves[0]).toEqual({ recallEnabled: false });
  await button.click();
  await expect(page.locator(".settings-save-status")).toHaveText(
    "All changes saved",
  );
  expect(saves[1]).toEqual({ captureEnabled: false });
  await titles.uncheck();
  await button.click();
  await expect(page.getByRole("alert")).toHaveText("Please try again shortly.");
  await expect(titles).not.toBeChecked();
  expect(await geometry()).toEqual(before);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator(".settings-save-status")).toHaveText(
    "All changes saved",
  );
  expect(await geometry()).toEqual(before);
});

test("categorized AI preferences persist independently with provider availability and accessible mobile controls", async ({
  page,
}, info) => {
  const preferences = preferencesFor({
    organizeEnabled: false,
    summariesEnabled: false,
  });
  await page.route("**/api/grove/**", async (route) => {
    const path = fixturePath(route.request().url());
    if (path.endsWith("/account/settings"))
      Object.assign(preferences, route.request().postDataJSON());
    await route.fulfill({
      json: {
        success: true,
        data: path.endsWith("/me")
          ? {
              ...preferences,
              aiAvailability: { classification: false, generation: true },
            }
          : path.endsWith("/account/settings")
            ? preferences
            : [],
      },
    });
  });
  await page.goto(aiSettings);
  await expect(
    page.getByRole("group", { name: "Ask Grove", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".ai-preferences-panel").getByRole("checkbox"),
  ).toHaveCount(2);
  for (const title of [
    "Organization",
    "Related notes and notebooks",
    "Summaries",
    "Connected agents",
    "Speech",
  ])
    await page.locator("summary").getByText(title, { exact: true }).click();
  await expect(
    page.locator(".ai-preferences-panel").getByRole("checkbox"),
  ).toHaveCount(16);
  const titles = page.getByRole("checkbox", {
    name: "Titles and tags",
    exact: true,
  });
  await expect(titles).not.toBeChecked();
  await titles.focus();
  await page.keyboard.press("Space");
  await expect(titles).toBeChecked();
  await page
    .getByRole("checkbox", { name: "Linked notes", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Notebook summaries", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "Connected notebooks", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Personal summary", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Answers and writing", exact: true }),
  ).not.toBeChecked();
  const unavailable = page.getByRole("checkbox", {
    name: "Note classification",
    exact: true,
  });
  await expect(unavailable).toHaveAccessibleDescription(
    /Currently unavailable/,
  );
  await expect(unavailable).toBeEnabled();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.reload();
  await page
    .locator("summary")
    .getByText("Organization", { exact: true })
    .click();
  await expect(titles).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Answers and writing", exact: true }),
  ).not.toBeChecked();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .locator(".settings-page")
      .evaluate((element) => element.scrollTo(0, 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const label of await page.locator(".ai-preference").all()) {
      const bounds = await label.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`ai-preferences-${width}.png`),
    });
    await page
      .locator(".settings-page")
      .evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(
      page.getByRole("button", { name: "Save preferences" }),
    ).toBeInViewport();
    await page.screenshot({
      path: info.outputPath(`ai-preferences-${width}-bottom.png`),
    });
  }
});

test("preference drafts survive settings tabs, discard restores saved choices, and clean forms follow server updates", async ({
  page,
}) => {
  // This journey uses desktop tabs; narrow picker navigation is exercised below.
  await page.setViewportSize({ width: 1440, height: 900 });
  const preferences = preferencesFor({});
  const saves: Record<string, boolean>[] = [];
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route("**/api/grove/**", async (route) => {
    const path = fixturePath(route.request().url());
    if (path.endsWith("/account/settings")) {
      const patch = route.request().postDataJSON();
      saves.push(patch);
      if (saves.length === 1) {
        started.resolve();
        await release.promise;
      }
      Object.assign(preferences, patch);
    }
    await route.fulfill({
      json: {
        success: true,
        data: path.endsWith("/models")
          ? { config: config(), edition: "cloud", editable: false }
          : path.endsWith("/me") || path.endsWith("/account/settings")
            ? preferences
            : [],
      },
    });
  });
  await page.goto(aiSettings);
  const tabs = page.getByRole("navigation", { name: "Settings sections" });
  const aiTab = tabs.getByRole("link", { name: "AI & search", exact: true });
  const organization = page
    .locator("summary")
    .getByText("Organization", { exact: true });
  const titles = page.getByRole("checkbox", {
    name: "Titles and tags",
    exact: true,
  });
  const capture = page.getByRole("checkbox", {
    name: "Automatic capture",
    exact: true,
  });
  const save = page.getByRole("button", {
    name: "Save preferences",
    exact: true,
  });
  const discard = page.getByRole("button", {
    name: "Discard changes",
    exact: true,
  });
  await organization.click();
  await titles.uncheck();
  await tabs.getByRole("link", { name: "Writing", exact: true }).click();
  await expect(aiTab).toHaveAccessibleDescription("Unsaved preference changes");
  await aiTab.click();
  await organization.click();
  await expect(titles).not.toBeChecked();
  await page.getByRole("link", { name: "Notes", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await aiTab.click();
  await organization.click();
  await expect(titles).not.toBeChecked();
  await discard.click();
  await expect(titles).toBeChecked();
  await expect(save).toBeDisabled();
  expect(saves).toEqual([]);

  await titles.uncheck();
  await save.click();
  await started.promise;
  await tabs.getByRole("link", { name: "Account", exact: true }).click();
  await aiTab.click();
  await page
    .locator("summary")
    .getByText("Connected agents", { exact: true })
    .click();
  await expect(discard).toBeDisabled();
  await expect(page.locator(".settings-save-status")).toHaveText("Saving…");
  await capture.uncheck();
  release.resolve();
  await expect(page.locator(".settings-save-status")).toHaveText(
    "Unsaved changes",
  );
  await save.click();
  await expect(page.locator(".settings-save-status")).toHaveText(
    "All changes saved",
  );
  expect(saves).toEqual([
    { titlesTagsEnabled: false },
    { captureEnabled: false },
  ]);
  await organization.click();
  await expect(titles).not.toBeChecked();
  await expect(capture).not.toBeChecked();

  preferences.classificationEnabled = false;
  await page.evaluate(() => {
    const channel = new BroadcastChannel("grove-workspace:fixture-user");
    channel.postMessage({ resource: "/me" });
    channel.close();
  });
  await expect(
    page.getByRole("checkbox", { name: "Note classification", exact: true }),
  ).not.toBeChecked();
  await expect(save).toBeDisabled();

  await titles.check();
  await page.evaluate(() =>
    (
      window as unknown as {
        switchWorkspaceAccount: (account: string, session: string) => void;
      }
    ).switchWorkspaceAccount("fixture-user", "replacement-session"),
  );
  await organization.click();
  await expect(titles).not.toBeChecked();
  await expect(discard).toBeDisabled();
});

test("provider availability attributes connections to generation and keeps keyword search available", async ({
  page,
}) => {
  const models = config();
  models.embedding.provider = "disabled";
  models.generation.provider = "disabled";
  await page.route("**/api/grove/**", async (route) =>
    route.fulfill({
      json: {
        success: true,
        data: route.request().url().endsWith("/models")
          ? { config: models, editable: false, edition: "self-hosted" }
          : {
              ...preferencesFor({}),
              aiAvailability: { classification: true, generation: false },
            },
      },
    }),
  );
  await page.goto(`${base}/app/settings/models`);
  await expect(page.getByText("Keyword search is available.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Manage model providers" }),
  ).toHaveCount(0);
  await page
    .locator("summary")
    .getByText("Organization", { exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Note classification" }),
  ).not.toHaveAccessibleDescription(/Currently unavailable/);
  await page
    .locator("summary")
    .getByText("Related notes and notebooks", { exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Linked notes" }),
  ).toHaveAccessibleDescription(/Currently unavailable/);
});

test("writing settings stay reachable on a short, narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 256 });
  await page.route("**/api/grove/**", (route) =>
    route.fulfill({ json: { success: true, data: {} } }),
  );
  await page.goto(`${base}/app/settings`);
  const spelling = page.getByRole("checkbox", {
    name: "Spelling",
    exact: true,
  });
  await spelling.focus();
  await expect(spelling).toBeInViewport({ ratio: 1 });
  await spelling.press("Space");
  await expect(spelling).not.toBeChecked();
  await page.reload();
  await expect(spelling).not.toBeChecked();
});

test("settings share persistent navigation and scrolling, and feedback leaves forms in place", async ({
  page,
}, info) => {
  // Check the desktop tabs first, then the existing 320px picker journey.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/grove/**", async (route) => {
    const path = fixturePath(route.request().url());
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
    await route.fulfill({
      json: {
        success: true,
        data: catalogResponse(route.request().url(), data),
      },
    });
  });
  await page.goto(aiSettings);
  const header = page.locator(".settings-header");
  await header.evaluate((element) =>
    element.setAttribute("data-retained", "yes"),
  );
  const tabs = page.getByRole("navigation", { name: "Settings sections" });
  const before = await tabs.boundingBox();
  await page.getByRole("checkbox", { name: "Answers and writing" }).check();
  await page
    .locator(".ai-preferences-panel form")
    .getByRole("checkbox")
    .first()
    .uncheck();
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
    "AI & search",
    "Your data",
    "Writing",
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
    if (name === "Account")
      await page.screenshot({ path: info.outputPath("settings-account.png") });
  }
  await page.setViewportSize({ width: 320, height: 750 });
  const picker = tabs.getByRole("button", { name: /Change settings section/ });
  await picker.focus();
  await picker.press("ArrowDown");
  await expect(
    tabs.getByRole("link", { name: "Writing", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(picker).toBeFocused();
  await picker.click();
  await expect(
    tabs.getByRole("link", { name: "Writing", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  for (const link of await tabs.getByRole("link").all()) {
    await expect(link).toBeInViewport({ ratio: 1 });
  }
  expect(await tabs.evaluate((nav) => nav.scrollWidth)).toBe(
    await tabs.evaluate((nav) => nav.clientWidth),
  );
  await tabs.getByRole("link", { name: "Your data", exact: true }).click();
  await expect(picker).toHaveText("Your data");
  await expect(picker).toHaveAttribute("aria-expanded", "false");
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
    let attempts = 0;
    await page.route("**/api/grove/**", async (route) => {
      const path = fixturePath(route.request().url());
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
        if (++attempts === 1) {
          await route.fulfill({
            status: 503,
            json: {
              success: false,
              error: {
                code: "unavailable",
                message: "Provider settings could not save. Try again.",
              },
            },
          });
          return;
        }
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
      await route.fulfill({
        json: {
          success: true,
          data: catalogResponse(route.request().url(), data),
        },
      });
    });
    await page.goto(aiSettings);
    await expect(
      page.getByRole("heading", {
        name: "AI & search",
      }),
    ).toBeVisible();
    if (editable) {
      await page.getByRole("link", { name: "Manage model providers" }).click();
      await expect(
        page.getByRole("heading", { name: "Model providers" }),
      ).toBeVisible();
      await expect(page.getByLabel("Dimensions", { exact: true })).toBeHidden();
      await page
        .locator("summary")
        .getByText("Search by meaning", { exact: true })
        .click();
      const save = page.getByRole("button", {
        name: "Save model settings",
        exact: true,
      });
      const discard = page.getByRole("button", {
        name: "Discard changes",
        exact: true,
      });
      await expect(save).toBeDisabled();
      await expect(page.getByLabel("Dimensions", { exact: true })).toHaveValue(
        "4096",
      );
      await page
        .getByLabel("API key", { exact: true })
        .first()
        .fill("discarded-secret-fixture");
      await discard.click();
      await expect(
        page.getByLabel("API key", { exact: true }).first(),
      ).toHaveValue("");
      await expect(save).toBeDisabled();
      await page
        .getByLabel("API key", { exact: true })
        .first()
        .fill("new-secret-fixture");
      await save.click();
      await expect(page.getByRole("alert")).toContainText(
        "Provider settings could not save",
      );
      await expect(
        page.getByLabel("API key", { exact: true }).first(),
      ).toHaveValue("new-secret-fixture");
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
      await page
        .locator(".workspace-toast")
        .getByRole("button", { name: "Dismiss notification" })
        .click();
    } else {
      await expect(page.getByText(/4,096 dimensions/)).not.toBeVisible();
      await expect(
        page.getByText("Technical details", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText(
          "Meaning search is configured. Each search reports whether it used meaning or keyword fallback.",
          {
            exact: true,
          },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Save model settings" }),
      ).toHaveCount(0);
      await expect(
        page.getByText(/Qwen|MiniMax|embedding|dimensions/i),
      ).toHaveCount(0);
    }
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const navigation = page.getByRole("navigation", {
        name: "Settings sections",
      });
      const current =
        width < 701
          ? navigation.getByRole("button", {
              name: /Change settings section: AI & search/,
            })
          : navigation.getByRole("link", { name: "AI & search", exact: true });
      await expect(current).toBeInViewport({ ratio: 1 });
      await page
        .locator(".settings-page")
        .evaluate((element) => element.scrollTo(0, 0));
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
      await page.screenshot({
        path: testInfo.outputPath(`model-settings-${width}.png`),
      });
      if (editable) {
        await page
          .getByRole("button", { name: "Save model settings", exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`model-settings-${width}-bottom.png`),
        });
      }
    }
  });

test("saving a summary preference refreshes derived content in another open tab", async ({
  page,
  context,
}) => {
  const preferences = preferencesFor({});
  await context.route("**/api/grove/**", async (route) => {
    const path = fixturePath(route.request().url());
    if (path.endsWith("/account/settings"))
      Object.assign(preferences, route.request().postDataJSON());
    const data =
      path.endsWith("/me") || path.endsWith("/account/settings")
        ? preferences
        : path.endsWith("/briefs")
          ? {
              scope: { projectId: null },
              status: preferences.personalSummaryEnabled ? "ready" : "disabled",
              content: preferences.personalSummaryEnabled
                ? { title: "Saved personal context", sections: [] }
                : null,
              sourceCount: 0,
              updatedAt: null,
              truncated: false,
            }
          : [];
    await route.fulfill({
      json: {
        success: true,
        data: catalogResponse(route.request().url(), data),
      },
    });
  });
  const other = await context.newPage();
  await other.goto(`${base}/app/profile`);
  await expect(other.getByText("Saved personal context")).toBeVisible();
  await page.goto(aiSettings);
  await page.locator("summary").getByText("Summaries", { exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Personal summary", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(other.getByText("Saved personal context")).toHaveCount(0);
  await expect(
    other.getByRole("link", { name: "AI preferences", exact: true }),
  ).toBeVisible();
  await other.close();
});

test("source-linked personal context exposes current revision links and honest queued refresh", async ({
  page,
}, testInfo) => {
  let pending = false;
  const id = "00000000-0000-4000-8000-000000000001";
  await page.route("**/api/grove/**", async (route) => {
    if (fixturePath(route.request().url()).endsWith("/projects")) {
      await route.fulfill({
        json: {
          success: true,
          data: catalogResponse(route.request().url(), []),
        },
      });
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
  ).toHaveAttribute("href", `/app/memories/${id}?revision=3`);
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

test("notebook summary coverage, compact refresh and exact source revisions stay accessible", async ({
  page,
}, info) => {
  const project = {
    id: "00000000-0000-4000-8000-000000000041",
    name: "Japan trip",
    identity: "japan",
    version: 1,
    parentId: null,
  };
  const id = "00000000-0000-4000-8000-000000000042";
  let pending = false;
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/grove/**", async (route) => {
    const path = fixturePath(route.request().url());
    let data: unknown = {};
    if (path.endsWith("/projects")) data = [project];
    else if (path.endsWith("/me"))
      data = { accountId: "summary-owner", ...preferencesFor({}) };
    else if (path.endsWith("/memories/search"))
      data = { items: [], nextCursor: null, searchMode: "lexical" };
    else if (path.includes("/briefs")) {
      if (path.endsWith("/refresh")) {
        await held;
        pending = true;
      }
      data = {
        scope: { projectId: project.id },
        status: pending ? "pending" : "ready",
        profile: "summary-fixture",
        sourceCount: 86,
        coverage: { total: 86, examined: 86, cited: 3 },
        truncated: false,
        updatedAt: "2026-10-22T10:00:00Z",
        content: pending
          ? null
          : {
              title: "A week in Japan",
              sections: [
                {
                  heading: "Bookings",
                  statements: [
                    {
                      text: "Take the night train to Kyoto.",
                      sources: [{ id, version: 3 }],
                    },
                  ],
                },
              ],
            },
      };
    } else if (path.endsWith(`/memories/${id}/revisions/3`))
      data = {
        id,
        version: 3,
        currentVersion: 5,
        content: "# Kyoto\n\nReserve the night train.",
        createdAt: "2026-10-20T10:00:00Z",
        expiresAt: null,
      };
    await route.fulfill({
      json: {
        success: true,
        data: catalogResponse(route.request().url(), data),
      },
    });
  });
  await page.goto(`${base}/app/projects/${project.id}`);
  await page.getByRole("button", { name: "Notebook options" }).click();
  await page
    .getByRole("button", { name: "Summarize notebook", exact: true })
    .click();
  await expect(
    page.getByText(/86 of 86 notes examined · 3 cited/),
  ).toBeVisible();
  const refresh = page.getByRole("button", {
    name: "Refresh summary",
    exact: true,
  });
  await expect(refresh).toHaveAttribute("title", "Refresh summary");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(refresh).toBeInViewport();
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
    await page.screenshot({
      path: info.outputPath(`notebook-summary-${width}.png`),
    });
  }
  const before = await refresh.boundingBox();
  await refresh.click();
  await expect(refresh).toBeDisabled();
  expect(await refresh.boundingBox()).toEqual(before);
  finish();
  await expect(
    page.getByRole("button", { name: "Check status" }),
  ).toBeVisible();
  pending = false;
  await page.getByRole("button", { name: "Check status" }).click();
  await page.getByRole("link", { name: "Source 1 · revision 3" }).click();
  await expect(
    page.getByRole("heading", { name: "Source · revision 3" }),
  ).toBeVisible();
  await expect(
    page.getByText("Reserve the night train.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Current note: revision 5")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open current note" }),
  ).toHaveAttribute("href", `/app/memories/${id}`);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("source-revision-320.png") });
});
