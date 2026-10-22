import { auth } from "@clerk/nextjs/server";
import { type NextRequest } from "next/server";
import { site } from "@/lib/site";

export const maxDuration = 180;

const allowed =
  /^(me|ask|relationships\/(?:search|(?:note|notebook)\/[0-9a-f-]+\/(?:review|retry))|conversations(?:\/[0-9a-f-]+(?:\/turns(?:\/[0-9a-f-]+\/(?:apply|undo))?)?)?|models(?:\/test)?|briefs(?:\/refresh)?|projects(?:\/[0-9a-f-]+(?:\/share)?)?|memories(?:\/(?:search|delete|[0-9a-f-]+(?:\/(?:revisions|archive|restore|reprocess|share))?))?|shares\/[0-9a-f-]+(?:\/rotate)?|recall|connect\/[0-9a-f-]+(?:\/(?:approve|cancel))?|connections(?:\/[0-9a-f-]+)?|keys|account\/(?:settings|export|delete|usage))$/;
async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const headers = { "Cache-Control": "private, no-store" };
  const fail = (status: number, message: string) =>
    Response.json(
      { success: false, error: { code: "request_failed", message } },
      { status, headers },
    );
  if (!process.env.CLERK_SECRET_KEY || !process.env.GROVE_API_URL)
    return fail(503, "Grove account services are not configured yet");
  const session = await auth();
  if (!session.userId) return fail(401, "Sign in to Grove to continue");
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.get("origin") !== site.url
  )
    return fail(403, "Request origin is not allowed");
  const path = (await context.params).path.join("/");
  if (
    !allowed.test(path) &&
    !/^(exports|imports|tasks(?:\/[0-9a-f-]+(?:\/(?:cancel|retry|download))?)?)$/.test(
      path,
    )
  )
    return fail(404, "Route not found");
  const token = await session.getToken();
  if (!token) return fail(401, "Sign in to Grove to continue");
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
    return fail(503, "Invalid API configuration");
  try {
    const content = request.method === "GET" ? undefined : await request.text();
    if (content && Buffer.byteLength(content) > 128 * 1024)
      return fail(413, "Request body is too large");
    const target = new URL(`/v1/${path}`, origin.origin);
    const after = request.nextUrl.searchParams.get("after");
    if (path === "conversations" && after)
      target.searchParams.set("after", after);
    if (path === "tasks" && request.nextUrl.searchParams.has("projectId"))
      target.searchParams.set(
        "projectId",
        request.nextUrl.searchParams.get("projectId")!,
      );
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...([
          request.headers.get("DNT"),
          request.headers.get("Sec-GPC"),
        ].includes("1") || request.headers.get("X-Grove-Telemetry") === "off"
          ? { "X-Grove-Telemetry": "off" }
          : {}),
      },
      body: content,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(
          /^(conversations\/[0-9a-f-]+\/turns|tasks\/[0-9a-f-]+\/download)$/.test(
            path,
          )
            ? 175000
            : path === "account/export" || path === "ask"
              ? 60000
              : 15000,
        ),
      ]),
    });
    const outgoing = new Headers(headers);
    for (const name of [
      "content-type",
      "content-disposition",
      "content-length",
      "retry-after",
    ]) {
      const value = upstream.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: outgoing,
    });
  } catch {
    return fail(503, "Grove is temporarily unavailable. Please retry.");
  }
}
export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
