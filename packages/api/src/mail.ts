import { camelRows, tenant, type Knex } from "@lib/database";

import { renderEmail } from "./email-template.ts";

type MailJob = {
  id: string;
  accountId: string;
  kind: "welcome" | "connection_approved" | "connection_revoked";
  leaseId: string;
  attempts: number;
};
type MailConfig = { key: string; from: string; siteUrl: string };
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
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `grove-${job.id}`,
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        ...renderEmail({ kind: job.kind }, config.siteUrl),
      }),
    });
    if (!response.ok) {
      code = `email_http_${response.status}`;
      retryable = response.status === 429 || response.status >= 500;
      throw new Error();
    }
    const result = (await response.json()) as { id?: string };
    if (!result.id) throw new Error();
    await tenant(db, job.accountId, (trx) =>
      trx("transactional_emails")
        .where({ id: job.id, leaseId: job.leaseId })
        .update({
          sentAt: trx.fn.now(),
          providerId: result.id,
          leaseId: null,
          leaseUntil: null,
          errorCode: null,
        }),
    );
  } catch {
    await tenant(db, job.accountId, (trx) =>
      trx("transactional_emails")
        .where({ id: job.id, leaseId: job.leaseId })
        .update({
          leaseId: null,
          leaseUntil: null,
          dispatchedAt: null,
          errorCode: code,
          failedAt: !retryable || job.attempts >= 5 ? trx.fn.now() : null,
          dueAt: trx.raw("now() + (? * interval '1 second')", [
            Math.min(3600, 30 * 2 ** job.attempts),
          ]),
        }),
    );
  }
  return true;
}
