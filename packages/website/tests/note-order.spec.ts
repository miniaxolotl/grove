import { expect, test } from "@playwright/test";
import { fixture, note, project } from "./fixtures/workspace-fixture";
import { chooseOption } from "./fixtures/select";
import type { Memory } from "@lib/shared/contracts";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;

test("an unconfirmed arrangement survives closing and retries its original operation", async ({
  page,
}) => {
  const notes = [
    note,
    {
      ...note,
      id: "77770000-0000-4000-a000-000000000002",
      content: "# Second note",
      enrichment: undefined,
    },
  ];
  await fixture(page, notes);
  let reordered = false;
  const attempts: Record<string, unknown>[] = [];
  await page.route("**/api/grove/memories/search", async (route) => {
    if (route.request().postDataJSON().sort !== "custom")
      return route.fallback();
    await route.fulfill({
      json: {
        success: true,
        data: {
          items: reordered ? [...notes].reverse() : notes,
          nextCursor: null,
          orderState: (reordered ? "b" : "a").repeat(64),
        },
      },
    });
  });
  await page.route("**/api/grove/memories/*/organize", async (route) => {
    attempts.push(route.request().postDataJSON());
    if (!reordered) {
      reordered = true;
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      json: {
        success: true,
        data: {
          id: notes[1].id,
          state: "b".repeat(64),
          undo: { afterId: note.id },
        },
      },
    });
  });
  await page.goto(`${base}/app?sort=custom`);
  const trigger = page.getByRole("button", {
    name: "Arrange notes",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Arrange notes",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Move Second note up", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Retry same move", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog
    .getByRole("button", { name: "Retry same move", exact: true })
    .click();
  await expect(dialog).toContainText("Note order saved.");
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(dialog.getByRole("listitem").first()).toContainText(
    "Second note",
  );
});

for (const width of [1440, 320]) {
  test(`custom note order is scoped, paged and keyboard reversible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 });
    const notes: Memory[] = Array.from({ length: 6 }, (_, index) => ({
      ...note,
      id: `77770000-0000-4000-a000-${String(index + 1).padStart(12, "0")}`,
      projectId: index < 3 ? null : project.id,
      enrichment: undefined,
      content: `# Field note ${index + 1}`,
    }));
    const state = await fixture(page, notes);
    const orders = new Map<string, string[]>();
    let revision = 1;
    const stateToken = () => revision.toString(16).padStart(64, "0");
    const calls: Record<string, unknown>[] = [];
    const scoped = (scope: string) => {
      if (!orders.has(scope))
        orders.set(
          scope,
          notes
            .filter(
              (item) =>
                scope === "all" || (item.projectId ?? "unfiled") === scope,
            )
            .map((item) => item.id),
        );
      return orders.get(scope)!;
    };
    await page.route("**/api/grove/memories/search", async (route) => {
      const body = route.request().postDataJSON();
      if (body.sort !== "custom") return route.fallback();
      const ids = scoped(
        body.projectId === undefined ? "all" : (body.projectId ?? "unfiled"),
      );
      const offset = Number(body.cursor ?? 0);
      await route.fulfill({
        json: {
          success: true,
          data: {
            items: ids
              .slice(offset, offset + 2)
              .map((id) => state.records.get(id)),
            orderState: stateToken(),
            nextCursor: offset + 2 < ids.length ? String(offset + 2) : null,
          },
        },
      });
    });
    await page.route("**/api/grove/memories/*/organize", async (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
      const input = route.request().postDataJSON();
      calls.push(input);
      const ids = scoped(
        input.projectId === undefined ? "all" : (input.projectId ?? "unfiled"),
      );
      const index = ids.indexOf(id);
      const undo =
        index + 1 < ids.length
          ? { beforeId: ids[index + 1] }
          : index > 0
            ? { afterId: ids[index - 1] }
            : {};
      ids.splice(index, 1);
      ids.splice(
        input.beforeId
          ? ids.indexOf(input.beforeId)
          : input.afterId
            ? ids.indexOf(input.afterId) + 1
            : ids.length,
        0,
        id,
      );
      revision++;
      await route.fulfill({
        json: { success: true, data: { id, state: stateToken(), undo } },
      });
    });
    await page.goto(`${base}/app`);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await chooseOption(
      page.getByRole("combobox", { name: "Sort by" }),
      "custom",
    );
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page
      .getByRole("button", { name: "Arrange notes", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Arrange notes",
      exact: true,
    });
    await expect(dialog.getByRole("listitem")).toHaveCount(2);
    await dialog
      .getByRole("button", { name: "Move Field note 2 up", exact: true })
      .press("Enter");
    await expect(dialog.getByRole("listitem").first()).toContainText(
      "Field note 2",
    );
    await expect(dialog.getByRole("listitem").first()).toBeFocused();
    expect(calls[0]).toMatchObject({
      beforeId: notes[0].id,
      expectedVersion: note.version,
    });
    expect(calls[0]).not.toHaveProperty("projectId");
    await dialog
      .getByRole("button", { name: "Undo order", exact: true })
      .click();
    await expect(dialog.getByRole("listitem").first()).toContainText(
      "Field note 1",
    );
    await dialog
      .getByRole("button", { name: "Load more notes", exact: true })
      .click();
    await expect(dialog.getByRole("listitem")).toHaveCount(4);
    await dialog
      .getByRole("button", { name: "Move Field note 4 up", exact: true })
      .click();
    await expect(dialog.getByRole("listitem").nth(2)).toContainText(
      "Field note 4",
    );
    await page.keyboard.press("Escape");
    await page.goto(`${base}/app?notebook=personal&sort=custom`);
    await page
      .getByRole("button", { name: "Arrange notes", exact: true })
      .click();
    await expect(dialog.getByRole("listitem").first()).toContainText(
      "Field note 1",
    );
    await dialog
      .getByRole("button", { name: "Move Field note 2 up", exact: true })
      .click();
    expect(calls.at(-1)).toHaveProperty("projectId", null);
    await page.keyboard.press("Escape");
    await page.goto(`${base}/app?sort=custom`);
    await page
      .getByRole("button", { name: "Arrange notes", exact: true })
      .click();
    await expect(dialog.getByRole("listitem").first()).toContainText(
      "Field note 1",
    );
    expect(
      state.calls.filter(
        (call) => call.path === "/memories" || call.path.endsWith("/edit"),
      ),
    ).toHaveLength(0);
  });
}
