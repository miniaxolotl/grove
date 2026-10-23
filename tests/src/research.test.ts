import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import * as AI from "@lib/ai";

async function fixture(
  run: (url: string, calls: Record<string, unknown>[]) => Promise<void>,
  output?: unknown,
) {
  const calls: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    calls.push(body);
    if (body.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const result =
      body.method === "initialize"
        ? {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1" },
          }
        : body.method === "tools/list"
          ? {
              tools: [
                "web_search_advanced_exa",
                "web_fetch_exa",
                "tavily_search",
                "tavily_extract",
              ].map((name) => ({ name, inputSchema: { type: "object" } })),
            }
          : (output ?? {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    results: [
                      {
                        url: "https://example.org/article",
                        title: "Gardening",
                        text: "Use compost.",
                        content: "Use compost.",
                        raw_content: null,
                      },
                      {
                        url: "http://127.0.0.1/private",
                        title: "Unsafe",
                        text: "private",
                      },
                    ],
                  }),
                },
              ],
            });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`,
      calls,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("MCP research pins economical modes and normalizes only public cited evidence", async () => {
  const create = Reflect.get(AI, "createResearchProvider");
  assert.equal(typeof create, "function", "research provider is implemented");
  for (const provider of ["exa", "tavily"] as const)
    await fixture(async (url, calls) => {
      const client = create(provider, "synthetic-key", { url });
      const result = await client.search("garden compost");
      assert.equal(result.length, 1);
      assert.equal(result[0].url, "https://example.org/article");
      assert.equal(result[0].provider, provider);
      assert.equal(result[0].text, "Use compost.");
      const call = calls.find((c) => c.method === "tools/call")!.params as {
        name: string;
        arguments: Record<string, unknown>;
      };
      assert.equal(
        call.name,
        provider === "exa" ? "web_search_advanced_exa" : "tavily_search",
      );
      assert.equal(
        call.arguments[provider === "exa" ? "type" : "search_depth"],
        provider === "exa" ? "lite" : "basic",
      );
      assert.equal(
        call.arguments[provider === "exa" ? "numResults" : "max_results"],
        5,
      );
      assert.equal(
        "include_answer" in call.arguments,
        false,
        "Tavily MCP does not accept the API-only include_answer argument",
      );
    });
});

test("research rejects unsafe extraction URLs and oversized batches before dispatch", async () => {
  const create = Reflect.get(AI, "createResearchProvider");
  assert.equal(typeof create, "function");
  await fixture(async (url, calls) => {
    const client = create("exa", "synthetic-key", { url });
    for (const urls of [
      ["http://169.254.169.254/latest"],
      ["https://user:password@example.com/"],
      ["file:///etc/passwd"],
      Array(4).fill("https://example.org"),
    ])
      await assert.rejects(client.extract(urls));
    assert.equal(calls.length, 0);
  });
});

test("provider failures never return upstream secrets as diagnostics", async () => {
  const create = Reflect.get(AI, "createResearchProvider");
  assert.equal(typeof create, "function");
  await fixture(
    async (url) => {
      await assert.rejects(
        create("exa", "synthetic-key", { url }).search("garden"),
        (error: Error) => {
          assert.equal(error.message.includes("secret-canary"), false);
          return true;
        },
      );
    },
    { isError: true, content: [{ type: "text", text: "secret-canary" }] },
  );
});

test("Exa page retrieval accepts its Markdown envelope and binds it to the requested URL", async () => {
  const create = Reflect.get(AI, "createResearchProvider");
  await fixture(
    async (url) => {
      const result = await create("exa", "synthetic-key", { url }).extract([
        "https://example.org/article",
      ]);
      assert.equal(result[0].title, "Gardening");
      assert.equal(result[0].text, "Use compost.");
      assert.equal(result[0].kind, "page");
    },
    {
      content: [
        {
          type: "text",
          text: "# Gardening\nURL: https://example.org/article\n\nUse compost.",
        },
      ],
    },
  );
});
