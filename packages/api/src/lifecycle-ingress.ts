import { createHash } from "node:crypto";
import { Webhook } from "svix";
import type Stripe from "stripe";
import { z } from "zod";

/** No raw body, email, metadata or credentials enter durable work or the broker. */
export type LifecycleEvent = {
  provider: "clerk" | "stripe";
  id: string;
  type: string;
  subject: string;
  eventAt: number;
  disabled: boolean;
  fingerprint: string;
};
const identifier = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9_-]+$/);
const clerkEvent = z.object({
  type: z.enum([
    "user.created",
    "user.updated",
    "user.deleted",
    "session.revoked",
    "session.ended",
    "session.removed",
  ]),
  timestamp: z.number().int().positive().safe(),
  data: z.object({
    id: identifier,
    banned: z.boolean().optional(),
    locked: z.boolean().optional(),
  }),
});
const stripeEvent = z.object({
  id: identifier,
  type: z
    .string()
    .regex(
      /^(customer\.subscription\.(created|updated|deleted)|checkout\.session\.(completed|async_payment_succeeded|async_payment_failed)|invoice\.(paid|payment_failed))$/,
    ),
  created: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER / 1000),
  livemode: z.boolean(),
  data: z.object({ object: z.object({ customer: identifier }) }),
});
const maxBytes = 262144;
class BodyLimit extends Error {}
async function boundedBody(request: Request) {
  if (!request.body) throw new Error("Missing body");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    throw new BodyLimit();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0,
    expired = false;
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel();
  }, 5000);
  try {
    while (true) {
      const chunk = await reader.read();
      if (expired) throw new Error("Body deadline");
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new BodyLimit();
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
const header = (request: Request, name: string) => {
  const value = request.headers.get(name);
  if (!value || value.length > 4096)
    throw new Error("Invalid signature header");
  return value;
};
const reply = (status: number, code: string) =>
  Response.json(
    { status: code },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );

export function createLifecycleIngress(options: {
  clerkSecret?: string;
  stripeSecret?: string;
  stripe?: Stripe;
  livemode?: boolean;
  accept: (event: LifecycleEvent) => Promise<unknown>;
}) {
  let inFlight = 0;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (
      request.method !== "POST" ||
      url.search ||
      !["/v1/webhooks/clerk", "/v1/webhooks/stripe"].includes(url.pathname)
    )
      return reply(503, "release_held");
    if (inFlight >= 16) return reply(503, "lifecycle_busy");
    if (
      url.pathname === "/v1/webhooks/stripe" &&
      (!options.stripe || !options.stripeSecret)
    )
      return reply(503, "billing_disabled");
    inFlight++;
    try {
      let event: LifecycleEvent;
      try {
        if (
          !/^application\/json(?:;|$)/i.test(
            request.headers.get("content-type") ?? "",
          )
        )
          throw new Error("Invalid content type");
        const raw = await boundedBody(request);
        const fingerprint = createHash("sha256").update(raw).digest("hex");
        if (url.pathname === "/v1/webhooks/clerk") {
          const id = identifier.parse(header(request, "svix-id"));
          const payload = clerkEvent.parse(
            new Webhook(options.clerkSecret ?? "").verify(raw, {
              "svix-id": id,
              "svix-timestamp": header(request, "svix-timestamp"),
              "svix-signature": header(request, "svix-signature"),
            }),
          );
          event = {
            provider: "clerk",
            id,
            type: payload.type,
            subject: payload.data.id,
            eventAt: payload.timestamp,
            disabled:
              payload.data.banned === true || payload.data.locked === true,
            fingerprint,
          };
        } else {
          const payload = stripeEvent.parse(
            options.stripe!.webhooks.constructEvent(
              raw,
              header(request, "stripe-signature"),
              options.stripeSecret!,
            ),
          );
          if (payload.livemode !== options.livemode)
            throw new Error("Wrong Stripe mode");
          event = {
            provider: "stripe",
            id: payload.id,
            type: payload.type,
            subject: payload.data.object.customer,
            eventAt: payload.created * 1000,
            disabled: false,
            fingerprint,
          };
        }
        if (event.eventAt > Date.now() + 300000)
          throw new Error("Future event");
      } catch (error) {
        return reply(
          error instanceof BodyLimit ? 413 : 400,
          "invalid_lifecycle_event",
        );
      }
      try {
        // Acceptance means the authority AND work/outbox commit completed, never
        // that a provider effect finished. A lost ACK is safe to redeliver.
        await options.accept(event);
        return reply(202, "lifecycle_accepted");
      } catch {
        return reply(503, "lifecycle_unavailable");
      }
    } finally {
      inFlight--;
    }
  };
}
