import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const image = await readFile(
    join(process.cwd(), "public/brand-kit/icons/apple-touch-icon-180.png"),
  );
  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": contentType },
  });
}
