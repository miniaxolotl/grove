import { test, expect } from "@playwright/test";
import { fixturePath, catalogResponse } from "./fixtures/notebook-catalog";
const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const id = "00000000-0000-4000-a000-000000000101";
const storage = {
  budgetBytes: 100,
  byteLimit: 1073741824,
  attempts: 1,
  attemptLimit: 1000,
  stagingBytes: 0,
  stagingLimit: 78643200,
  visibleBytes: 100,
  fileCount: 1,
};
const file = {
  id,
  source: "chat",
  kind: "document",
  filename: "Reference.txt",
  bytes: 100,
  status: "ready",
  state: "retained",
  createdAt: "2026-10-25T12:00:00Z",
  expiresAt: null,
  locationCount: 1,
};
test("files recover from errors, paginate and never show stale locations after a denied refresh", async ({
  page,
}) => {
  let fails = true,
    deny = false;
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/grove",
      "",
    );
    let data: unknown = [];
    if (path === "/me") data = { accountId: "files-fixture" };
    else if (path === "/files/storage") data = storage;
    else if (path === "/files/search") {
      if (fails) {
        await route.fulfill({
          status: 503,
          json: {
            success: false,
            error: { code: "unavailable", message: "Files are unavailable" },
          },
        });
        return;
      }
      const input = route.request().postDataJSON();
      data = input.after
        ? {
            items: [
              {
                ...file,
                id: "00000000-0000-4000-a000-000000000102",
                filename: "Second.txt",
              },
            ],
            nextCursor: null,
          }
        : { items: [file], nextCursor: "next-page" };
    } else if (path === "/files/locations") {
      if (deny) {
        await route.fulfill({
          status: 404,
          json: {
            success: false,
            error: { code: "not_found", message: "File is unavailable" },
          },
        });
        return;
      }
      data = {
        items: [
          {
            key: `chat:${id}`,
            title: "Private source chat",
            memoryId: null,
            projectId: null,
            projectName: null,
            conversationId: id,
            batchId: null,
            archived: false,
            historical: false,
            downloadPath: `/conversations/${id}/documents/${id}/original`,
          },
        ],
        nextCursor: null,
      };
    }
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${base}/app/settings/files`);
  await expect(page.getByRole("alert")).toContainText("Files are unavailable");
  fails = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Reference.txt", { exact: true })).toBeVisible();
  await page.getByText("Reference.txt", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Private source chat", exact: true }),
  ).toBeVisible();
  deny = true;
  await page
    .getByRole("button", { name: "Refresh files", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("File is unavailable");
  await expect(
    page.getByRole("link", { name: "Private source chat", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Next files", exact: true }).click();
  await expect(page.getByText("Second.txt", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Previous files", exact: true })
    .click();
  await expect(page.getByText("Reference.txt", { exact: true })).toBeVisible();
});
test("empty and invalid file filters offer a safe path back to all uploads", async ({
  page,
}) => {
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: {
        success: true,
        data: path.endsWith("/me")
          ? { accountId: "empty-files" }
          : path.endsWith("/storage")
            ? {
                ...storage,
                fileCount: 0,
                budgetBytes: 0,
                visibleBytes: 0,
                attempts: 0,
              }
            : path.endsWith("/search")
              ? { items: [], nextCursor: null }
              : [],
      },
    });
  });
  await page.goto(`${base}/app/settings/files?memoryId=invalid`);
  await expect(page.getByRole("alert")).toContainText("filter is invalid");
  await page
    .getByRole("link", { name: "View all uploads", exact: true })
    .click();
  await expect(
    page.getByText("No matching uploads", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Ask Grove", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search files", exact: true })
    .fill("missing");
  await page.getByRole("button", { name: "Search files", exact: true }).click();
  await expect(
    page.getByText(
      "Try another search or clear your filters to find more files.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
});
test("Ask Grove, imports and settings expose the shared files destination", async ({
  page,
}) => {
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: {
        success: true,
        data: path.endsWith("/me")
          ? { accountId: "entry-files" }
          : path.endsWith("/memories/search")
            ? { items: [], nextCursor: null }
            : path.endsWith("/ask-tools")
              ? { defaults: { organize: true, exa: false, tavily: false } }
              : [],
      },
    });
  });
  await page.goto(`${base}/app/ask`);
  await expect(
    page.getByRole("link", { name: "Files & storage", exact: true }),
  ).toHaveAttribute("href", "/app/settings/files");
  await page.goto(`${base}/app/settings/data`);
  await expect(
    page.getByRole("link", { name: "Files & storage", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import notes", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Import notes", exact: true })
      .getByRole("link", { name: "View files & storage", exact: true }),
  ).toHaveAttribute("href", "/app/settings/files");
});
test("file filters, notebook picker and sorting reset pagination without losing a note context", async ({
  page,
}) => {
  const projectId = "00000000-0000-4000-a000-000000000103";
  let last: Record<string, unknown> = {};
  await page.route("**/api/grove/**", async (route) => {
    const path = fixturePath(route.request().url()).replace("/api/grove", "");
    let data: unknown = [];
    if (path === "/me") data = { accountId: "polished-files" };
    if (path === "/projects")
      data = [
        {
          id: projectId,
          name: "Seedling reference",
          parentId: null,
          status: "active",
          version: 1,
        },
      ];
    if (path === "/files/storage") data = storage;
    if (path === "/files/search") {
      last = route.request().postDataJSON();
      data = { items: [file], nextCursor: "next" };
    }
    await route.fulfill({
      json: {
        success: true,
        data: catalogResponse(route.request().url(), data),
      },
    });
  });
  await page.goto(`${base}/app/settings/files?memoryId=${id}`);
  await expect(page.locator(".files-storage")).not.toHaveAttribute("open", "");
  await page.getByLabel("Sort by", { exact: true }).selectOption("size");
  await expect.poll(() => last.sort).toBe("size");
  await page.getByRole("button", { name: "Next files", exact: true }).click();
  await expect.poll(() => last.after).toBe("next");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByLabel("File type", { exact: true }).selectOption("image");
  await expect.poll(() => last.after).toBeUndefined();
  const picker = page.getByRole("combobox", {
    name: "Filter by notebook",
    exact: true,
  });
  await picker.focus();
  await picker.press("Enter");
  await page
    .getByRole("option", { name: "Seedling reference", exact: true })
    .click();
  await expect.poll(() => last.projectId).toBe(projectId);
  await expect(picker).toBeFocused();
  await page
    .getByRole("searchbox", { name: "Search files", exact: true })
    .fill("Watering");
  await page.getByRole("button", { name: "Search files", exact: true }).click();
  await expect.poll(() => last.query).toBe("Watering");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect.poll(() => last.query).toBe("");
  expect(last.memoryId).toBe(id);
  expect(last.projectId).toBeUndefined();
  expect(last.kind).toBeUndefined();
  expect(last.sort).toBe("newest");
});
test("an invalid page cursor can recover directly to the first file page", async ({
  page,
}) => {
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (
      path.endsWith("/files/search") &&
      route.request().postDataJSON().after
    ) {
      await route.fulfill({
        status: 400,
        json: {
          success: false,
          error: {
            code: "invalid_cursor",
            message: "Files changed. Start again to continue.",
          },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        success: true,
        data: path.endsWith("/me")
          ? { accountId: "cursor-files" }
          : path.endsWith("/storage")
            ? storage
            : path.endsWith("/files/search")
              ? { items: [file], nextCursor: "invalidated" }
              : [],
      },
    });
  });
  await page.goto(`${base}/app/settings/files`);
  await expect(page.getByText("Reference.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next files", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Files changed");
  await page
    .getByRole("button", { name: "Start from first page", exact: true })
    .click();
  await expect(page.getByText("Reference.txt", { exact: true })).toBeVisible();
});
