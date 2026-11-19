import { camelRows, tenant, type Knex } from "@lib/database";
import { createHmac, hkdfSync } from "node:crypto";
import { openDeletionRecipient } from "./deletion-recipient.ts";
import { renderEmail } from "./email-template.ts";

type Receipt = {
  id: string;
  accountId: string;
  leaseId: string;
  attempts: number;
  snapshot: Buffer;
  fingerprint: string | null;
};
type ReceiptMail = {
  key: string;
  from: string;
  siteUrl: string;
  receiptKey: string;
  replyTo?: string;
};

export async function deliverDeletionReceipt(
  db: Knex,
  config: ReceiptMail,
  wantedId?: string,
  send = fetch,
) {
  const job = camelRows<Receipt>(
    await db.raw("SELECT * FROM grove_claim_receipt(?::uuid)", [
      wantedId ?? null,
    ]),
  )[0];
  if (!job) return false;
  const lease = { id: job.id, leaseId: job.leaseId };
  let code = "receipt_invalid_snapshot",
    retry = false,
    delay = 30 * 2 ** job.attempts;
  try {
    const to = openDeletionRecipient(config.receiptKey, job);
    const body = JSON.stringify({
      from: config.from,
      to: [to],
      ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      ...renderEmail({ kind: "deletion_requested" }, config.siteUrl),
    });
    // Fence changes to address, template, origin or sender after an uncertain send.
    const fingerprintKey = Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(config.receiptKey, "hex"),
        job.id,
        "grove:receipt-body:v1",
        32,
      ),
    );
    const fingerprint = createHmac("sha256", fingerprintKey)
      .update(body)
      .digest("hex");
    code = "receipt_payload_changed";
    if (job.fingerprint && job.fingerprint !== fingerprint) throw new Error();
    const allowed = await tenant(db, job.accountId, (trx) =>
      trx("deletion_receipts")
        .where(lease)
        .whereRaw("lease_until>now() AND created_at>now()-interval '23 hours'")
        .whereIn(
          "accountId",
          trx("accounts")
            .select("id")
            .whereIn("status", ["deleting", "deleted"]),
        )
        .update({ fingerprint }),
    );
    if (!allowed) return true;
    code = "receipt_transport_unavailable";
    retry = true;
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `grove-deletion-${job.id}`,
      },
      body,
    });
    if (!response.ok) {
      code = `receipt_http_${response.status}`;
      retry =
        response.status === 429 ||
        response.status >= 500 ||
        response.status === 408 ||
        (response.status === 409 &&
          (await response.json().catch(() => null))?.name ===
            "concurrent_idempotent_requests");
      const after = response.headers.get("Retry-After");
      if (after) {
        const seconds = /^\d+$/.test(after)
          ? Number(after)
          : (Date.parse(after) - Date.now()) / 1000;
        if (!Number.isNaN(seconds))
          delay = Math.max(delay, Math.min(86400, Math.ceil(seconds)));
      }
      throw new Error();
    }
    const providerId = (await response.json())?.id;
    if (
      typeof providerId !== "string" ||
      !providerId ||
      providerId.length > 128
    )
      throw new Error();
    await tenant(db, job.accountId, (trx) =>
      trx("deletion_receipts")
        .where(lease)
        .where("leaseUntil", ">", trx.fn.now())
        .update({
          snapshot: null,
          fingerprint: null,
          acceptedAt: trx.fn.now(),
          providerId,
          leaseId: null,
          leaseUntil: null,
          errorCode: null,
        }),
    );
  } catch {
    const terminal = !retry || job.attempts >= 5;
    await tenant(db, job.accountId, (trx) =>
      trx("deletion_receipts")
        .where(lease)
        .where("leaseUntil", ">", trx.fn.now())
        .update({
          ...(terminal
            ? { snapshot: null, fingerprint: null, failedAt: trx.fn.now() }
            : {}),
          errorCode: code,
          dispatchedAt: null,
          leaseId: null,
          leaseUntil: null,
          dueAt: trx.raw("now()+ (? * interval '1 second')", [delay]),
        }),
    );
  }
  return true;
}
