import { auth } from "@clerk/nextjs/server";
import { type NextRequest } from "next/server";
import { site } from "@/lib/site";
import { showBilling } from "@/lib/flags";

export const maxDuration = 180;

const allowed =
  /^(me|ask|relationships\/(?:search|(?:note|notebook)\/[0-9a-f-]+\/(?:review|retry))|conversations(?:\/[0-9a-f-]+(?:\/turns(?:\/[0-9a-f-]+\/(?:apply|undo))?)?)?|models(?:\/test)?|briefs(?:\/refresh)?|projects(?:\/[0-9a-f-]+(?:\/(?:share|lifecycle|archive|restore|delete))?)?|memories(?:\/(?:search|delete|[0-9a-f-]+(?:\/(?:revisions(?:\/[1-9][0-9]*)?|archive|restore|reprocess|share))?))?|shares\/[0-9a-f-]+(?:\/rotate)?|recall|connect\/[0-9a-f-]+(?:\/(?:approve|cancel))?|connections(?:\/[0-9a-f-]+)?|keys|account\/(?:settings|export|delete|usage))$/;
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
  const billing = /^(billing|billing\/(?:checkout|portal))$/.test(path);
  const admin =
    path === "admin" || path === "admin/audit"
      ? request.method === "GET"
      : [
            "admin/accounts/search",
            "admin/accounts/browse",
            "admin/accounts/details",
          ].includes(path)
        ? request.method === "POST"
        : ["admin/accounts", "admin/accounts/support"].includes(path) &&
          request.method === "PATCH";
  if (billing && process.env.BILLING_CONFIGURED !== "true")
    return fail(404, "Route not found");
  if (billing && !(await showBilling())) return fail(404, "Route not found");
  const media =
    /^memories\/[0-9a-f-]+\/(?:media\/[0-9a-f-]+(?:\/transcript)?|archive-file)$/.test(
      path,
    ) || /^speech\/[0-9a-f-]+\/audio$/.test(path);
  const importFile =
    /^import-batches\/[0-9a-f-]+\/files\/[0-9a-f-]+(?:\/original)?$/.test(path);
  const importRoute =
    /^(?:import-batches|import-batches\/[0-9a-f-]+(?:\/(?:prepare|confirm|cancel|suggest|placement|conversation|notes\/[0-9a-f-]+))?)$/.test(
      path,
    );
  const chatDocumentFile =
    /^conversations\/[0-9a-f-]+\/documents\/[0-9a-f-]+(?:\/original)?$/.test(
      path,
    );
  const chatDocumentRoute =
    /^conversations\/[0-9a-f-]+\/documents(?:\/(?:accept|import|[0-9a-f-]+\/passages))?$/.test(
      path,
    );
  const noteDocumentRoute =
    /^memories\/[0-9a-f-]+\/document-sources(?:\/[0-9a-f-]+\/original)?$/.test(
      path,
    );
  const speech =
    /^(?:memories\/[0-9a-f-]+\/speech|speech\/[0-9a-f-]+(?:\/cancel)?)$/.test(
      path,
    );
  if (
    !media &&
    !importFile &&
    !chatDocumentFile &&
    !chatDocumentRoute &&
    !noteDocumentRoute &&
    !importRoute &&
    !billing &&
    !admin &&
    !speech &&
    !allowed.test(path) &&
    !/^(ask-tools|conversations\/[0-9a-f-]+\/tools)$/.test(path) &&
    path !== "conversations/search" &&
    !/^files\/(?:search|storage|locations)$/.test(path) &&
    !/^(assistance(?:\/[0-9a-f-]+(?:\/(?:apply|undo|review))?)?|notebook-visits|exports|imports|tasks(?:\/[0-9a-f-]+(?:\/(?:cancel|retry|download))?)?)$/.test(
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
    const binary =
      (media || importFile || chatDocumentFile) && request.method === "PUT";
    const maximum = 3 * 1024 * 1024;
    if (binary && Number(request.headers.get("content-length")) > maximum)
      return fail(413, "Files must be 3 MiB or smaller");
    let received = 0;
    const content = binary
      ? request.body?.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              received += chunk.byteLength;
              if (received > maximum) throw new Error("media_too_large");
              controller.enqueue(chunk);
            },
          }),
        )
      : ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await request.text();
    if (typeof content === "string" && Buffer.byteLength(content) > 128 * 1024)
      return fail(413, "Request body is too large");
    const target = new URL(`/v1/${path}`, origin.origin);
    if (media && request.nextUrl.searchParams.has("version"))
      target.searchParams.set(
        "version",
        request.nextUrl.searchParams.get("version")!,
      );
    if (path === "projects" && request.nextUrl.searchParams.has("status"))
      target.searchParams.set(
        "status",
        request.nextUrl.searchParams.get("status")!,
      );
    const after = request.nextUrl.searchParams.get("after");
    if (path === "conversations" && after)
      target.searchParams.set("after", after);
    if ((path.startsWith("import-batches/") || chatDocumentRoute) && after)
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
        ...(media && request.headers.get("range")
          ? { Range: request.headers.get("range")! }
          : {}),
        "Content-Type": binary
          ? (request.headers.get("content-type") ?? "application/octet-stream")
          : "application/json",
        ...(binary
          ? {
              "Content-Length": request.headers.get("content-length") ?? "0",
              "X-Grove-Note-Version":
                request.headers.get("x-grove-note-version") ?? "0",
              "X-Grove-Content-Sha256":
                request.headers.get("x-grove-content-sha256") ?? "",
              ...(importFile || chatDocumentFile
                ? {
                    "X-Grove-Filename":
                      request.headers.get("x-grove-filename") ?? "",
                  }
                : {}),
            }
          : {}),
        ...([
          request.headers.get("DNT"),
          request.headers.get("Sec-GPC"),
        ].includes("1") || request.headers.get("X-Grove-Telemetry") === "off"
          ? { "X-Grove-Telemetry": "off" }
          : {}),
      },
      body: content,
      ...(binary ? { duplex: "half" } : {}),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(
          media ||
            importFile ||
            chatDocumentFile ||
            noteDocumentRoute ||
            path.endsWith("/documents/accept") ||
            path.endsWith("/suggest") ||
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
      "content-security-policy",
      "content-length",
      "content-range",
      "accept-ranges",
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
export {
  forward as GET,
  forward as HEAD,
  forward as POST,
  forward as PUT,
  forward as PATCH,
  forward as DELETE,
};
