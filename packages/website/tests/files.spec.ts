import { test, expect } from "@playwright/test";
import { fixturePath, catalogResponse } from "./fixtures/notebook-catalog";
import { fixture, note } from "./fixtures/workspace-fixture";
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

test("Files returns from a note to its scoped lookup, expanded location and focus", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/grove/admin", (route) =>
    route.fulfill({ json: { success: true, data: { role: "member" } } }),
  );
  await page.route("**/api/grove/files/storage", (route) =>
    route.fulfill({ json: { success: true, data: storage } }),
  );
  await page.route("**/api/grove/files/search", (route) =>
    route.fulfill({
      json: { success: true, data: { items: [file], nextCursor: null } },
    }),
  );
  await page.route("**/api/grove/files/locations", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          items: [
            {
              key: `note:${note.id}`,
              title: "Review preferences",
              memoryId: note.id,
              projectId: null,
              projectName: null,
              conversationId: null,
              batchId: null,
              archived: false,
              historical: false,
              downloadPath: null,
            },
          ],
          nextCursor: null,
        },
      },
    }),
  );
  await page.goto(`${base}/app/settings/files?memoryId=${note.id}`);
  const search = page.getByRole("searchbox", {
    name: "Search files",
    exact: true,
  });
  await search.fill("Reference");
  await search.press("Enter");
  await page.getByText("Reference.txt", { exact: true }).click();
  const destination = page.getByRole("link", {
    name: "Review preferences",
    exact: true,
  });
  await destination.click();
  await expect(page).toHaveURL(
    new RegExp(`/app/memories/${note.id}\\?return=`),
  );
  await expect(page).toHaveTitle("Review preferences · Grove");
  await page
    .getByRole("button", { name: "Back to notes", exact: true })
    .click();
  await expect(page).toHaveURL(
    `${base}/app/settings/files?memoryId=${note.id}`,
  );
  await expect(search).toHaveValue("Reference");
  await expect(destination).toBeVisible();
  await expect(destination).toBeFocused();
});

test("a transient refresh keeps mounted files, expanded locations and visible feedback", async ({
  page,
}) => {
  let failed = false;
  await page.route("**/api/grove/**", async (route) => {
    const path = fixturePath(route.request().url()).replace("/api/grove", "");
    if (
      failed &&
      ["/files/search", "/files/storage", "/files/locations"].includes(path)
    ) {
      await route.fulfill({
        status: 503,
        json: {
          success: false,
          error: { code: "unavailable", message: "The refresh failed." },
        },
      });
      return;
    }
    const data =
      path === "/me"
        ? { accountId: "files-retention" }
        : path === "/files/storage"
          ? storage
          : path === "/files/search"
            ? { items: [file], nextCursor: null }
            : path === "/files/locations"
              ? {
                  items: [
                    {
                      key: `chat:${id}`,
                      title: "Reference conversation",
                      memoryId: null,
                      projectId: null,
                      projectName: null,
                      conversationId: id,
                      batchId: null,
                      archived: false,
                      historical: false,
                      downloadPath: null,
                    },
                  ],
                  nextCursor: null,
                }
              : [];
    await route.fulfill({
      json: {
        success: true,
        data: catalogResponse(route.request().url(), data),
      },
    });
  });
  await page.goto(`${base}/app/settings/files`);
  const row = page
    .getByRole("list", { name: "Uploaded files" })
    .getByRole("listitem")
    .first();
  await page.getByText("Reference.txt", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Reference conversation", exact: true }),
  ).toBeVisible();
  const element = await row.elementHandle();
  const before = await row.boundingBox();
  failed = true;
  await page
    .getByRole("button", { name: "Refresh files", exact: true })
    .click();
  const receipt = page.getByText(
    "Couldn’t refresh. Showing the last loaded data.",
    { exact: true },
  );
  await expect(receipt).toBeInViewport();
  expect((await receipt.boundingBox())!.height).toBeGreaterThan(10);
  expect(await row.evaluate((node, old) => node === old, element)).toBe(true);
  expect((await row.boundingBox())!.y).toEqual(before!.y);
  await expect(row.locator("details")).toHaveAttribute("open", "");
  await expect(
    page.getByRole("link", { name: "Reference conversation", exact: true }),
  ).toBeVisible();
});
for (const width of [320, 1440]) {
  test(`open files from Settings, filter and retry without losing the selection at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let unavailable = true;
    const sketch = {
      ...file,
      id: "00000000-0000-4000-a000-000000000102",
      filename: "Sketch.png",
      kind: "image",
    };
    await page.route("**/api/grove/**", async (route) => {
      const url = route.request().url();
      let data: unknown = [];
      if (url.endsWith("/me")) data = { accountId: "filtered-files" };
      if (url.endsWith("/files/storage"))
        data = {
          ...storage,
          fileCount: 2,
          visibleBytes: 200,
          budgetBytes: 200,
          attempts: 2,
        };
      if (url.endsWith("/files/search")) {
        const { kind } = route.request().postDataJSON();
        if (kind === "image" && unavailable) {
          await route.fulfill({
            status: 503,
            json: {
              success: false,
              error: { code: "unavailable", message: "Files are unavailable" },
            },
          });
          return;
        }
        data = {
          items: kind === "image" ? [sketch] : [file, sketch],
          nextCursor: null,
        };
      }
      await route.fulfill({
        json: { success: true, data: catalogResponse(url, data) },
      });
    });
    await page.goto(`${base}/app/settings`);
    const nav = page.getByRole("navigation", { name: "Settings sections" });
    if (width === 320)
      await nav
        .getByRole("button", { name: /Change settings section/ })
        .click();
    await nav.getByRole("link", { name: "Files & storage" }).click();
    const results = page.getByRole("list", { name: "Uploaded files" });
    await expect(results.getByRole("listitem")).toHaveCount(2);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const kind = page.getByLabel("File type", { exact: true });
    await kind.selectOption("image");
    await expect(page.getByRole("alert")).toContainText(
      "Files are unavailable",
    );
    await expect(results).toHaveCount(0);
    unavailable = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(kind).toHaveValue("image");
    await expect(results.getByRole("listitem")).toHaveCount(1);
    await expect(results).toContainText("Sketch.png");
    await page.getByRole("button", { name: /Clear file type/ }).click();
    await expect(results.getByRole("listitem")).toHaveCount(2);
  });
}
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
  await expect(page.getByText("No uploads yet", { exact: true })).toBeVisible();
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
  await expect(
    page.getByRole("link", { name: "Open Ask Grove", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Reset file search" }).click();
  await expect(
    page.getByRole("searchbox", { name: "Search files" }),
  ).toHaveValue("");
  await expect(page.getByText("No uploads yet", { exact: true })).toBeVisible();
});
test("Ask Grove, imports and settings expose the shared files destination", async ({
  page,
}, info) => {
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: {
        success: true,
        data: catalogResponse(
          route.request().url(),
          path.endsWith("/me")
            ? { accountId: "entry-files" }
            : path.endsWith("/memories/search")
              ? { items: [], nextCursor: null }
              : path.endsWith("/ask-tools")
                ? { defaults: { organize: true, exa: false, tavily: false } }
                : [],
        ),
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
  const cardTitle = page.getByRole("heading", {
    name: "Import notes",
    exact: true,
  });
  const card = cardTitle.locator("xpath=ancestor::section[1]");
  const importButton = card.getByRole("button", {
    name: "Import notes",
    exact: true,
  });
  const filesLink = card.getByRole("link", {
    name: "View files & storage",
    exact: true,
  });
  await expect(page.getByText("Opening notebooks…")).toBeHidden();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await cardTitle.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`data-import-${width}.png`),
    });
    const [button, link] = await Promise.all([
      importButton.boundingBox(),
      filesLink.boundingBox(),
    ]);
    expect(button).not.toBeNull();
    expect(link).not.toBeNull();
    const gap =
      Math.abs(button!.y - link!.y) < 4
        ? link!.x - (button!.x + button!.width)
        : link!.y - (button!.y + button!.height);
    expect(gap).toBeGreaterThanOrEqual(8);
  }
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
