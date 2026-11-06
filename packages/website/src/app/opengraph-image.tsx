import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { positioning } from "@/content/site";

export const alt = positioning.imageAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const image = await readFile(
    join(process.cwd(), "public/images/marketing/share.png"),
  );
  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": contentType },
  });
}
