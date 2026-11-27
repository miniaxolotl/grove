import { createHash } from "node:crypto";
import { publicReaderInputSchema } from "@lib/shared/sharing";
import { boundedRequestBody } from "@/lib/request-body";
import {
  readPublicReader,
  readPublicNavigation,
  PublicReadError,
} from "@/lib/public-sharing";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
  try {
    if (Number(request.headers.get("content-length")) > 8192)
      return Response.json({}, { status: 413, headers });
    const text = await boundedRequestBody(request.body, 8192);
    if (text === null) return Response.json({}, { status: 413, headers });
    const parsed = publicReaderInputSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new PublicReadError(400);
    const input = parsed.data;
    const { token } = await params;
    if (input.kind === "search")
      return Response.json(
        await readPublicNavigation(
          token,
          { q: input.q, cursor: input.cursor },
          request.signal,
        ),
        { headers },
      );
    const state = await readPublicReader(
      token,
      input.kind,
      input.id,
      input.cursor,
      {
        listingFolder: input.listingFolder,
        listingCursors: input.listingCursors,
      },
      request.signal,
    );
    const validator = createHash("sha256")
      .update(JSON.stringify(state))
      .digest("hex");
    // Validate the complete projection after a live read, never a timestamp alone.
    return Response.json(
      input.validator === validator
        ? { validator, unchanged: true }
        : { validator, state },
      { headers },
    );
  } catch (error) {
    const status =
      error instanceof PublicReadError
        ? error.status
        : error instanceof SyntaxError
          ? 400
          : 503;
    if (error instanceof PublicReadError && error.retryAfter)
      headers["Retry-After"] = error.retryAfter;
    return Response.json({}, { status, headers });
  }
}
