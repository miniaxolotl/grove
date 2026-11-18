import type { Locator, Page } from "@playwright/test";

/** Open an action from the current note's toolbar menu. */
export async function openNoteAction(
  scope: Page | Locator,
  name:
    | "Export"
    | "Delete note…"
    | "Commands"
    | "Revision history"
    | "Share note",
) {
  // The sidebar disappears when a deferred mobile editor mounts. Choose an
  // action only after that transition, not from the temporary loading layout.
  const toolbar = scope.locator(".note-editor .note-editor-bar");
  await toolbar.waitFor();
  const commands = scope.getByRole("button", { name: "Commands", exact: true });
  if (name === "Commands" && (await commands.isVisible())) {
    await commands.click();
    return;
  }
  await toolbar
    .getByRole("button", { name: "Note actions", exact: true })
    .click();
  await toolbar
    .getByRole("group", { name: "Note actions", exact: true })
    .getByRole("button", {
      name: name === "Export" ? "Export…" : name,
      exact: true,
    })
    .click();
}
