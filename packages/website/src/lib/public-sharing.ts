import "server-only";
import { notFound } from "next/navigation";
import { publicShareSchema, shareTokenSchema } from "@lib/shared/sharing";
import { uuidSchema } from "@lib/shared/contracts";

export async function readPublicShare(
  token: string,
  kind: "root" | "notes" | "notebooks" = "root",
  id?: string,
  cursor?: string,
) {
  if (
    !shareTokenSchema.safeParse(token).success ||
    (kind !== "root" && !uuidSchema.safeParse(id).success)
  )
    notFound();
  if (!process.env.GROVE_API_URL || !URL.canParse(process.env.GROVE_API_URL))
    throw new Error("Shared content is temporarily unavailable");
  const origin = new URL(process.env.GROVE_API_URL);
  if (
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      ))
  )
    throw new Error("Shared content is temporarily unavailable");
  const url = new URL(
    `/public/shares/${token}${kind === "root" ? "" : `/${kind}/${id}`}`,
    origin,
  );
  if (cursor) {
    if (typeof cursor !== "string" || cursor.length > 2048)
      throw new Error("Reload the shared notebook to continue");
    url.searchParams.set("cursor", cursor);
  }
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  }).catch(() => {
    // Native network errors can contain the capability-bearing request URL.
    throw new Error("Shared content is temporarily unavailable");
  });
  if (response.status === 404) notFound();
  if (!response.ok)
    throw new Error("Shared content is temporarily unavailable");
  try {
    const result = await response.json();
    if (!result.success) throw new Error();
    return publicShareSchema.parse(result.data);
  } catch {
    // JSON/validation errors must not log upstream content or response snippets.
    throw new Error("Shared content is temporarily unavailable");
  }
}
