import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const token = `gsh_${"C".repeat(43)}`;
const root = `/s/${token}`;
const one = "00000000-0000-4000-a000-000000000011";
const two = "00000000-0000-4000-a000-000000000012";
const fixture = `http://127.0.0.1:${process.env.SHARING_TEST_PORT || 4378}`;

test("cold nested note supports intent preload, live validation and history without a document request", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${root}/notes/${one}`);
  await expect(
    page.getByRole("heading", { name: "A shared idea", exact: true }),
  ).toBeVisible();
  const documentRequests: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentRequests.push(request.url());
  });
  const link = page.locator(".shared-next-note");
  const warmed = page.waitForResponse(
    (response) => response.url().endsWith("/read") && response.status() === 200,
  );
  await link.hover();
  const warm = await (await warmed).json();
  expect(warm.state.data.note.id).toBe(two);
  const activated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/read") &&
      response.request().postDataJSON().validator,
  );
  await link.click();
  const activation = await (await activated).json();
  expect(activation.unchanged).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(activation))).toBeLessThan(
    Buffer.byteLength(JSON.stringify(warm)),
  );
  await test.info().attach("preload-transfer", {
    contentType: "application/json",
    body: JSON.stringify({
      preloadedBytes: Buffer.byteLength(JSON.stringify(warm)),
      activationBytes: Buffer.byteLength(JSON.stringify(activation)),
    }),
  });
  await expect(page.locator("article h1")).toHaveText("Another shared note");
  await page.goBack();
  await expect(page.locator("article h1")).toHaveText("A shared idea");
  expect(documentRequests).toEqual([]);
});

test("search and section shortcuts use the workspace bindings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${root}/notes/${one}`);
  const dialog = page.getByRole("dialog", { name: "Find a note" });
  // Confirm the enhanced reader is interactive before testing a document-level
  // shortcut, which cannot be replayed when pressed before hydration.
  await page.getByRole("button", { name: "Find a note", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill("Another");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  expect(
    (await new AxeBuilder({ page }).include("dialog[open]").analyze())
      .violations,
  ).toEqual([]);
  if (process.env.CAPTURE_READER)
    await page.screenshot({
      path: "../../documentation/design/screenshots/shared-readers/navigation-search-390.png",
    });
  await page.keyboard.press("Enter");
  await expect(page.locator("article h1")).toHaveText("Another shared note");
  await page.goBack();
  await expect(page.locator("article h1")).toHaveText("A shared idea");
  await page.keyboard.press("Control+Alt+o");
  await expect(
    page.getByRole("textbox", { name: "Find a heading" }),
  ).toBeFocused();
  await page.getByRole("link", { name: /Next steps/ }).click();
  await expect(page).toHaveURL(/#section-next-steps$/);
  await expect(page.getByRole("heading", { name: "Next steps" })).toBeFocused();
});

test("reader layout fits phones and supports no-JavaScript section navigation", async ({
  browser,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${root}/notes/${one}`);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const audit = await new AxeBuilder({ page }).analyze();
  expect(audit.violations).toEqual([]);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const plain = await context.newPage();
  await plain.goto(`${root}/notes/${one}`);
  await plain.locator(".shared-outline summary").click();
  await plain.getByRole("link", { name: /Next steps/ }).click();
  await expect(plain).toHaveURL(/#section-next-steps$/);
  await context.close();
});

test("reader states fit desktop, tablet and narrow phone widths", async ({
  page,
}) => {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${root}/notes/${one}`);
    await expect(page.locator("article h1")).toHaveText("A shared idea");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (process.env.CAPTURE_READER)
      await page.screenshot({
        path: `../../documentation/design/screenshots/shared-readers/navigation-note-${width}.png`,
        fullPage: true,
      });
    if (process.env.CAPTURE_READER && [1440, 390].includes(width)) {
      await page.goto(root);
      await expect(page.locator("article h1")).toHaveText("Ideas for autumn");
      await page.screenshot({
        path: `../../documentation/design/screenshots/shared-readers/navigation-notebook-${width}.png`,
        fullPage: true,
      });
    }
  }
});

test("slow navigation keeps the shell stable and an obsolete response cannot replace the selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${root}/notes/${one}`);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/read", async (route) => {
    if (route.request().postDataJSON().id === two) await gate;
    await route.continue();
  });
  const before = await page.locator(".shared-navigation").boundingBox();
  try {
    await page.locator(".shared-next-note").dispatchEvent("click");
    await expect(page.locator(".shared-skeleton")).toBeVisible();
    if (process.env.CAPTURE_READER)
      await page.screenshot({
        path: "../../documentation/design/screenshots/shared-readers/navigation-loading-1440.png",
      });
    const during = await page.locator(".shared-navigation").boundingBox();
    expect(Math.abs(during!.x - before!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(during!.y - before!.y)).toBeLessThanOrEqual(1);
    await page.locator(".shared-root").dispatchEvent("click");
    await expect(page.locator("article h1")).toHaveText("Ideas for autumn");
  } finally {
    release();
  }
  await expect(page.locator("article h1")).toHaveText("Ideas for autumn");
});

test("missing section keeps the note readable and arrow shortcuts respect text fields", async ({
  page,
}) => {
  await page.goto(`${root}/notes/${one}#section-renamed`);
  await expect(
    page.getByText("Section not found", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".memory-markdown")).toBeVisible();
  await page.keyboard.press("Control+Alt+o");
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(new RegExp(`/notes/${one}#section-renamed$`));
  await page.locator("article h1").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("article h1")).toHaveText("Another shared note");
});

test("a revoked candidate cannot paint after hover", async ({
  page,
  request,
}) => {
  // Own token avoids racing the other shared-reader cases.
  const share = `gsh_${"D".repeat(43)}`;
  try {
    await page.goto(`/s/${share}/notes/${one}`);
    const warmed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/read") && response.status() === 200,
    );
    await page.locator(".shared-next-note").hover();
    await warmed;
    await request.post(`${fixture}/_fixture/${share}`, {
      data: { revoked: true },
    });
    await page.locator(".shared-next-note").click();
    await expect(
      page.getByRole("heading", { name: "This link is unavailable" }),
    ).toBeVisible();
    await expect(page.getByText("One more useful thought.")).toHaveCount(0);
  } finally {
    await request.post(`${fixture}/_fixture/${share}`, { data: {} });
  }
});

test("sidebar paging keeps the article and retained pages through a sibling switch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${root}/notes/${one}`);
  const nav = page.getByRole("navigation", { name: "Notebook contents" });
  await nav.getByRole("link", { name: "More notes" }).click();
  await expect(page.locator("article h1")).toHaveText("A shared idea");
  await expect(
    nav.getByRole("link", { name: "Another shared note", exact: true }),
  ).toBeVisible();
  await nav
    .getByRole("link", { name: "Another shared note", exact: true })
    .click();
  await expect(page.locator("article h1")).toHaveText("Another shared note");
  await expect(
    nav.getByRole("link", { name: "Another shared note", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    nav.getByRole("link", { name: "A shared idea", exact: true }),
  ).toBeVisible();
});

for (const width of [1440, 390])
  test(`blocked section copying focuses and selects the manual link at ${width}px`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new Error("blocked")) },
        configurable: true,
      }),
    );
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${root}/notes/${one}`);
    await page
      .locator(width === 1440 ? ".shared-outline" : ".memory-markdown")
      .getByRole("button", { name: "Copy link to Decisions", exact: true })
      .click();
    const field = page.getByRole("textbox", {
      name: "Section link",
      exact: true,
    });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(
      new RegExp(`/notes/${one}#section-decisions$`),
    );
    expect(
      await field.evaluate(
        (element: HTMLInputElement) =>
          element.selectionEnd! - element.selectionStart!,
      ),
    ).toBe((await field.inputValue()).length);
  });
