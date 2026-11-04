import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390, 320]) {
  test(`public examples keep their footprint at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const accountRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/grove/"))
        accountRequests.push(request.url());
    });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".sample-graph .react-flow__node")).toHaveCount(
      8,
    );
    for (const [buttons, shell] of [
      [".notebook-sample-choices button", ".notebook-preview"],
      ['[id^="library-preview-tab-"]', ".library-window"],
      ['[id^="memory-example-tab-"]', ".demo-shell"],
      [".demo-panel:not([inert]) .comparison-button", ".demo-shell"],
    ]) {
      const frame = page.locator(shell);
      const height = await frame.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      for (const button of await page.locator(buttons).all()) {
        await button.click();
        await expect
          .poll(async () =>
            Math.abs(
              (await frame.evaluate(
                (element) => element.getBoundingClientRect().height,
              )) - height,
            ),
          )
          .toBeLessThan(1);
      }
    }
    await page.getByRole("tab", { name: "Graph", exact: true }).click();
    const graph = page.getByRole("region", {
      name: "Sample linked notes graph",
    });
    const height = await page
      .locator(".library-window")
      .evaluate((element) => element.getBoundingClientRect().height);
    await graph
      .getByRole("button", { name: "Fresh herbs for dinner", exact: true })
      .click();
    await expect(graph.locator(".sample-note-page:not([inert])")).toContainText(
      "Use the first mint leaves",
    );
    expect(
      Math.abs(
        (await page
          .locator(".library-window")
          .evaluate((element) => element.getBoundingClientRect().height)) -
          height,
      ),
    ).toBeLessThan(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page })
      .include(".sample-graph")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      accessibility.violations.map(({ id, nodes }) => ({
        id,
        nodes: nodes.map((node) => ({
          target: node.target,
          failure: node.failureSummary,
        })),
      })),
    ).toEqual([]);
    expect(accountRequests).toEqual([]);
  });
}
