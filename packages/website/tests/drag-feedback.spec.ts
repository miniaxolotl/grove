import { expect, test } from "@playwright/test";
import { fixture, note, project } from "./fixtures/workspace-fixture";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;

for (const kind of ["note", "notebook"] as const) {
  test(`${kind} dragging keeps its floating label and highlights the target without a coloured left border`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const state = await fixture(page, [note]);
    const garden = {
      ...project,
      id: "00000000-0000-4000-a000-000000000090",
      name: "Garden",
      position: 2,
    };
    state.projects.push(garden);
    await page.goto(`${base}/app`);
    const source =
      kind === "note"
        ? page.locator(".memory-row .drag-handle")
        : page.locator(
            `.notebook-explorer [data-destination="${project.id}"] .notebook-drag-handle`,
          );
    const grip = (await source.boundingBox())!;
    const destination = page.locator(
      `.notebook-explorer [data-destination="${garden.id}"]`,
    );
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      grip.x + grip.width / 2 + 16,
      grip.y + grip.height / 2,
    );
    const preview = page.locator(".memory-drag-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveText(
      kind === "note" ? "Review preferences" : project.name,
    );
    const lifted = (await source.boundingBox())!;
    const bounds = (await destination.boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
      { steps: 10 },
    );
    await expect(destination).toHaveAttribute("data-drop-active", "true");
    await expect(destination).toHaveCSS("box-shadow", "none");
    await expect(destination).toHaveCSS("border-left-width", "0px");
    await expect(preview).toBeVisible();
    expect(await source.boundingBox()).toEqual(lifted);
    expect(await destination.boundingBox()).toEqual(bounds);
    await page.screenshot({
      path: info.outputPath(`${kind}-drag-clean-target.png`),
    });
    await page.mouse.up();
    if (kind === "note") {
      await expect
        .poll(() => state.records.get(note.id)?.projectId)
        .toBe(garden.id);
    } else {
      await expect
        .poll(
          () => state.projects.find((item) => item.id === project.id)?.parentId,
        )
        .toBe(garden.id);
    }
  });
}

test("keyboard pickup keeps announcements and target feedback without a coloured left border", async ({
  page,
}) => {
  const state = await fixture(page, [note]);
  await page.goto(`${base}/app`);
  const handle = page.locator(".memory-row .drag-handle");
  await handle.focus();
  await page.keyboard.press("Space", { delay: 50 });
  await expect(page.locator(".drag-cancel-target")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  const destination = page.locator(
    `.notebook-explorer [data-destination="${project.id}"]`,
  );
  await expect(destination).toHaveAttribute("data-drop-active", "true");
  await expect(destination).toHaveCSS("box-shadow", "none");
  await expect(page.locator('[aria-live="assertive"]')).toContainText(
    "Move into",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".drag-cancel-target")).toHaveCount(0);
  await expect(handle).toBeFocused();
  expect(state.calls.filter((call) => call.path === "/memories")).toHaveLength(
    0,
  );
});
