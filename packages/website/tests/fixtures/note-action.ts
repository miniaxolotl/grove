import type { Locator, Page } from "@playwright/test";

/** Compact readers keep secondary actions in the same menu as note rows. */
export async function openNoteAction(
  scope: Page | Locator,
  name: "Export" | "Delete note…" | "Commands",
) {
  const direct = scope.getByRole("button", { name, exact: true });
  if (await direct.isVisible()) {
    await direct.click();
  } else {
    await scope
      .getByRole("button", { name: "Note actions", exact: true })
      .click();
    await scope
      .getByRole("button", {
        name: name === "Export" ? "Export…" : name,
        exact: true,
      })
      .click();
  }
}
