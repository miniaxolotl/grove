import { camelRows, tenant, type Knex } from "@lib/database";
import { createHmac } from "node:crypto";

import { resolveExportReady } from "@lib/memory";
import { renderEmail, type EmailEvent } from "./email-template.ts";

type MailJob = {
  id: string;
  accountId: string;
  kind:
    | "welcome"
    | "connection_approved"
    | "connection_revoked"
    | "export_ready";
  exportTaskId: string | null;
  exportPreparationId: string | null;
  leaseId: string;
  attempts: number;
  fingerprint: string | null;
};
type MailConfig = {
  key: string;
  from: string;
  siteUrl: string;
  exportReady?: boolean;
};
export async function deliverEmail(
  db: Knex,
  config: MailConfig,
  recipient: (subject: string) => Promise<string | null>,
  wantedId?: string,
  send = fetch,
): Promise<boolean> {
  const job = camelRows<MailJob>(
    await db.raw("SELECT * FROM grove_claim_email(?::uuid)", [
      wantedId ?? null,
    ]),
  )[0];
  if (!job) return false;
  let code = "email_unavailable";
  let retryable = true;
  let delay: number | null = null;
  try {
    const subject = await tenant(
      db,
      job.accountId,
      async (trx) =>
        (
          await trx("accounts")
            .where({ id: job.accountId, status: "active" })
            .first()
        )?.clerkSubject as string | undefined,
    );
    const to = subject ? await recipient(subject) : null;
    if (!to) {
      code = "email_recipient_unavailable";
      retryable = false;
      throw new Error();
    }
    const allowed = await tenant(
      db,
      job.accountId,
      async (trx) =>
        !!(await trx("accounts")
          .where({ id: job.accountId, status: "active" })
          .first("id")),
    );
    if (!allowed) {
      code = "email_account_inactive";
      retryable = false;
      throw new Error();
    }
    let event: EmailEvent;
    if (job.kind === "export_ready") {
      const detail = config.exportReady && (await resolveExportReady(db, job));
      if (!detail) {
        code = "email_export_unavailable";
        retryable = false;
        throw new Error();
      }
      event = { kind: "export_ready", ...detail };
    } else event = { kind: job.kind };
    const body = JSON.stringify({
      from: config.from,
      to: [to],
      ...renderEmail(event, config.siteUrl),
    });
    const fingerprint = createHmac("sha256", config.key)
      .update(`grove:mail:v1:${job.id}:`)
      .update(body)
      .digest("hex");
    if (job.fingerprint && job.fingerprint !== fingerprint) {
      code = "email_payload_changed";
      retryable = false;
      throw new Error();
    }
    const fenced = await tenant(db, job.accountId, (trx) =>
      trx("transactional_emails")
        .where({ id: job.id, leaseId: job.leaseId })
        .where("leaseUntil", ">", trx.fn.now())
        .whereIn(
          "accountId",
          trx("accounts").select("id").where("status", "active"),
        )
        .update({ fingerprint }),
    );
    if (!fenced) return true;
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `grove-${job.id}`,
      },
      body,
    });
    if (!response.ok) {
      code = `email_http_${response.status}`;
      retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;
      const after = response.headers.get("Retry-After");
      if (after) {
        const seconds = /^\d+$/.test(after)
          ? Number(after)
          : (Date.parse(after) - Date.now()) / 1000;
        if (Number.isFinite(seconds))
          delay = Math.max(
            30 * 2 ** job.attempts,
            Math.min(86400, Math.ceil(seconds)),
          );
      }
      if (response.status === 409) {
        const conflict = await response.json().catch(() => null);
        retryable = conflict?.name === "concurrent_idempotent_requests";
      }
      throw new Error();
    }
    const result = (await response.json()) as { id?: string };
    if (typeof result.id !== "string" || !result.id || result.id.length > 128)
      throw new Error();
    await tenant(db, job.accountId, (trx) =>
      trx("transactional_emails")
        .where({ id: job.id, leaseId: job.leaseId })
        .where("leaseUntil", ">", trx.fn.now())
        .update({
          sentAt: trx.fn.now(),
          providerId: result.id,
          fingerprint: null,
          leaseId: null,
          leaseUntil: null,
          errorCode: null,
        }),
    );
  } catch {
    await tenant(db, job.accountId, (trx) =>
      trx("transactional_emails")
        .where({ id: job.id, leaseId: job.leaseId })
        .where("leaseUntil", ">", trx.fn.now())
        .update({
          leaseId: null,
          leaseUntil: null,
          dispatchedAt: null,
          errorCode: code,
          failedAt: !retryable || job.attempts >= 5 ? trx.fn.now() : null,
          dueAt: trx.raw("now() + (? * interval '1 second')", [
            delay ?? Math.min(3600, 30 * 2 ** job.attempts),
          ]),
        }),
    );
  }
  return true;
}
