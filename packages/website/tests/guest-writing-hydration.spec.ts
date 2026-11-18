import { expect, test } from "./telemetry-fixtures";

test("checks a guest draft typed before the page becomes interactive", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Let the server-rendered textarea accept native input before React is loaded.
  const scripts = Promise.withResolvers<void>();
  await page.route("**/_next/static/**/*.js", async (route) => {
    await scripts.promise;
    await route.continue();
  });
  const input = page.getByRole("textbox", { name: "English text" });
  const draft = "The notebook is ready.";
  try {
    await page.goto("/writing", { waitUntil: "commit" });
    await input.fill(draft);
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-grove-native-writing",
      "true",
    );
  } finally {
    scripts.resolve();
  }
  await expect(page.locator("html")).toHaveAttribute(
    "data-grove-native-writing",
    "true",
  );
  await expect(input).toHaveValue(draft);
  const check = page.getByRole("button", { name: "Check writing" });
  await expect(check).toBeEnabled();
  await check.click();
  await expect(
    page.getByRole("status").filter({ hasText: "No issues found." }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("guest-writing-hydration.png"),
  });
  await input.fill(" ");
  await expect(check).toBeDisabled();
});
