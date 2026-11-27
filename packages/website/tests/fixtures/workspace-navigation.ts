import { expect, type Page } from "@playwright/test";

/** Follow the visible compact-navigation path; desktop links remain direct. */
export async function openWorkspaceNavigation(page: Page) {
  const trigger = page.getByRole("button", { name: /^Grove navigation:/ });
  if (await page.evaluate(() => matchMedia("(max-width: 1023px)").matches)) {
    await expect(trigger).toBeVisible();
    const navigation = page.getByRole("dialog", {
      name: "Grove navigation",
      exact: true,
    });
    if (!(await navigation.isVisible())) await trigger.click();
    await expect(navigation).toBeVisible();
  }
}

export async function clickWorkspaceLink(page: Page, name: string) {
  const link = page.getByRole("link", { name, exact: true });
  if (!(await link.isVisible())) await openWorkspaceNavigation(page);
  await link.click();
}
