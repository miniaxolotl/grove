import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import type { HoldIdentity } from "./release-hold.ts";

let initialized = false;
export const markRuntimeInitialized = () => {
  initialized = true;
};
export const runtimeInitialized = () => initialized;

export function createPrivateProof(options: {
  mode: "lifecycle" | "runtime";
  role: "api" | "worker";
  identity: HoldIdentity;
  approval?: string;
  receipt?: string;
  secret: string;
  ready: () => Promise<unknown>;
  evidence: () => Promise<unknown>;
}) {
  const path = `/_grove/release/${options.mode}`;
  let probing = false;
  return async (request: Request) => {
    const reply = (code: number, value: unknown) =>
      Response.json(value, {
        status: code,
        headers: { "Cache-Control": "private, no-store" },
      });
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== path || url.search)
      return reply(503, { status: "release_held" });
    const challenge = request.headers.get("X-Grove-Release-Challenge"),
      proof = request.headers.get("X-Grove-Release-Proof");
    if (
      options.secret.length < 16 ||
      !challenge ||
      !/^[a-f0-9]{64}$/.test(challenge) ||
      !proof ||
      !/^[a-f0-9]{64}$/.test(proof)
    )
      return reply(403, { status: "private_proof_required" });
    const mac = createHmac("sha256", options.secret)
      .update(
        `${path}\n${challenge}\n${options.role}\n${options.identity.source}`,
      )
      .digest();
    if (!timingSafeEqual(mac, Buffer.from(proof, "hex")))
      return reply(403, { status: "private_proof_required" });
    if (probing) return reply(503, { status: "probe_busy" });
    probing = true;
    try {
      await options.ready();
      const evidence = await options.evidence();
      if (!evidence) throw new Error("Missing durable evidence");
      return reply(200, {
        status:
          options.mode === "runtime"
            ? "runtime_verified"
            : "lifecycle_verified",
        role: options.role,
        identity: options.identity,
        ...(options.approval
          ? { approval: options.approval }
          : { receipt: options.receipt }),
        schema: "verified",
        challenge,
        evidence,
      });
    } catch {
      return reply(503, { status: "release_held", schema: "unavailable" });
    } finally {
      probing = false;
    }
  };
}

export async function listenPrivateProof(
  handler: ReturnType<typeof createPrivateProof>,
  port: number,
) {
  const server = createServer(getRequestListener(handler));
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
  return { server, close };
}
