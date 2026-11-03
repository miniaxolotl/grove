import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

export type ResearchProviderId = "exa" | "tavily";
export type WebEvidence = {
  id: string;
  url: string;
  title: string;
  text: string;
  provider: ResearchProviderId;
  retrievedAt: string;
  kind: "search" | "page";
};
export type ResearchProvider = {
  profile?: string;
  search(query: string, signal?: AbortSignal): Promise<WebEvidence[]>;
  extract(urls: string[], signal?: AbortSignal): Promise<WebEvidence[]>;
};

export function publicResearchUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      isIP(host.replace(/^\[|\]$/g, "")) ||
      !host.includes(".") ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    )
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

const resultSchema = z.object({
  results: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().nullish(),
        text: z.string().nullish(),
        content: z.string().nullish(),
        raw_content: z.string().nullish(),
      }),
    )
    .max(100),
});

/** Credentials and provider bodies never enter errors or telemetry. Each call owns
 * its MCP session so concurrent tenants cannot inherit transport/session state. */
export function createResearchProvider(
  provider: ResearchProviderId,
  key: string,
  options: { url?: string; timeoutMs?: number } = {},
): ResearchProvider {
  const url = new URL(
    options.url ??
      (provider === "exa"
        ? "https://mcp.exa.ai/mcp?tools=web_search_advanced_exa,web_fetch_exa"
        : "https://mcp.tavily.com/mcp/"),
  );
  async function call(
    name: string,
    args: Record<string, unknown>,
    kind: WebEvidence["kind"],
    parent?: AbortSignal,
  ) {
    const signal = AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? 20000),
      ...(parent ? [parent] : []),
    ]);
    const client = new Client({ name: "grove-research", version: "1.0.0" });
    try {
      signal.throwIfAborted();
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers:
            provider === "exa"
              ? { "x-api-key": key }
              : { Authorization: `Bearer ${key}` },
        },
        fetch: async (input, init) => {
          const response = await fetch(input, {
            ...init,
            redirect: "error",
            signal: AbortSignal.any([
              signal,
              ...(init?.signal ? [init.signal] : []),
            ]),
          });
          if (!response.body) return response;
          let bytes = 0;
          return new Response(
            response.body.pipeThrough(
              new TransformStream({
                transform(chunk, controller) {
                  bytes += chunk.byteLength;
                  if (bytes > 512 * 1024)
                    throw new Error("research_response_too_large");
                  controller.enqueue(chunk);
                },
              }),
            ),
            { status: response.status, headers: response.headers },
          );
        },
      });
      await client.connect(transport);
      const tools = await client.listTools({}, { signal });
      if (!tools.tools.some((tool) => tool.name === name))
        throw new Error("research_tool_unavailable");
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        { signal, timeout: options.timeoutMs ?? 20000 },
      );
      if (result.isError) throw new Error("research_provider_failed");
      const blocks = z
        .array(
          z.object({
            type: z.string(),
            text: z
              .string()
              .max(256 * 1024)
              .optional(),
          }),
        )
        .parse(result.content);
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n");
      let payload = result.structuredContent;
      if (!payload) {
        if (provider === "exa" && kind === "page" && text.startsWith("# ")) {
          const headers = [...text.matchAll(/^# ([^\n]+)\nURL: (\S+)\n\n/gm)];
          if (!headers.length) throw new Error("research_invalid_page");
          payload = {
            results: headers
              .filter((header) => (args.urls as string[]).includes(header[2]))
              .map((header) => ({
                title: header[1],
                url: header[2],
                text: text
                  .slice(
                    header.index! + header[0].length,
                    headers[headers.indexOf(header) + 1]?.index ?? text.length,
                  )
                  .trim(),
              })),
          };
        } else payload = JSON.parse(text);
      }
      const parsed = resultSchema.parse(payload);
      const seen = new Set<string>();
      return parsed.results
        .flatMap((row) => {
          const address = publicResearchUrl(row.url);
          if (!address || seen.has(address)) return [];
          seen.add(address);
          return [
            {
              id: address,
              url: address,
              title: (row.title || new URL(address).hostname).slice(0, 240),
              text: (row.text ?? row.raw_content ?? row.content ?? "").slice(
                0,
                2400,
              ),
              provider,
              retrievedAt: new Date().toISOString(),
              kind,
            },
          ];
        })
        .slice(0, kind === "search" ? 5 : 3);
    } catch {
      signal.throwIfAborted();
      throw new Error("Research provider is temporarily unavailable.");
    } finally {
      await client.close().catch(() => {});
    }
  }
  return {
    profile: createHash("sha256")
      .update(
        JSON.stringify([
          "public-research-v1",
          provider,
          url.href,
          options.timeoutMs ?? 20000,
        ]),
      )
      .digest("hex"),
    search(query, signal) {
      query = z.string().trim().min(1).max(500).parse(query);
      return provider === "exa"
        ? call(
            "web_search_advanced_exa",
            { query, type: "lite", numResults: 5, textMaxCharacters: 2400 },
            "search",
            signal,
          )
        : call(
            "tavily_search",
            {
              query,
              search_depth: "basic",
              max_results: 5,
              include_raw_content: false,
            },
            "search",
            signal,
          );
    },
    async extract(urls, signal) {
      const addresses = z
        .array(z.string())
        .min(1)
        .max(3)
        .parse(urls)
        .map(publicResearchUrl);
      if (addresses.some((address) => !address))
        throw new Error("Use public website URLs.");
      // Provider fetches happen remotely, but reject DNS names resolving to local
      // addresses too; no Grove-side requests are made to supplied URLs.
      for (const address of addresses) {
        const resolved = await lookup(new URL(address!).hostname, {
          all: true,
        });
        if (
          !resolved.length ||
          resolved.some(({ address: ip }) =>
            /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.|::|f[cd]|fe[89ab])/i.test(
              ip,
            ),
          )
        )
          throw new Error("Use public website URLs.");
      }
      return provider === "exa"
        ? call(
            "web_fetch_exa",
            { urls: addresses, maxCharacters: 2400 },
            "page",
            signal,
          )
        : call(
            "tavily_extract",
            { urls: addresses, extract_depth: "basic", format: "markdown" },
            "page",
            signal,
          );
    },
  };
}
