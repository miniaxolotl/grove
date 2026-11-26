import { test, expect, type Locator } from "@playwright/test";
import { fixture, note, handoff } from "./fixtures/workspace-fixture";
import AxeBuilder from "@axe-core/playwright";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const source = "# Link work\n\nKeep this caption";
const href = `/app/memories/${handoff.id}?revision=1#next`;
async function expectSource(editor: Locator, value: string) {
  await expect
    .poll(async () =>
      (await editor.locator(".cm-line").allTextContents()).join("\n"),
    )
    .toBe(value);
}

for (const width of [1440, 390, 320]) {
  test(`link insertion and editing preserve the captured selection and isolated Undo at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 480 : 900 });
    const state = await fixture(page, [{ ...note, content: source }, handoff]);
    await page.goto(`${base}/app/memories/${note.id}?mode=edit`);
    await page.getByRole("button", { name: "Markdown", exact: true }).click();
    const editor = page.getByRole("textbox", {
      name: "What should stay with you?",
    });
    await editor.focus();
    await editor.press("Control+End");
    await editor.press("Control+Shift+ArrowLeft");
    await editor.press("Control+k");
    const insert = page.getByRole("dialog", {
      name: "Insert link",
      exact: true,
    });
    await expect(
      insert.getByRole("textbox", { name: "Label", exact: true }),
    ).toHaveValue("caption");
    await insert
      .getByRole("textbox", { name: "Destination", exact: true })
      .fill(href);
    await expect(
      insert.getByRole("checkbox", { name: "Follow the linked title" }),
    ).not.toBeChecked();
    await expect(insert.locator(".link-editor-title-choice")).toHaveCSS(
      "display",
      "flex",
    );
    expect((await insert.boundingBox())!.height).toBeLessThanOrEqual(450);
    expect(
      (await new AxeBuilder({ page }).include("dialog[open]").analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`link-editor-${width}.png`),
    });
    await insert
      .getByRole("button", { name: "Insert link", exact: true })
      .click();
    const linked = `# Link work\n\nKeep this [caption](<${href}>)`;
    await expectSource(editor, linked);
    await expect(editor).toBeFocused();
    await editor.press("Control+z");
    await expectSource(editor, source);
    await editor.press("Control+Shift+z");
    await expectSource(editor, linked);
    await editor.press("Control+k");
    const edit = page.getByRole("dialog", { name: "Edit link", exact: true });
    await expect(
      edit.getByRole("textbox", { name: "Destination", exact: true }),
    ).toHaveValue(href);
    await edit
      .getByRole("textbox", { name: "Label", exact: true })
      .fill("A literal caption");
    await edit
      .getByRole("button", { name: "Update link", exact: true })
      .click();
    await expectSource(
      editor,
      linked.replace("[caption]", "[A literal caption]"),
    );
    await expect
      .poll(() => state.records.get(note.id)?.content)
      .toBe(linked.replace("[caption]", "[A literal caption]"));
    await editor.press("Control+k");
    await edit
      .getByRole("textbox", { name: "Label", exact: true })
      .fill("Do not apply this");
    await page.keyboard.press("Escape");
    await expect(editor).toBeFocused();
    await expect(editor).not.toContainText("Do not apply this");
  });
}

test("link dialog validates destinations without discarding inputs and marks only deliberate title-following links", async ({
  page,
}) => {
  await fixture(page, [{ ...note, content: source }, handoff]);
  await page.goto(`${base}/app/memories/${note.id}?mode=edit`);
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.focus();
  await editor.press("Control+End");
  await editor.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Insert link", exact: true });
  const destination = dialog.getByRole("textbox", {
    name: "Destination",
    exact: true,
  });
  await destination.fill("javascript:alert(1)");
  await dialog
    .getByRole("button", { name: "Insert link", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "supported destination",
  );
  await expect(destination).toHaveValue("javascript:alert(1)");
  await destination.fill(href);
  await dialog
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("Linked source");
  await dialog
    .getByRole("checkbox", { name: "Follow the linked title" })
    .check();
  await dialog
    .getByRole("button", { name: "Insert link", exact: true })
    .click();
  await expect(editor).toContainText(
    `[Linked source](<${href}> "grove:title:v1")`,
  );
});

test("a source refresh while Link is open preserves inputs but refuses stale selection offsets", async ({
  page,
}) => {
  await page.clock.install();
  const state = await fixture(page, [{ ...note, content: source }, handoff]);
  await page.goto(`${base}/app/memories/${note.id}?mode=edit`);
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.focus();
  await editor.press("Control+End");
  await editor.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Insert link", exact: true });
  await dialog
    .getByRole("textbox", { name: "Destination", exact: true })
    .fill(href);
  await dialog
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("Preserve this input");
  const current = state.records.get(note.id)!;
  current.content = "# Link work\n\nUpdated by another writer.";
  current.version++;
  await page.clock.fastForward(60_000);
  await page.clock.runFor(32);
  await expectSource(editor, current.content);
  await dialog
    .getByRole("button", { name: "Insert link", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("The note changed");
  await expect(
    dialog.getByRole("textbox", { name: "Label", exact: true }),
  ).toHaveValue("Preserve this input");
  await expectSource(editor, current.content);
});
