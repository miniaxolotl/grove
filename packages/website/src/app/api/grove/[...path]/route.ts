import { auth } from "@clerk/nextjs/server";
import { type NextRequest } from "next/server";
import { site } from "@/lib/site";

const allowed =
  /^(me|models(?:\/test)?|briefs(?:\/refresh)?|projects(?:\/[0-9a-f-]+)?|memories(?:\/(?:search|delete|[0-9a-f-]+(?:\/(?:revisions|archive|restore|reprocess))?))?|recall|connect\/[0-9a-f-]+(?:\/(?:approve|cancel))?|connections(?:\/[0-9a-f-]+)?|keys|account\/(?:settings|export|delete|usage))$/;
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
  if (!allowed.test(path)) return fail(404, "Route not found");
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
    const upstream = await fetch(`${origin.origin}/v1/${path}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: content,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(path === "account/export" ? 60000 : 15000),
      ]),
    });
    const outgoing = new Headers(headers);
    for (const name of ["content-type", "content-disposition", "retry-after"]) {
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
