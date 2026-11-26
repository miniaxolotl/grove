import { expect, test } from "@playwright/test";
import { fixture, note, project } from "./fixtures/workspace-fixture";
import { openNoteAction } from "./fixtures/note-action";
import {
  billingLimits,
  billingUnits,
  type BillingStatus,
} from "@lib/shared/billing";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;

test("billing keeps mounted usage on a failed refresh and clears it on access loss", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/grove/admin", (route) =>
    route.fulfill({
      status: 403,
      json: {
        success: false,
        error: { code: "forbidden", message: "Owner access only." },
      },
    }),
  );
  let status = 200;
  const data: BillingStatus = {
    enabled: true,
    customer: false,
    units: billingUnits,
    proLimits: billingLimits.pro,
    subscription: null,
    prices: [],
    trial: null,
    usage: {
      plan: "free",
      dailyResetAt: "2026-11-27T00:00:00Z",
      monthlyResetAt: "2026-12-01T00:00:00Z",
      metrics: Object.fromEntries(
        Object.entries(billingLimits.free).map(([key, limit]) => [
          key,
          {
            today: 0,
            month: 0,
            dailyLimit: limit.daily,
            monthlyLimit: limit.monthly,
          },
        ]),
      ) as NonNullable<BillingStatus["usage"]>["metrics"],
    },
  };
  await page.route("**/api/grove/billing", (route) =>
    route.fulfill({
      status,
      json:
        status === 200
          ? { success: true, data }
          : {
              success: false,
              error: {
                code: status === 403 ? "forbidden" : "unavailable",
                message: "Usage could not load.",
              },
            },
    }),
  );
  await page.goto(`${base}/app/settings/billing`);
  const metrics = page.locator(".billing-metrics");
  await expect(metrics).toBeVisible();
  const node = await metrics.elementHandle();
  const before = await metrics.boundingBox();
  status = 503;
  await page
    .getByRole("button", { name: "Refresh usage", exact: true })
    .click();
  const receipt = page.getByText(
    "Couldn’t refresh usage. Showing the last loaded values. Try Refresh usage again.",
    { exact: true },
  );
  await expect(receipt).toBeInViewport();
  expect(await metrics.evaluate((current, old) => current === old, node)).toBe(
    true,
  );
  expect(await metrics.boundingBox()).toEqual(before);
  status = 403;
  await page
    .getByRole("button", { name: "Refresh usage", exact: true })
    .click();
  await expect(metrics).toHaveCount(0);
});

test("inaccessible chat links never appear as a fresh conversation", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.route("**/api/grove/conversations/*", (route) =>
    route.fulfill({
      status: 404,
      json: {
        success: false,
        error: { code: "not_found", message: "Conversation unavailable." },
      },
    }),
  );
  await page.goto(`${base}/app/ask?chat=00000000-0000-4000-a000-000000000091`);
  await expect(
    page.getByRole("heading", { name: "This conversation couldn’t open" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What’s on your mind?" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Retry conversation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "This conversation couldn’t open" }),
  ).toBeVisible();
  expect(
    state.calls.filter((call) => call.path.endsWith("/turns")),
  ).toHaveLength(0);
});

test("quick-open notes survive reload and browser back with a resource title", async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`${base}/app`);
  await page.locator(`[data-note-id="${note.id}"] .memory-open`).click();
  await expect(page).toHaveURL(new RegExp(`[?&]note=${note.id}`));
  await expect(page).toHaveTitle("Review preferences · Grove");
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "Note", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: "Note", exact: true }),
  ).toHaveCount(0);
  await page.goForward();
  await expect(
    page.getByRole("dialog", { name: "Note", exact: true }),
  ).toBeVisible();
});

test("conversation URLs load the authorized chat without sending a question", async ({
  page,
}) => {
  const state = await fixture(page);
  const id = "00000000-0000-4000-a000-000000000091";
  state.chats.set(id, {
    id,
    title: "Launch review",
    scope: { includePersonal: false },
    version: 1,
    updatedAt: note.updatedAt,
    toolsVersion: 0,
    tools: { exa: false, tavily: false, organize: false },
    turns: [
      {
        id: "00000000-0000-4000-a000-000000000092",
        question: "What needs review before launch?",
        format: "plain",
        expectedVersion: 0,
        status: "failed",
        result: null,
        error: "No generation requested.",
        createdAt: note.createdAt,
      },
    ],
  });
  await page.goto(`${base}/app/ask?chat=${id}`);
  await expect(
    page.getByText("What needs review before launch?", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Launch review · Grove");
  expect(
    state.calls.filter((call) => call.path.endsWith("/turns")),
  ).toHaveLength(0);
  await page.reload();
  await expect(
    page.getByText("What needs review before launch?", { exact: true }),
  ).toBeVisible();
});

test("an empty notebook scope is not presented as an unmatched search", async ({
  page,
}) => {
  await fixture(page, [{ ...note, projectId: project.id }]);
  await page.goto(`${base}/app?notebook=personal`);
  await expect(
    page.getByRole("heading", { name: "No notes here yet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clear filters", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".library-empty")
      .getByRole("link", { name: "New note", exact: true }),
  ).toHaveAttribute("href", "/app/notes/new");
});

test("saved history has a scoped read retry without restoring anything", async ({
  page,
}) => {
  const state = await fixture(page);
  let failed = true;
  await page.route(`**/api/grove/memories/${note.id}/revisions`, (route) =>
    route.fulfill({
      status: failed ? 503 : 200,
      json: failed
        ? {
            success: false,
            error: { code: "unavailable", message: "History could not load." },
          }
        : { success: true, data: [note] },
    }),
  );
  await page.goto(`${base}/app/memories/${note.id}`);
  await openNoteAction(page, "Revision history");
  const history = page.getByRole("dialog", { name: "Revision history" });
  await expect(history.getByRole("alert")).toBeVisible();
  failed = false;
  await history.getByRole("button", { name: "Retry history" }).click();
  await expect(history.getByRole("alert")).toHaveCount(0);
  await expect(history).toContainText("Current");
  expect(
    state.calls.filter((call) => call.path.endsWith("/restore")),
  ).toHaveLength(0);
});

test("long saved history offers full versions without calling the saved note a draft", async ({
  page,
}) => {
  const state = await fixture(page, [{ ...note, version: 2 }]);
  state.revisions.set(note.id, [
    { ...note, content: "Earlier saved evidence. ".repeat(350) },
    { ...note, version: 2 },
  ]);
  await page.goto(`${base}/app/memories/${note.id}`);
  await openNoteAction(page, "Revision history");
  const history = page.getByRole("dialog", { name: "Revision history" });
  await expect(history.locator(".revision-review")).toBeVisible();
  await expect(history).not.toContainText("This draft cannot be compared");
  await history.getByText("Full versions", { exact: true }).click();
  await expect(history).toContainText("Earlier saved evidence.");
});

test("finder refinement keeps retained result targets stationary", async ({
  page,
}) => {
  await fixture(page);
  let hold = false;
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route("**/api/grove/ask", async (route) => {
    if (hold) {
      started.resolve();
      await release.promise;
    }
    await route.fulfill({
      json: { success: true, data: { sources: [note], statements: [] } },
    });
  });
  try {
    await page.goto(`${base}/app`);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search your Grove" });
    const input = dialog.getByRole("textbox", { name: "Search your Grove" });
    await input.fill("Review");
    const row = dialog.locator(".quick-search-result").first();
    await expect(dialog.getByRole("status")).not.toHaveText("Searching…");
    await expect(row).toBeVisible();
    const before = (await row.boundingBox())!;
    hold = true;
    await input.fill("Review next");
    await started.promise;
    await expect(
      dialog.getByRole("button", { name: "Cancel search" }),
    ).toBeVisible();
    expect(
      Math.abs((await row.boundingBox())!.y - before.y),
    ).toBeLessThanOrEqual(1);
  } finally {
    release.resolve();
  }
});

test("failed note refresh visibly explains retained content", async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`${base}/app`);
  const row = page.locator(`[data-note-id="${note.id}"]`);
  await expect(row).toBeVisible();
  await page.route("**/api/grove/memories/search", (route) =>
    route.fulfill({
      status: 503,
      json: {
        success: false,
        error: { code: "unavailable", message: "Read failed." },
      },
    }),
  );
  await page.evaluate((id) => {
    const channel = new BroadcastChannel("grove-workspace:fixture-user");
    channel.postMessage({ ids: [id] });
    channel.close();
  }, note.id);
  await expect(
    page.getByRole("button", { name: "Retry refreshing notes" }),
  ).toBeVisible();
  const explanation = page.getByText("Couldn’t refresh. Showing saved notes.", {
    exact: true,
  });
  const bounds = (await explanation.boundingBox())!;
  expect(bounds.width).toBeGreaterThan(50);
  expect(bounds.height).toBeGreaterThan(10);
  await expect(row).toBeVisible();
});

test("notebook deletion is distinguished in the keyboard action menu", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`${base}/app`);
  const trigger = page.getByRole("button", {
    name: `Notebook actions for ${project.name}`,
    exact: true,
  });
  await trigger.click();
  const menu = page.getByRole("group", {
    name: `Notebook actions for ${project.name}`,
    exact: true,
  });
  const remove = menu.getByRole("button", {
    name: "Delete notebook…",
    exact: true,
  });
  await expect(remove).toHaveCSS("color", "rgb(146, 58, 50)");
  await menu.getByRole("link", { name: "New note", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(remove).toBeFocused();
  await page.keyboard.press("Escape");
  expect(
    state.calls.filter((call) => call.path.endsWith("/delete")),
  ).toHaveLength(0);
  await expect(trigger).toBeFocused();
});

for (const width of [1440, 390, 320]) {
  test(`long saved sources have a usable user-scroll path at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 480 : 700 });
    await fixture(page);
    await page.route(`**/api/grove/memories/${note.id}/revisions/1`, (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            id: note.id,
            version: 1,
            currentVersion: 2,
            content: `# Saved evidence\n\n${"A saved paragraph with enough content for a long source.\n\n".repeat(50)}## Final source passage\n\nThe end of the saved evidence.`,
          },
        },
      }),
    );
    await page.goto(`${base}/app/memories/${note.id}?revision=1`);
    const end = page.getByRole("heading", { name: "Final source passage" });
    await expect(end).toBeAttached();
    const reader = page.getByRole("region", { name: "Saved source" });
    await expect(reader).toBeVisible();
    expect((await reader.boundingBox())!.height).toBeGreaterThan(160);
    await reader.hover();
    await page.mouse.wheel(0, 12000);
    await expect(end).toBeInViewport({ ratio: 1 });
    await reader.focus();
    await page.keyboard.press("Control+Home");
    await expect(
      page.getByRole("heading", { name: "Saved evidence" }),
    ).toBeInViewport();
    await page.keyboard.press("Control+End");
    await expect(end).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("link", { name: "Open current note" }),
    ).toHaveAttribute("href", `/app/memories/${note.id}`);
  });
}
