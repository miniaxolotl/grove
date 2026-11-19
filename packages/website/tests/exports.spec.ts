import { fixturePath, catalogResponse } from "./fixtures/notebook-catalog";
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

test("export email opens the exact older task without preparing or downloading it", async ({
  page,
}) => {
  const id = initial().id;
  let task: Task = {
    ...initial(),
    status: "succeeded",
    downloadable: true,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const effects: string[] = [];
  await page.route("**/api/grove/**", async (route) => {
    const url = route.request().url();
    const path = fixturePath(url);
    if (path.endsWith(`/tasks/${id}/retry`)) {
      effects.push("retry");
      task = { ...initial(), status: "pending" };
    } else if (path.endsWith("/download") || path.endsWith("/exports"))
      effects.push(path);
    return route.fulfill({
      json: {
        success: true,
        data: catalogResponse(
          url,
          path.endsWith(`/tasks/${id}`)
            ? task
            : path.endsWith("/tasks")
              ? []
              : path.endsWith("/me")
                ? { accountId: "export-owner" }
                : [],
        ),
      },
    });
  });
  await page.goto(`${base}/app/settings/data?export=${id}`);
  const view = page.getByRole("region", { name: "Requested export" });
  await expect(view.getByText("Ready", { exact: true })).toBeVisible();
  await expect(
    view.getByRole("link", { name: "Download export" }),
  ).toHaveAttribute("href", `/api/grove/tasks/${id}/download`);
  task = {
    ...task,
    status: "failed",
    error: "export_expired",
    downloadable: false,
  };
  await page.reload();
  await expect(view.getByText("Expired", { exact: true })).toBeVisible();
  await expect(view.getByRole("link", { name: "Download export" })).toHaveCount(
    0,
  );
  expect(effects).toEqual([]);
  await view.getByRole("button", { name: "Prepare a fresh export" }).click();
  await expect(view.getByText("Queued", { exact: true })).toBeVisible();
  expect(effects).toEqual(["retry"]);
});

test("another account opening an export link gets a neutral unavailable state", async ({
  page,
}) => {
  const id = initial().id;
  let lookups = 0;
  await page.route("**/api/grove/**", async (route) => {
    const url = route.request().url();
    if (fixturePath(url).endsWith(`/tasks/${id}`)) {
      lookups++;
      return route.fulfill({
        status: 404,
        json: {
          success: false,
          error: { code: "not_found", message: "Job not found" },
        },
      });
    }
    return route.fulfill({
      json: {
        success: true,
        data: catalogResponse(
          url,
          fixturePath(url).endsWith("/me") ? { accountId: "other-owner" } : [],
        ),
      },
    });
  });
  await page.goto(`${base}/app/settings/data?export=${id}`);
  const view = page.getByRole("region", { name: "Requested export" });
  await expect(view.getByText("This export is unavailable.")).toBeVisible();
  expect(lookups).toBe(1);
  await expect(view.getByRole("link", { name: "Download export" })).toHaveCount(
    0,
  );
  await expect(view.getByRole("button")).toHaveCount(0);
});

test("account export retries the same request and progresses to an authenticated download", async ({
  page,
}, testInfo) => {
  let task: Task | undefined;
  const requests: { id: string }[] = [];
  await page.route("**/api/grove/**", async (route) => {
    const path = fixturePath(route.request().url());
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
  task = { ...task!, status: "running" };
  await expect(
    page.getByText("Preparing export…", { exact: true }),
  ).toBeVisible();
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
    const path = fixturePath(route.request().url());
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
    await route.fulfill({
      json: {
        success: true,
        data: catalogResponse(route.request().url(), data),
      },
    });
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
  await expect(
    dialog.getByText("Preparing export · 100 records", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Include sub-notebooks")).toBeChecked();
  await expect(dialog.getByLabel("Include sub-notebooks")).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("notebook-export.png"),
    fullPage: true,
  });
});

test("export refresh failure prevents a duplicate request and preserves focus", async ({
  page,
}) => {
  let readsFail = false;
  let task: Task | undefined;
  let requests = 0;
  const release = Promise.withResolvers<void>();
  await page.route("**/api/grove/**", async (route) => {
    const url = route.request().url();
    const path = fixturePath(url);
    if (path.endsWith("/exports")) {
      requests++;
      await release.promise;
      readsFail = true;
      task = { ...initial(), id: route.request().postDataJSON().id };
      return route.fulfill({
        status: 202,
        json: { success: true, data: task },
      });
    }
    if (path.endsWith("/tasks") && readsFail)
      return route.fulfill({
        status: 503,
        json: {
          success: false,
          error: { code: "unavailable", message: "Please retry." },
        },
      });
    return route.fulfill({
      json: {
        success: true,
        data: catalogResponse(
          url,
          path.endsWith("/tasks") && task
            ? [task]
            : path.endsWith("/me")
              ? { accountId: "export-recovery" }
              : [],
        ),
      },
    });
  });
  await page.goto(`${base}/app/settings/data`);
  const prepare = page.getByRole("button", { name: "Prepare export" });
  await prepare.click();
  await expect.poll(() => requests).toBe(1);
  const input = page.getByRole("textbox", { name: /delete my account/i });
  await input.focus();
  release.resolve();
  const reload = page.getByRole("button", { name: "Reload exports" });
  await expect(reload).toBeVisible({ timeout: 15_000 });
  await expect(input).toBeFocused();
  await expect(prepare).toBeDisabled();
  readsFail = false;
  await reload.press("Enter");
  await expect(page.getByText("Queued", { exact: true })).toBeVisible();
  await expect(reload).toBeHidden();
  expect(requests).toBe(1);
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
