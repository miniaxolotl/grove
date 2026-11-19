import { createHarperChecker } from "../../../lib/shared/src/writing-harper.ts";
// In-process Node tests use the identical pinned slim binary, without a CDN or a server.
const url = new URL(
  "../../../lib/shared/node_modules/harper.js/dist/slimBinaryInlined.js",
  import.meta.url,
);
const { slimBinaryInlined } = await import(url.href);
export const checker = await createHarperChecker(slimBinaryInlined);
