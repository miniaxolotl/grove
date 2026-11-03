import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Conversation } from "@lib/shared/conversations";
import type { DocumentList } from "@lib/shared/conversation-documents";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;

test("an interrupted upload keeps its identity and blocks Send until retried or discarded", async ({
  page,
}) => {
  const chatId = "00000000-0000-4000-a000-000000000091",
    ids: string[] = [];
  const chat: Conversation = {
    id: chatId,
    title: "New conversation",
    version: 0,
    scope: { includePersonal: false },
    tools: { organize: true, exa: false, tavily: false },
    toolsVersion: 0,
    updatedAt: new Date().toISOString(),
    turns: [],
  };
  const list: DocumentList = { version: 0, documents: [] };
  await page.route("**/api/grove/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace("/api/grove", "");
    let data: unknown = [];
    if (path === "/me") data = { accountId: "retry-document-fixture" };
    else if (path === "/memories/search")
      data = { items: [], nextCursor: null };
    else if (path === "/ask-tools") data = { defaults: chat.tools };
    else if (path === "/conversations" && request.method() === "POST")
      data = chat;
    else if (path.endsWith("/documents")) data = list;
    else if (
      path.match(/\/documents\/[0-9a-f-]+$/) &&
      request.method() === "PUT"
    ) {
      ids.push(path.split("/").at(-1)!);
      if (ids.length === 1) {
        await route.abort("failed");
        return;
      }
      list.documents = [
        {
          id: ids[0],
          filename: "Retry.txt",
          bytes: 4,
          status: "ready",
          error: null,
          pages: 1,
          emptyPages: [],
          accepted: false,
          taskId: chatId,
        },
      ];
      list.version = 1;
      data = { id: ids[0], taskId: chatId };
    } else if (path === `/conversations/${chatId}`) data = chat;
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${base}/app/ask`);
  await page
    .getByRole("textbox", { name: "Ask about your notes" })
    .fill("Explain this file");
  await page
    .getByLabel("Attach notes and documents")
    .setInputFiles({
      name: "Retry.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Text"),
    });
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send question", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("list", { name: "Attached documents" }),
  ).toContainText("Ready");
  await expect(
    page.getByRole("button", { name: "Send question", exact: true }),
  ).toBeEnabled();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});
for (const width of [1440, 390, 320])
  test(`Ask documents stay chat-local, cite passages and open reviewed text at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let chat: Conversation | undefined,
      accepted = 0,
      turns = 0,
      saves = 0;
    const list: DocumentList = { version: 0, documents: [] },
      chunkId = "00000000-0000-4000-a000-000000000021",
      batchId = "00000000-0000-4000-a000-000000000022";
    await page.route("**/api/grove/**", async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname.replace("/api/grove", "");
      let data: unknown = [];
      if (path === "/me")
        data = { accountId: "ask-document-fixture", mediaAvailable: true };
      else if (path === "/ask-tools")
        data = {
          defaults: { organize: true, exa: false, tavily: false },
          organize: true,
          exa: false,
          tavily: false,
        };
      else if (path === "/memories/search")
        data = { items: [], nextCursor: null };
      else if (path === "/conversations" && request.method() === "POST") {
        chat = {
          id: request.postDataJSON().id,
          title: "New conversation",
          version: 0,
          scope: { includePersonal: false },
          tools: { organize: true, exa: false, tavily: false },
          toolsVersion: 0,
          updatedAt: new Date().toISOString(),
          turns: [],
        };
        data = chat;
      } else if (
        path.match(/\/documents\/[0-9a-f-]+$/) &&
        request.method() === "PUT"
      ) {
        expect(request.headers()["x-grove-content-sha256"]).toMatch(
          /^[a-f0-9]{64}$/,
        );
        list.documents.push({
          id: path.split("/").at(-1)!,
          filename: decodeURIComponent(request.headers()["x-grove-filename"]),
          bytes: 40,
          status: "ready",
          accepted: false,
          pages: 1,
          emptyPages: [],
          taskId: chunkId,
          error: null,
        });
        list.version++;
        data = { id: list.documents[0].id, taskId: chunkId };
      } else if (path.endsWith("/documents/accept")) {
        expect(request.postDataJSON().expectedVersion).toBe(list.version);
        accepted++;
        list.documents.forEach((doc) => (doc.accepted = true));
        data = list;
      } else if (path.endsWith("/documents/import")) {
        data = { id: batchId };
      } else if (path === `/import-batches/${batchId}`)
        data = {
          id: batchId,
          status: "ready",
          version: 1,
          taskId: null,
          files: list.documents.map((doc) => ({ ...doc, originalReady: true })),
          notes: [
            {
              id: chunkId,
              fileId: list.documents[0].id,
              ordinal: 0,
              content: "# Oak care\n\nOak roots need damp mulch.",
              included: true,
              destination: null,
              suggestion: null,
              pageStart: 1,
              pageEnd: 1,
              memoryId: null,
            },
          ],
          total: 1,
          imported: 0,
          selected: 1,
          newNotebooks: 0,
          next: null,
        };
      else if (path.endsWith("/documents")) data = list;
      else if (path.endsWith("/turns") && request.method() === "POST") {
        const input = request.postDataJSON();
        expect(input.documentsVersion).toBe(list.version);
        expect(accepted).toBeGreaterThan(0);
        turns++;
        chat!.version++;
        chat!.title = "Oak care";
        chat!.documents = list.documents;
        chat!.turns.push({
          id: input.id,
          question: input.query,
          format: input.format,
          expectedVersion: input.expectedVersion,
          documentsVersion: input.documentsVersion,
          status: "ready",
          error: null,
          createdAt: new Date().toISOString(),
          result: {
            message: "",
            statements: [],
            webStatements: [],
            sources: [],
            proposal: null,
            documentStatements: [
              {
                text: "Oak roots need damp mulch.",
                sources: [{ id: chunkId, version: 1, quote: "damp mulch" }],
              },
            ],
            documentSources: [
              {
                id: chunkId,
                version: 1,
                documentId: list.documents[0].id,
                filename: "Oak.md",
                ordinal: 0,
                content: "Oak roots need damp mulch.",
                pageStart: 1,
                pageEnd: 1,
                sourceStart: 0,
                sourceEnd: 26,
              },
            ],
            documentCoverage: { shown: 1, total: 1, partial: false },
          },
        });
        data = chat;
      } else if (path === `/conversations/${chat?.id}`) data = chat;
      else if (path === "/memories" && request.method() === "POST") {
        saves++;
      }
      await route.fulfill({ json: { success: true, data } });
    });
    await page.goto(`${base}/app/ask`);
    await page.getByLabel("Attach notes and documents").setInputFiles({
      name: "Oak.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Oak care\n\nOak roots need damp mulch."),
    });
    await expect(
      page.getByRole("list", { name: "Attached documents" }),
    ).toContainText("Ready");
    expect(
      await page
        .getByRole("button", { name: "Send question", exact: true })
        .evaluate(
          (element) =>
            element.getBoundingClientRect().bottom <=
            element.closest(".ask-console")!.getBoundingClientRect().bottom,
        ),
    ).toBe(true);
    expect(turns).toBe(0);
    expect(saves).toBe(0);
    expect(accepted).toBe(0);
    const composer = page.getByRole("textbox", {
      name: "Ask about your notes",
    });
    await composer.fill("What do the roots need?");
    await composer.press("Enter");
    await expect(page.locator(".ask-document-evidence")).toContainText(
      "damp mulch",
    );
    const directory = resolve(
      "../../documentation/design/screenshots/ask-documents",
    );
    await mkdir(directory, { recursive: true });
    if (width === 390)
      await page.screenshot({
        path: resolve(directory, `answer-${width}.png`),
        fullPage: true,
      });
    await page
      .getByRole("button", { name: "Oak.md · part 1", exact: true })
      .click();
    const source = page.getByRole("dialog", { name: "Oak.md", exact: true });
    await expect(source).toContainText("Oak roots need damp mulch.");
    expect(
      (
        await new AxeBuilder({ page })
          .include("dialog")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    if (width === 1440)
      await page.screenshot({ path: resolve(directory, "source-1440.png") });
    await page.keyboard.press("Escape");
    await expect(source).not.toBeVisible();
    await composer.fill("And what about mulch?");
    await composer.press("Enter");
    await expect(page.locator(".ask-document-evidence")).toHaveCount(2);
    expect(turns).toBe(2);
    expect(saves).toBe(0);
    await page
      .getByRole("button", { name: "Save document text…", exact: true })
      .click();
    const review = page.getByRole("dialog", {
      name: "Save document text",
      exact: true,
    });
    await expect(
      review.getByRole("heading", { name: "1 proposed note", exact: true }),
    ).toBeVisible();
    await expect(
      review.getByRole("button", { name: "Confirm import", exact: true }),
    ).toBeDisabled();
    expect(saves).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
