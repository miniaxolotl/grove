import { createHash } from "node:crypto";
import { expect, test } from "./telemetry-fixtures";

test("approved kit assets are served intact with theme-aware favicon fallbacks", async ({
  page,
  request,
}) => {
  await page.goto("/");
  for (const theme of ["light", "dark"]) {
    await expect(
      page.locator(
        `link[rel="icon"][media="(prefers-color-scheme: ${theme})"]`,
      ),
    ).toHaveCount(2);
  }
  const response = await request.get("/marketing-kit.json");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.brand).toBe("grove");
  expect(manifest.websiteGraphicsAllowed).toBe(true);
  for (const asset of manifest.assets) {
    const url = asset.file.startsWith("public/")
      ? asset.file.slice("public/".length)
      : asset.file.split("/").at(-1);
    const file = await request.get(`/${url}`);
    expect(file.ok(), url).toBe(true);
    expect(
      createHash("sha256")
        .update(await file.body())
        .digest("hex"),
      url,
    ).toBe(asset.sha256);
  }
  const icon = await request.get("/icon.svg");
  expect(await icon.text()).toContain("prefers-color-scheme");
  const social = await request.get("/opengraph-image");
  expect(social.ok()).toBe(true);
  expect(
    createHash("sha256")
      .update(await social.body())
      .digest("hex"),
  ).toBe(
    manifest.assets.find(
      (asset: { role: string }) => asset.role === "social link preview",
    ).sha256,
  );
  const image = page.locator(".feature-photo img");
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBeGreaterThan(0);
});
