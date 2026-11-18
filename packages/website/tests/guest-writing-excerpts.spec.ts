import { expect, test } from "./telemetry-fixtures";

test('a warm guest worker stays manual and checks offline without sending prose', async ({page, context}) => {
  const transfers: string[] = [];
  context.on('request', request => {
    if (/\/api\/grove\/proofing\//.test(request.url()) || (request.postData() ?? '').includes('Guest marker')) transfers.push(request.url());
  });
  await page.goto('/writing');
  const input = page.getByRole('textbox', {name:'English text'});
  const submit = page.getByRole('button',{name:'Check writing'});
  await input.fill('The notebook is ready.');
  expect(page.workers()).toHaveLength(0); await submit.click();
  await expect(page.getByText('No issues found.',{exact:true})).toBeVisible();
  await context.setOffline(true);
  try {
    await input.fill('Guest marker: the the notebok.');
    await expect(page.getByRole('list',{name:'Writing suggestions'})).toHaveCount(0);
    await submit.click();
    await expect(page.getByRole('list',{name:'Writing suggestions'})).toContainText('notebok');
    await expect(page.getByRole('list',{name:'Writing suggestions'})).toContainText('appears twice');
    expect(transfers).toEqual([]);
  } finally { await context.setOffline(false); }
});

test("checks just the misspelled component of a technical note", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/writing");
  await page.getByRole("textbox", { name: "English text" }).fill("Watchlist: the serializer writes to a read-onyl datastore.");
  await page.getByRole("button", { name: "Check writing" }).click();
  await expect(page.getByRole("list", { name: "Writing suggestions" }).getByRole("listitem")).toHaveText([/“onyl”\s+Possible spelling mistake\./]);
  await page.locator(".guest-writing-form").screenshot({ path: info.outputPath("compound-web.png") });
});

test("Watchlist is accepted while a nearby typo is still identified", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/writing");
  const input = page.getByRole("textbox", { name: "English text" });
  await input.fill("Watchlist\nAdd this film to the watchlist. Share both watchlists with teh team.");
  await page.getByRole("button", { name: "Check writing" }).click();
  const issues = page.getByRole("list", { name: "Writing suggestions" });
  await expect(issues.getByRole("listitem")).toHaveText([/“teh”\s+Possible spelling mistake\./]);
  await page.locator(".guest-writing-form").screenshot({ path: info.outputPath("watchlist-check.png") });
});

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
      /“the the”\s+This word appears twice\./,
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
