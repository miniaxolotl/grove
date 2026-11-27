import { expect, test } from "@playwright/test";
import { fixture, project } from "./fixtures/workspace-fixture";
import { chooseOption } from "./fixtures/select";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
for (const width of [1440, 768, 390, 320]) {
  test(`notebook display sorts only siblings and never writes manual order at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 480 : 900 });
    const state = await fixture(page);
    state.projects.splice(0);
    const entries = [
      {
        id: "00000000-0000-4000-a000-000000000071",
        name: "Winter",
        position: 1,
        createdAt: "2026-10-03T00:00:00Z",
        parentId: null,
      },
      {
        id: "00000000-0000-4000-a000-000000000072",
        name: "Autumn",
        position: 2,
        createdAt: "2026-10-01T00:00:00Z",
        parentId: null,
      },
      {
        id: "00000000-0000-4000-a000-000000000073",
        name: "Spring",
        position: 3,
        createdAt: "2026-10-02T00:00:00Z",
        parentId: null,
      },
      {
        id: "00000000-0000-4000-a000-000000000074",
        name: "Zinnias",
        position: 1,
        createdAt: "2026-10-02T00:00:00Z",
        parentId: "00000000-0000-4000-a000-000000000072",
      },
      {
        id: "00000000-0000-4000-a000-000000000075",
        name: "Asters",
        position: 2,
        createdAt: "2026-10-01T00:00:00Z",
        parentId: "00000000-0000-4000-a000-000000000072",
      },
    ];
    state.projects.push(...entries.map((entry) => ({ ...project, ...entry })));
    const saved = structuredClone(state.projects);
    await page.goto(`${base}/app/projects`);
    const sort = page
      .getByRole("main")
      .getByRole("combobox", { name: "Notebook display order", exact: true });
    await chooseOption(sort, "title_asc");
    const roots = page.locator(
      "main .notebook-tree > .notebook-tree-list > li > .notebook-tree-row .notebook-tree-link",
    );
    await expect(roots).toHaveText(["Autumn", "Spring", "Winter"]);
    const children = page.locator(
      "main .notebook-tree-list .notebook-tree-list .notebook-tree-link",
    );
    await expect(children).toHaveText(["Asters", "Zinnias"]);
    await chooseOption(sort, "created_desc");
    await expect(roots).toHaveText(["Winter", "Spring", "Autumn"]);
    await page.reload();
    await expect(roots).toHaveText(["Winter", "Spring", "Autumn"]);
    await expect(sort).toContainText("Newest created");
    await chooseOption(sort, "custom");
    await expect(roots).toHaveText(["Winter", "Autumn", "Spring"]);
    expect(state.projects).toEqual(saved);
    expect(
      state.calls.filter((call) => call.path.endsWith("/organize")),
    ).toEqual([]);
    await chooseOption(sort, "title_desc");
    await page.screenshot({
      path: info.outputPath(`notebook-display-${width}.png`),
    });
    await page
      .getByRole("main")
      .getByRole("button", { name: "Organize", exact: true })
      .click();
    const organizer = page.getByRole("dialog", {
      name: "Organize notebooks",
      exact: true,
    });
    await expect(
      organizer.locator(
        ".notebook-tree > .notebook-tree-list > li > .notebook-tree-row .notebook-organizer-choice",
      ),
    ).toHaveText(["Winter", "Autumn", "Spring"]);
  });
}
