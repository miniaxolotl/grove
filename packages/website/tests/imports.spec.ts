import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fixturePath, catalogResponse } from "./fixtures/notebook-catalog";
import type {
  ImportBatch,
  ImportDestination,
} from "@lib/shared/document-imports";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const notebook = "88e5a309-73d4-4e34-a979-aec791c0f6d2";
const noteIds = [
  "b8232e9e-5400-4c5b-941c-e3cb79967935",
  "9dcb5b64-1600-4c44-a301-f20e7b363c8f",
];

for (const width of [1440, 390, 320])
  test(`review uploaded notes into new and existing notebooks at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let batch: ImportBatch | undefined;
    let confirmations = 0;
    await page.route("**/api/grove/**", async (route) => {
      const request = route.request(),
        path = fixturePath(request.url()).replace("/api/grove", "");
      let data: unknown = [];
      if (path === "/projects")
        data = [
          {
            id: notebook,
            name: "Research",
            identity: "research",
            parentId: null,
            version: 1,
            status: "active",
          },
        ];
      else if (path === "/memories/search")
        data = { items: [], nextCursor: null };
      else if (path === "/me")
        data = { accountId: "import-fixture", mediaAvailable: true };
      else if (path === "/import-batches" && request.method() === "POST") {
        batch = {
          id: request.postDataJSON().id,
          version: 1,
          status: "uploading",
          taskId: null,
          expiresAt: "2030-01-01T00:00:00Z",
          files: [],
          notes: [],
          next: null,
          total: 0,
          imported: 0,
          selected: 0,
          newNotebooks: 0,
        };
        data = { id: batch.id };
      } else if (path === "/import-batches")
        data = batch
          ? [
              {
                id: batch.id,
                status: batch.status,
                createdAt: "2026-10-25T12:00:00Z",
              },
            ]
          : [];
      else if (path.includes("/files/") && request.method() === "PUT") {
        expect(request.headers()["x-grove-content-sha256"]).toMatch(
          /^[a-f0-9]{64}$/,
        );
        const filename = decodeURIComponent(
          request.headers()["x-grove-filename"],
        );
        const id = path.split("/").at(-1)!;
        batch!.files.push({
          id,
          filename,
          bytes: 100,
          status: "pending",
          error: null,
          pages: null,
          emptyPages: [],
          originalReady: false,
        });
        batch!.version++;
        data = { id };
      } else if (path.endsWith("/prepare")) {
        batch!.status = "ready";
        batch!.taskId = request.postDataJSON().id;
        batch!.version++;
        batch!.notes = batch!.files.map((file, i) => ({
          id: noteIds[i],
          fileId: file.id,
          ordinal: 0,
          content: i
            ? "# Plant research\n\nSeedlings need steady moisture and indirect light."
            : "# Garden journal\n\nWater seedlings in the morning.",
          included: true,
          destination: null,
          suggestion: null,
          pageStart: 1,
          pageEnd: 1,
          memoryId: null,
        }));
        batch!.total = batch!.notes.length;
        batch!.files.forEach((file) => {
          file.status = "ready";
          file.pages = 1;
        });
        data = { taskId: batch!.taskId };
      } else if (path.startsWith("/tasks/"))
        data = {
          id: batch!.taskId,
          kind: "document_prepare",
          status: "succeeded",
          processed: 2,
          total: 2,
        };
      else if (path.endsWith("/placement")) {
        const input = request.postDataJSON();
        expect(input.expectedVersion).toBe(batch!.version);
        batch!.notes.forEach(
          (note) => (note.destination = input.destination as ImportDestination),
        );
        batch!.version++;
        data = { version: batch!.version };
      } else if (path.includes("/notes/") && request.method() === "PATCH") {
        const input = request.postDataJSON();
        expect(input.expectedVersion).toBe(batch!.version);
        const note = batch!.notes.find(
          (note) => note.id === path.split("/").at(-1),
        )!;
        for (const field of ["content", "destination", "included"] as const)
          if (field in input) Object.assign(note, { [field]: input[field] });
        batch!.version++;
        data = { version: batch!.version };
      } else if (path.endsWith("/confirm")) {
        expect(request.postDataJSON().expectedVersion).toBe(batch!.version);
        confirmations++;
        batch!.status = "complete";
        batch!.version++;
        batch!.imported = batch!.notes.length;
        batch!.notes.forEach((note, i) => (note.memoryId = noteIds[i]));
        data = { taskId: request.postDataJSON().id };
      } else if (path.startsWith("/import-batches/")) data = batch;
      if (batch) {
        batch.selected = batch.notes.filter((note) => note.included).length;
        batch.newNotebooks = new Set(
          batch.notes
            .filter(
              (note) =>
                note.included && note.destination && "name" in note.destination,
            )
            .map((note) => JSON.stringify(note.destination)),
        ).size;
      }
      await route.fulfill({
        json: { success: true, data: catalogResponse(request.url(), data) },
      });
    });
    await page.goto(`${base}/app`);
    await page
      .getByRole("button", { name: "Import notes", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Import notes",
      exact: true,
    });
    await dialog.getByLabel("Upload notes and PDFs").setInputFiles([
      {
        name: "Garden.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(
          "# Garden journal\n\nWater seedlings in the morning.",
        ),
      },
      {
        name: "Botany.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 synthetic fixture"),
      },
    ]);
    await expect(
      dialog.getByRole("heading", { name: "2 proposed notes" }),
    ).toBeVisible();
    const placement = dialog.locator(".import-placement");
    await placement.getByRole("combobox").first().click();
    await page
      .getByRole("option", { name: "New notebook…", exact: true })
      .click();
    await placement.getByLabel("New notebook name").fill("Gardening");
    await placement.getByRole("button", { name: "Use for all notes" }).click();
    const first = dialog.locator(".import-draft").first(),
      second = dialog.locator(".import-draft").nth(1);
    await first
      .getByText("Review note and destination", { exact: true })
      .click();
    await first
      .getByRole("textbox", { name: "Content from Garden.md" })
      .fill(
        "# Garden journal\n\nWater seedlings in the morning. Check the soil first.",
      );
    await expect(
      dialog.getByRole("button", { name: "Confirm import", exact: true }),
    ).toBeDisabled();
    await first.getByRole("button", { name: "Save reviewed note" }).click();
    await second
      .getByText("Review note and destination", { exact: true })
      .click();
    await second.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Research", exact: true }).click();
    await second.getByRole("button", { name: "Save reviewed note" }).click();
    await expect(
      second.getByRole("button", { name: "Save reviewed note" }),
    ).toBeDisabled();
    const accessibility = await new AxeBuilder({ page })
      .include("dialog")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    if (
      testInfo.project.name.includes("chromium") ||
      testInfo.project.name === ""
    ) {
      const directory = resolve(
        "../../documentation/design/screenshots/note-imports",
      );
      await mkdir(directory, { recursive: true });
      await dialog.evaluate((element) => (element.scrollTop = 0));
      await page.screenshot({
        path: resolve(directory, `review-${width}.png`),
      });
    }
    await dialog
      .getByLabel("I’ve reviewed the notes, destinations and sharing.")
      .check();
    await dialog
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Import complete", exact: true }),
    ).toBeVisible();
    expect(confirmations).toBe(1);
    expect(batch!.notes[0].destination).toEqual({
      name: "Gardening",
      parentId: null,
    });
    expect(batch!.notes[1].destination).toEqual({
      projectId: notebook,
      version: 1,
    });
    expect(errors).toEqual([]);
  });
