import { expect, test, type Page } from "@playwright/test";
import { fixture, project } from "./fixtures/workspace-fixture";
import { chooseOption } from "./fixtures/select";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;

async function notebooks(page: Page) {
  const state = await fixture(page);
  const field = {
    ...project,
    id: crypto.randomUUID(),
    name: "Field studies",
    parentId: project.id,
  };
  const leaf = {
    ...field,
    id: crypto.randomUUID(),
    name: "Interviews",
    parentId: field.id,
  };
  state.projects.push(field, leaf, {
    ...leaf,
    id: crypto.randomUUID(),
    name: "Observations",
  });
  return leaf;
}

test("Ask filters nested paths without committing a scope or losing the draft", async ({
  page,
}, info) => {
  await notebooks(page);
  await page.setViewportSize({ width: 1120, height: 760 });
  await page.goto(`${base}/app/ask`);
  const scope = page.getByRole("combobox", { name: "Look in notebook" });
  const draft = page.getByLabel("Ask about your notes");
  await draft.fill("What did we learn from the field studies?");
  await scope.focus();
  await scope.press("s");
  const filter = page.getByRole("textbox", { name: "Filter notebooks" });
  await expect(filter).toBeFocused();
  await expect(filter).toHaveValue("s");
  await page.keyboard.type("tud");
  await expect(filter).toHaveValue("stud");
  await filter.fill("STUD");
  await expect(page.getByRole("option")).toHaveCount(3);
  await filter.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const leaf = page.getByRole("option", {
    name: /Field studies \/ Interviews/,
  });
  await expect(leaf).toBeFocused();
  await page.screenshot({ path: info.outputPath("ask-notebook-filter.png") });
  await page.keyboard.press("Escape");
  await expect(scope).toBeFocused();
  await expect(scope).toHaveText("All notes");
  await expect(draft).toHaveValue("What did we learn from the field studies?");
  await scope.click();
  await expect(filter).toHaveValue("");
  await filter.fill("missing notebook");
  await expect(page.getByText(/No matching notebooks/)).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
  await filter.press("Enter");
  await expect(filter).toBeFocused();
  await filter.fill("view");
  await filter.press("ArrowDown");
  await expect(leaf).toBeFocused();
  await leaf.press("Enter");
  await expect(scope).toHaveText(
    "Website redesign / Field studies / Interviews",
  );
  await expect(scope).toBeFocused();
  await chooseOption(scope, "personal");
  await expect(scope).toHaveText("Unfiled");
});

test.describe("touch browsing", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 670 } });

  test("opens on the current notebook without focusing the filter until tapped", async ({
    page,
  }) => {
    await notebooks(page);
    await page.goto(`${base}/app/ask`);
    const scope = page.getByRole("combobox", { name: "Look in notebook" });
    const filter = page.getByRole("textbox", { name: "Filter notebooks" });
    await page.evaluate(() => {
      document.addEventListener("focusin", ({ target }) => {
        if (target instanceof HTMLInputElement)
          target.dataset.receivedFocus = "true";
      });
    });
    await scope.tap();
    await expect(page.getByRole("option", { selected: true })).toBeFocused();
    expect(await filter.getAttribute("data-received-focus")).toBeNull();
    await filter.tap();
    await expect(filter).toBeFocused();
    await filter.fill("interviews");
    await page.getByRole("option", { name: /Interviews/ }).tap();
    await expect(scope).toContainText("Interviews");
    await expect(scope).toBeFocused();
  });
});

test("quick search keeps its own focus, scope and text when the nested picker is dismissed", async ({
  page,
}) => {
  const leaf = await notebooks(page);
  await page.route("**/api/grove/ask", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          status: "search",
          searchMode: "lexical",
          sources: [],
          answer: null,
        },
      },
    }),
  );
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`${base}/app`);
  const opener = page.getByRole("button", { name: /Search anything/ });
  await opener.click();
  const search = page.getByRole("dialog", { name: "Search your Grove" });
  const scope = search.getByRole("combobox", { name: "Search in notebook" });
  const text = search.getByRole("textbox", { name: "Search your Grove" });
  await text.fill("launch");
  await chooseOption(scope, leaf.id);
  await scope.press("Enter");
  const filter = page.getByRole("textbox", { name: "Filter notebooks" });
  await expect(filter).toBeFocused();
  await filter.fill("unfiled");
  await filter.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Unfiled" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(scope).toBeFocused();
  await expect(scope).toContainText("Interviews");
  await expect(text).toHaveValue("launch");
  await scope.press("Enter");
  await filter.press("Enter");
  await expect(scope).toContainText("Interviews");
  await scope.click();
  await page
    .getByRole("button", { name: "Back to Search in notebook" })
    .click();
  await expect(scope).toBeFocused();
  await scope.press("Escape");
  await expect(opener).toBeFocused();
});

test("a platform close request leaves library filters open and preserves their selection", async ({
  page,
}) => {
  await notebooks(page);
  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const filters = page.getByRole("dialog", { name: "Filter notes" });
  const scope = filters.getByRole("combobox", {
    name: "Notebook",
    exact: true,
  });
  await scope.click();
  const inner = page.getByRole("dialog", { name: "Notebook", exact: true });
  await inner
    .getByRole("textbox", { name: "Filter notebooks" })
    .fill("interviews");
  await inner.evaluate((element) =>
    (element as HTMLDialogElement).requestClose(),
  );
  await expect(scope).toBeFocused();
  await expect(scope).toHaveText("All notes");
  await expect(
    filters.getByRole("button", { name: "Close filters" }),
  ).toBeVisible();
});
