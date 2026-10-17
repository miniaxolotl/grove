import "server-only";

const origin = new URL(
  process.env.SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL &&
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
    "http://localhost:3000",
);

if (!["http:", "https:"].includes(origin.protocol)) {
  throw new Error("SITE_URL must be an HTTP or HTTPS website origin.");
}

export const site = {
  name: "Grove",
  creator: "Bramble Labs Inc.",
  title: "Grove — New session. Same context.",
  description:
    "Give your AI agent a memory that lasts. Grove is an open-source, self-hosted MCP server for semantic memory, knowledge graphs, and context you control.",
  url: origin.origin,
  github: "https://github.com/miniaxolotl/grove",
  npm: "https://www.npmjs.com/package/@miniaxolotl/grove",
  docs: "https://github.com/miniaxolotl/grove/blob/HEAD/documentation/server.md",
  pluginDocs:
    "https://github.com/miniaxolotl/grove/blob/HEAD/documentation/client.md",
  deployDocs:
    "https://github.com/miniaxolotl/grove/blob/HEAD/documentation/deploy.md",
} as const;
