import { expect, type Locator } from "@playwright/test";

export async function chooseOption(control: Locator, value: string) {
  await control.click();
  await control
    .page()
    .getByRole("listbox")
    .locator(`[role="option"][data-value=${JSON.stringify(value)}]`)
    .click();
  await expect(control).toHaveAttribute("aria-expanded", "false");
  await expect(control).toBeFocused();
}
