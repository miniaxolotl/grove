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
        name: editable ? "Model settings" : "Search & organization",
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
      await expect(page.getByRole("status")).toContainText(
        "Model settings saved",
      );
      await expect(
        page.getByLabel("API key", { exact: true }).first(),
      ).toHaveValue("");
      expect(saved).toBe(true);
      await page
        .getByRole("button", { name: "Test saved embedding configuration" })
        .click();
      await expect(page.getByRole("status")).toContainText("4096 dimensions");
    } else {
      await expect(page.getByText(/4,096 dimensions/)).not.toBeVisible();
      await page.getByText("Technical details", { exact: true }).click();
      await expect(page.getByText(/4,096 dimensions/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Save model settings" }),
      ).toHaveCount(0);
      await expect(
        page.getByText(
          "Grove Cloud manages these providers for your account.",
          { exact: false },
        ),
      ).toBeVisible();
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
