import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixturePath, catalogResponse } from "./fixtures/notebook-catalog";
import { note as savedNote } from "./fixtures/workspace-fixture";
import type {
  ImportBatch,
  ImportDestination,
} from "@lib/shared/document-imports";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const notebook = "88e5a309-73d4-4e34-a979-aec791c0f6d2";
const gardening = "5b7a7fce-6ad2-4106-8e73-be87065d8b5d";
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
          {
            id: "233609fd-8dc4-43ca-a611-4e913248a357",
            name: "Botany",
            parentId: notebook,
          },
          ...(batch?.imported ? [{ id: gardening, name: "Gardening" }] : []),
        ];
      else if (path === "/memories/search")
        data = {
          items:
            batch?.notes
              .filter((n) => n.memoryId)
              .map((n) => ({
                ...savedNote,
                id: n.memoryId,
                content: n.content,
                enrichment: null,
                projectId:
                  n.destination && "projectId" in n.destination
                    ? n.destination.projectId
                    : gardening,
              })) ?? [],
          nextCursor: null,
        };
      else if (path === "/me")
        data = { accountId: "import-fixture", mediaAvailable: true };
      else if (path === "/import-batches" && request.method() === "POST") {
        batch = {
          id: request.postDataJSON().id,
          initialDestination: request.postDataJSON().destination,
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
          destination: batch!.initialDestination,
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
    const more = page.getByRole("button", { name: "More note actions" });
    const importNotes = page.getByRole("button", {
      name: "Import notes",
      exact: true,
    });
    await expect(importNotes).toBeHidden();
    await more.press("ArrowUp");
    await expect(importNotes).toBeFocused();
    await importNotes.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Import notes",
      exact: true,
    });
    const choose = dialog.getByRole("button", { name: "Choose files" });
    // Unfiled is preselected outside a notebook, so upload is ready at once.
    await expect(choose).toBeEnabled();
    await expect(
      dialog.getByRole("combobox", { name: "Destination notebook" }),
    ).toHaveText("Unfiled");
    await dialog
      .getByRole("combobox", { name: "Destination notebook" })
      .click();
    if (width === 1440)
      await page.screenshot({ path: testInfo.outputPath("import.png") });
    const initialOption =
      width === 1440
        ? "Research / Botany"
        : width === 390
          ? "New notebook…"
          : "Unfiled";
    await page
      .getByRole("option", { name: initialOption, exact: true })
      .click();
    if (width === 390) {
      await dialog.getByLabel("New notebook name").fill(" ");
      await expect(choose).toBeDisabled();
      await dialog.getByLabel("New notebook name").fill("Field notes");
      await dialog.getByRole("combobox", { name: "Parent notebook" }).click();
      await page.getByRole("option", { name: "Research", exact: true }).click();
    }
    await expect(choose).toBeEnabled();
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
    await expect(
      dialog.getByText(
        "Shared notebooks, including parents, can show imported notes right away. Originals stay private.",
      ),
    ).toBeVisible();
    const placement = dialog.locator(".import-placement");
    await expect(
      dialog.locator(".import-draft > p").filter({
        hasText:
          width === 1440
            ? /^Notebook: Research \/ Botany$/
            : width === 390
              ? /^New notebook: Research \/ Field notes$/
              : /^Unfiled$/,
      }),
    ).toHaveCount(2);
    await dialog
      .getByLabel("I’ve reviewed the notes, destinations and sharing.")
      .check();
    await placement.getByRole("combobox").first().click();
    await page
      .getByRole("option", { name: "New notebook…", exact: true })
      .click();
    await placement.getByLabel("New notebook name").fill("Gardening");
    await expect(
      dialog.getByRole("button", { name: "Confirm import" }),
    ).toBeDisabled();
    await expect(
      dialog.getByLabel("I’ve reviewed the notes, destinations and sharing."),
    ).not.toBeChecked();
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
    const storageLink = dialog.getByRole("link", {
      name: "View files & storage",
    });
    const cancelImport = dialog.getByRole("button", { name: "Cancel import" });
    await expect(storageLink).toHaveCount(0);
    await expect(cancelImport).toBeDisabled();
    const editor = first.getByRole("textbox", {
      name: "Content from Garden.md",
    });
    await first.locator("summary").click();
    const consent = dialog.getByLabel(
      "I’ve reviewed the notes, destinations and sharing.",
    );
    await consent.focus();
    await page.keyboard.press("Tab");
    const recover = dialog
      .locator(".import-confirm")
      .getByRole("button", { name: "Return to edit" });
    await expect(recover).toBeFocused();
    if (width === 390) {
      await cancelImport.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath("unsaved-review-390.png"),
      });
    }
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.keyboard.press("Enter");
    await expect(editor).toBeFocused();
    await expect(editor).toBeInViewport();
    await expect(editor).toHaveValue(/Check the soil first\./);
    await expect(
      dialog.getByRole("button", { name: "Confirm import", exact: true }),
    ).toBeDisabled();
    await first.getByRole("button", { name: "Save reviewed note" }).click();
    await expect(storageLink).toHaveAttribute("href", "/app/settings/files");
    await expect(cancelImport).toBeEnabled();
    await second
      .getByText("Review note and destination", { exact: true })
      .click();
    await second.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Research", exact: true }).click();
    const topRecovery = dialog
      .locator(".import-intro")
      .getByRole("button", { name: "Return to edit" });
    await topRecovery.focus();
    // Exercise recovery from the top of the review, regardless of how far
    // the browser happened to scroll when restoring the notebook trigger.
    await topRecovery.evaluate((button) =>
      button.scrollIntoView({ block: "start" }),
    );
    const secondEditor = second.getByRole("textbox", {
      name: "Content from Botany.pdf",
    });
    await expect(secondEditor).not.toBeInViewport();
    await page.keyboard.press("Space");
    await expect(secondEditor).toBeFocused();
    await expect(secondEditor).toBeInViewport();
    await expect(second.getByRole("combobox").first()).toContainText(
      "Research",
    );
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
      await dialog.evaluate((element) => (element.scrollTop = 0));
      await page.screenshot({
        path: testInfo.outputPath(`review-${width}.png`),
      });
    }
    await dialog
      .getByLabel("I’ve reviewed the notes, destinations and sharing.")
      .check();
    if (width === 390) {
      batch!.version++;
      batch!.notes[0].content += "\n\nNew from another tab.";
      await page.evaluate(() =>
        window.dispatchEvent(new Event("visibilitychange")),
      );
      await expect(
        dialog.getByRole("textbox", { name: "Content from Garden.md" }),
      ).toHaveValue(/New from another tab\./);
      await expect(
        dialog.getByRole("button", { name: "Confirm import" }),
      ).toBeDisabled();
      await dialog
        .getByLabel("I’ve reviewed the notes, destinations and sharing.")
        .check();
    }
    if (width === 390) {
      await dialog
        .getByRole("button", { name: "Confirm import", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath("import-confirm-390.png"),
      });
    }
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
    await page.keyboard.press("Escape");
    if (width !== 1440)
      await page
        .getByRole("button", { name: "Notebooks", exact: true })
        .click();
    await expect(
      page
        .locator(".notebook-explorer")
        .getByRole("link", { name: "Gardening", exact: true }),
    ).toBeVisible();
    if (width === 1440)
      await page.screenshot({
        path: testInfo.outputPath("imported-notebook.png"),
      });
  });

for (const recovery of [
  "choose Unfiled while loading",
  "retry notebooks",
  "choose Unfiled after failure",
] as const)
  test(`notebook-scoped import: ${recovery}`, async ({ page }) => {
    const gate = Promise.withResolvers<void>();
    let offline = recovery !== "choose Unfiled while loading";
    const destinations: ImportDestination[] = [];
    await page.route("**/api/grove/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      let data: unknown = [];
      if (path.endsWith("/projects/catalog")) {
        await gate.promise;
        if (offline)
          return route.fulfill({
            status: 503,
            json: { success: false, error: { message: "Unavailable" } },
          });
        data = catalogResponse(request.url(), [
          { id: notebook, name: "Research", version: 7 },
        ]);
      } else if (path.endsWith("/me")) data = { accountId: "scoped-import" };
      else if (path.endsWith("/memories/search"))
        data = { items: [], nextCursor: null };
      else if (
        path.endsWith("/import-batches") &&
        request.method() === "POST"
      ) {
        destinations.push(request.postDataJSON().destination);
        // The contract under test ends at batch creation.
        return route.abort();
      }
      return route.fulfill({ json: { success: true, data } });
    });
    await page.goto(`${base}/app?notebook=${notebook}`);
    await page.getByRole("button", { name: "More note actions" }).click();
    await page
      .getByRole("button", { name: "Import notes", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Import notes",
      exact: true,
    });
    const picker = dialog.getByRole("combobox", {
      name: "Destination notebook",
    });
    const choose = dialog.getByRole("button", { name: "Choose files" });
    const input = dialog.getByLabel("Upload notes and PDFs");
    await expect(choose).toBeDisabled();
    await expect(input).toBeDisabled();
    await expect(picker).toHaveText("Choose a destination…");
    await dialog.getByText("Drop files here").evaluate((target) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(["Hello"], "hello.txt"));
      target.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer }),
      );
    });
    if (offline) {
      gate.resolve();
      const retry = dialog.getByRole("button", { name: "Retry notebooks" });
      await expect(retry).toBeVisible({ timeout: 15_000 });
      await expect(choose).toBeDisabled();
      if (recovery === "retry notebooks") {
        offline = false;
        await retry.click();
        await expect(picker).toHaveText("Research");
      }
    }
    if (recovery !== "retry notebooks") {
      await picker.click();
      await page.getByRole("option", { name: "Unfiled" }).click();
      await expect(choose).toBeEnabled();
      if (!offline) {
        gate.resolve();
        await picker.click();
        await expect(
          page.getByRole("option", { name: "Research" }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
      }
      await expect(picker).toHaveText("Unfiled");
    }
    expect(destinations).toEqual([]);
    await input.setInputFiles({
      name: "hello.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Hello"),
    });
    await expect
      .poll(() => destinations)
      .toEqual([
        recovery === "retry notebooks"
          ? { projectId: notebook, version: 7 }
          : null,
      ]);
  });

test("import status follows a queued, running and failed job and retries the same task", async ({
  page,
}) => {
  const id = "d2607aba-8ba3-4ca0-b098-7efe371957ff";
  const taskId = "5ead695b-daa4-4cf1-881c-1ea3fff27460";
  let task = {
    status: "pending",
    processed: 0,
    total: null as number | null,
    error: null as string | null,
  };
  let imported = 0;
  let retries = 0;
  await page.route("**/api/grove/**", async (route) => {
    const path = fixturePath(route.request().url()).replace("/api/grove", "");
    let data: unknown = [];
    if (path === "/me") data = { accountId: "import-progress" };
    if (path === "/import-batches")
      data = [{ id, status: "applying", createdAt: "2026-10-25T12:00:00Z" }];
    if (path === `/import-batches/${id}`)
      data = { id, taskId, status: "applying", imported, files: [], notes: [] };
    if (path === `/tasks/${taskId}`) data = { id: taskId, ...task };
    if (path === `/tasks/${taskId}/retry`) {
      retries++;
      task = { ...task, status: "pending", error: null };
    }
    await route.fulfill({
      json: {
        success: true,
        data: catalogResponse(route.request().url(), data),
      },
    });
  });
  await page.goto(`${base}/app/settings/data`);
  await page.getByRole("button", { name: "Import notes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import notes" });
  await dialog.getByRole("button", { name: /Resume import/ }).click();
  const queued = dialog
    .getByRole("status")
    .filter({ hasText: /^Import queued$/ });
  await expect(queued).toBeVisible();
  await expect(dialog.getByText(/0 \/ 0/)).toBeHidden();
  imported = 1;
  task = { status: "running", processed: 1, total: 2, error: null };
  await expect(dialog.getByRole("status")).toContainText(
    "1 of 2 notes imported",
  );
  task = { ...task, status: "failed", error: "internal_task_code" };
  await expect(dialog.getByRole("status")).toContainText(
    "Import stopped. Imported notes are kept.",
  );
  await expect(dialog.getByText("internal_task_code")).toBeHidden();
  await dialog
    .getByRole("button", { name: "Retry import", exact: true })
    .click();
  await expect(queued).toBeVisible();
  expect(retries).toBe(1);
});

test("retrying recent imports only reads the list and restores focus", async ({
  page,
}) => {
  let offline = true;
  const reads: string[] = [];
  await page.route("**/api/grove/**", async (route) => {
    const url = route.request().url();
    const path = fixturePath(url).replace("/api/grove", "");
    if (path.startsWith("/import-batches")) reads.push(path);
    if (path === "/import-batches" && offline)
      return route.fulfill({
        status: 503,
        json: {
          success: false,
          error: { code: "unavailable", message: "Please retry." },
        },
      });
    return route.fulfill({
      json: {
        success: true,
        data: catalogResponse(
          url,
          path === "/me" ? { accountId: "import-list-recovery" } : [],
        ),
      },
    });
  });
  await page.goto(`${base}/app/settings/data`);
  await page.getByRole("button", { name: "Import notes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import notes" });
  const retry = dialog.getByRole("button", { name: "Reload import" });
  await expect(retry).toBeVisible({ timeout: 15_000 });
  const failedReads = reads.length;
  offline = false;
  await retry.press("Enter");
  await expect(retry).toBeHidden();
  expect(reads.slice(failedReads)).toEqual(["/import-batches"]);
  await expect(
    dialog.getByRole("button", { name: "Choose files" }),
  ).toBeFocused();
});
