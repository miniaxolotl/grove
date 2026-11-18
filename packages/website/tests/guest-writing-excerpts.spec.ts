import { expect, test } from "./telemetry-fixtures";

for (const width of [320, 390, 1440]) {
  test(`guest suggestion excerpts support keyboard review at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width,
      height: width === 320 ? 750 : width === 390 ? 844 : 900,
    });
    await page.goto("/writing");
    const input = page.getByRole("textbox", { name: "English text" });
    await input.fill("Please bring the the notebok.");
    await input.press("Tab");
    const submit = page.getByRole("button", { name: "Check writing" });
    await expect(submit).toBeFocused();
    await page.keyboard.press("Enter");
    const issues = page
      .getByRole("list", { name: "Writing suggestions" })
      .getByRole("listitem");
    await expect(issues).toHaveText([
      /“the”\s+This word appears twice\./,
      /“notebok”\s+Possible spelling mistake\./,
    ]);
    await expect(submit).toBeFocused();
    await page.screenshot({ path: info.outputPath(`excerpts-${width}.png`) });
    await page.keyboard.press("Shift+Tab");
    await expect(input).toBeFocused();
    const long = "w".repeat(46);
    await input.fill(`Hello,world. Read  &<note> and ${long}.`);
    await expect(issues).toHaveCount(0);
    await submit.click();
    await expect(
      issues.filter({ hasText: "Missing space before “world”" }),
    ).toContainText("Check spacing");
    await expect(
      issues.filter({ hasText: "2 spaces before “&<note>”" }),
    ).toContainText("Check spacing");
    await expect(issues.locator("note")).toHaveCount(0);
    const longIssue = issues.filter({ hasText: /w+…/ });
    await expect(longIssue).toContainText("Possible spelling mistake.");
    await expect(longIssue).not.toContainText(long);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
