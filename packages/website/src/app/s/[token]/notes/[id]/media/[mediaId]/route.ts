import { shareTokenSchema } from "@lib/shared/sharing";
import { uuidSchema } from "@lib/shared/contracts";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string; id: string; mediaId: string }> },
) {
  const { token, id, mediaId } = await context.params;
  const headers = {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
  const fail = (status: number) =>
    new Response("Media unavailable", { status, headers });
  if (
    !shareTokenSchema.safeParse(token).success ||
    !uuidSchema.safeParse(id).success ||
    !uuidSchema.safeParse(mediaId).success
  )
    return fail(404);
  try {
    const origin = new URL(process.env.GROVE_API_URL ?? "");
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
      return fail(503);
    const response = await fetch(
      new URL(`/public/shares/${token}/notes/${id}/media/${mediaId}`, origin),
      {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(90000)]),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return fail(response.status === 404 ? 404 : 503);
    }
    const type = response.headers.get("content-type");
    if (!type || !["image/png", "image/jpeg", "image/webp"].includes(type)) {
      await response.body?.cancel();
      return fail(503);
    }
    return new Response(response.body, {
      headers: {
        ...headers,
        "Content-Type": type,
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return fail(503);
  }
}
