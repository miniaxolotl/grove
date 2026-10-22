import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { Task } from "@lib/shared/jobs";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const projectId = "88e5a309-73d4-4e34-a979-aec791c0f6d2";
const initial = (): Task => ({
  id: "c8be4a47-c3ea-46f3-a3cf-98d102d7d570",
  kind: "export",
  status: "pending",
  processed: 0,
  total: null,
  attempts: 0,
  error: null,
  createdAt: "2026-10-22T12:00:00Z",
  updatedAt: "2026-10-22T12:00:00Z",
  expiresAt: "2026-10-23T12:00:00Z",
  downloadable: false,
});

test("account export retries the same request and progresses to an authenticated download", async ({
  page,
}, testInfo) => {
  let task: Task | undefined;
  const requests: { id: string }[] = [];
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/exports")) {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1)
        return route.fulfill({
          status: 503,
          json: {
            success: false,
            error: { code: "unavailable", message: "Please retry." },
          },
        });
      task = { ...initial(), id: requests[0].id };
      return route.fulfill({
        status: 202,
        json: { success: true, data: task },
      });
    }
    if (path.endsWith("/download"))
      return route.fulfill({
        contentType: "application/x-ndjson",
        headers: {
          "content-disposition": "attachment; filename=grove-account.ndjson",
        },
        body: '{"type":"note","content":"Exported writing"}\n',
      });
    return route.fulfill({
      json: {
        success: true,
        data: path.endsWith("/tasks")
          ? task
            ? [task]
            : []
          : path.endsWith("/me")
            ? { accountId: "fixture" }
            : [],
      },
    });
  });
  await page.goto(`${base}/app/settings/data`);
  const prepare = page.getByRole("button", { name: "Prepare export" });
  await prepare.click();
  await expect(page.getByRole("alert")).toHaveText("Please retry.");
  await prepare.click();
  await expect(page.getByText("Queued", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0].id).toBe(requests[1].id);
  await expect(prepare).toBeDisabled();
  task = { ...task!, status: "succeeded", processed: 230, downloadable: true };
  const link = page.getByRole("link", { name: "Download export" });
  await expect(link).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("export-ready.png"),
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await link.click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("grove-account.ndjson");
  const output = testInfo.outputPath("export.ndjson");
  await file.saveAs(output);
  expect(await readFile(output, "utf8")).toContain("Exported writing");
});

test("notebook exports keep scope explicit and support cancellation and retry after reopening", async ({
  page,
}, testInfo) => {
  let task: Task | undefined;
  let payload: Record<string, unknown> | undefined;
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith("/projects"))
      data = [
        {
          id: projectId,
          name: "Travel",
          identity: "travel",
          parentId: null,
          version: 1,
        },
      ];
    if (path.endsWith("/memories/search"))
      data = { items: [], nextCursor: null };
    if (path.endsWith("/exports")) {
      payload = route.request().postDataJSON();
      task = {
        ...initial(),
        id: payload!.id as string,
        scope: {
          projectId,
          includeDescendants: payload!.includeDescendants as boolean,
        },
      };
      data = task;
    }
    if (path.endsWith("/cancel")) {
      task = { ...task!, status: "cancelled" };
      data = task;
    }
    if (path.endsWith("/retry")) {
      task = { ...task!, status: "running", processed: 100 };
      data = task;
    }
    if (path.endsWith("/tasks")) data = task ? [task] : [];
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${base}/app/projects/${projectId}`);
  const open = async () => {
    await page.getByRole("button", { name: "Notebook options" }).click();
    await page
      .getByRole("button", { name: "Export notebook", exact: true })
      .click();
  };
  await open();
  const dialog = page.getByRole("dialog", { name: "Export notebook" });
  await dialog.getByLabel("Include sub-notebooks").check();
  await dialog.getByRole("button", { name: "Prepare export" }).click();
  expect(payload).toMatchObject({ projectId, includeDescendants: true });
  await dialog.getByRole("button", { name: "Cancel export" }).click();
  await expect(dialog.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await open();
  await dialog.getByRole("button", { name: "Retry export" }).click();
  await expect(dialog.getByText("100 records", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Include sub-notebooks")).toBeChecked();
  await expect(dialog.getByLabel("Include sub-notebooks")).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("notebook-export.png"),
    fullPage: true,
  });
});

test("compact export actions remain accessible at desktop and narrow widths", async ({
  page,
}, testInfo) => {
  await page.route("**/api/grove/**", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: route.request().url().includes("/tasks")
          ? [{ ...initial(), status: "failed", error: "export_changed" }]
          : [],
      },
    }),
  );
  await page.goto(`${base}/app/settings/data`);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("button", { name: "Retry export" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include(".settings-content")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`exports-${width}.png`),
      fullPage: true,
    });
  }
});
