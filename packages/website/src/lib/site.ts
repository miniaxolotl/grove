import "server-only";
import { positioning } from "@/content/site";

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
  ...positioning,
  url: origin.origin,
  github: "https://github.com/miniaxolotl/grove",
  npm: "https://www.npmjs.com/package/@miniaxolotl/grove",
  docs: "https://github.com/miniaxolotl/grove/blob/HEAD/documentation/server.md",
  pluginDocs:
    "https://github.com/miniaxolotl/grove/blob/HEAD/documentation/client.md",
  deployDocs:
    "https://github.com/miniaxolotl/grove/blob/HEAD/documentation/deploy.md",
} as const;
