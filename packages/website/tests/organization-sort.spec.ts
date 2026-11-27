import { expect, test } from "@playwright/test";
import { fixture, note, project } from "./fixtures/workspace-fixture";
import { chooseOption } from "./fixtures/select";
import { openWorkspaceNavigation } from "./fixtures/workspace-navigation";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
for (const width of [1440, 390, 320]) {
  test.describe(`organizer at ${width}px`, () => {
    test.use({
      viewport: { width, height: 844 },
      isMobile: width < 600,
      hasTouch: width < 600,
      colorScheme: width === 320 ? "dark" : "light",
    });
    test("browse, place, undo and return to the sidebar", async ({
      page,
    }, info) => {
      const state = await fixture(page);
      await page.route("**/api/grove/me", (route) =>
        route.fulfill({
          json: {
            success: true,
            data: { plan: { tier: "unlimited", source: "complimentary" } },
          },
        }),
      );
      const names = [
        "Field studies",
        "Spring planting and pollinator observations",
        "References",
        "Garden journal",
        "Reading list",
        "Seed inventory",
      ];
      state.projects.push(
        ...names.map((name, i) => ({
          ...project,
          name,
          id: `00000000-0000-4000-a000-00000000005${i}`,
          parentId: i === 1 ? "00000000-0000-4000-a000-000000000050" : null,
        })),
      );
      await page.goto(`${base}/app`);
      if (width < 600) await openWorkspaceNavigation(page);
      const entry = page
        .locator(".notebook-explorer")
        .getByRole("button", { name: "Organize", exact: true });
      await expect(entry).toBeInViewport();
      if (width < 600) {
        expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        // A disclosed notebook list gets the same space as the navigation above
        // it, rather than competing with Settings and Commands for a column.
        const tree = page.getByRole("region", { name: "Your notebooks" });
        const nav = page.locator(
          ".workspace-mobile-navigation .workspace-navigation-body",
        );
        expect((await tree.boundingBox())!.width).toBe(
          (await nav.boundingBox())!.width,
        );
      }
      await page.screenshot({ path: info.outputPath(`entry-${width}.png`) });
      if (width < 600) await entry.tap();
      else await entry.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Organize notebooks" });
      await page.screenshot({ path: info.outputPath(`browse-${width}.png`) });
      await expect(
        dialog.getByRole("heading", { name: "Organize notebooks" }),
      ).toBeFocused();
      await expect(
        dialog.getByRole("heading", { name: "Choose a notebook" }),
      ).toHaveCount(0);
      await page.keyboard.press("Tab");
      await expect(
        dialog.getByRole("button", { name: "Close dialog" }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("textbox")).toBeFocused();
      const choice = dialog.getByRole("button", {
        name: names[1],
        exact: true,
      });
      if (width < 600) {
        const leaf = dialog.getByRole("button", {
          name: "References",
          exact: true,
        });
        expect((await leaf.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await choice.click();
      const move = dialog.getByRole("button", { name: "Move to…" });
      await expect(move).toBeInViewport({ ratio: 1 });
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await expect(
        dialog.getByRole("button", { name: /Move up|Move down/ }),
      ).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`selected-${width}.png`) });
      await move.press("Enter");
      const chooser = page.getByRole("dialog", { name: "Move notebook" });
      await expect(
        chooser.getByRole("heading", { name: "Move notebook" }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(move).toBeFocused();
      await expect(choice).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Enter");
      await chooser.getByRole("radio", { name: "Top level" }).check();
      await chooseOption(
        chooser.getByRole("combobox", { name: "Position" }),
        `before:${project.id}`,
      );
      await chooser
        .getByRole("button", { name: "Move notebook", exact: true })
        .click();
      await expect(choice).toHaveAttribute("aria-pressed", "true");
      await expect(move).toBeFocused();
      await dialog.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(
        dialog.getByRole("button", { name: "Move out", exact: true }),
      ).toBeEnabled();
      expect(state.projects.find((p) => p.name === names[1])?.parentId).toBe(
        state.projects[1].id,
      );
      await page.keyboard.press("Escape");
      await expect(entry).toBeFocused();
    });
  });
}

test("explicit note order searches and pages the complete notebook", async ({
  page,
}, info) => {
  // Exercise manual cursor traversal even on browsers that can append on scroll.
  await page.addInitScript(() =>
    Reflect.deleteProperty(window, "IntersectionObserver"),
  );
  const records = [1, 2, 3, 4].map((n) => ({
    ...note,
    projectId: project.id,
    id: `00000000-0000-4000-a000-00000000006${n}`,
    content: `# Plot ${n}`,
    enrichment: { ...note.enrichment!, title: `Plot ${n}` },
    updatedAt: `2026-10-0${n}T10:00:00Z`,
  }));
  const state = await fixture(page, [...records, note]);
  await page.goto(`${base}/app/projects/${project.id}`);
  const entry = page
    .locator(".notebook-explorer")
    .getByRole("button", { name: "Organize", exact: true });
  await entry.click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: project.name, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".memory-row .memory-notebook")).toHaveCount(0);
  await page.getByRole("button", { name: /^Filters/ }).click();
  const sort = page.getByRole("combobox", { name: "Sort by" });
  await chooseOption(sort, "updated_asc");
  await sort.click();
  await page.screenshot({ path: info.outputPath("sort-desktop.png") });
  await page.keyboard.press("Escape");
  await chooseOption(
    page.getByRole("combobox", { name: "Note type" }),
    "preference",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("textbox", { name: "Search notes" }).fill("Plot");
  const requests = () =>
    state.calls.filter((c) => c.path === "/memories/search").map((c) => c.body);
  const scope = {
    sort: "updated_asc",
    query: "Plot",
    projectId: project.id,
    kind: "preference",
  };
  await expect.poll(() => requests().at(-1)).toMatchObject(scope);
  expect(requests().at(-1)).not.toHaveProperty("cursor");
  const rows = page.locator(".memory-row");
  await expect(rows.first()).toContainText("Plot 1");
  await page
    .getByRole("main")
    .getByRole("button", { name: /^Load more( notes)?$/ })
    .click();
  await expect
    .poll(() => requests().at(-1))
    .toMatchObject({ ...scope, cursor: "2" });
  await expect(rows).toHaveCount(4);
  await expect(rows.last()).toContainText("Plot 4");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(sort).toHaveText("Least recently edited");
  await chooseOption(sort, "auto");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search notes" });
  await search.fill("No plot matches this");
  await expect
    .poll(() => requests().at(-1))
    .toMatchObject({ sort: "relevance", query: "No plot matches this" });
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(search).toHaveValue("");
  await expect(rows.first()).toContainText("Plot 4");
});
