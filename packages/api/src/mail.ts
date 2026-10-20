import { camelRows, tenant, type Knex } from "@lib/database";

type MailJob = {
  id: string;
  accountId: string;
  kind: "welcome" | "connection_approved" | "connection_revoked";
  leaseId: string;
  attempts: number;
};
type MailConfig = { key: string; from: string; siteUrl: string };
const messages = {
  welcome: {
    subject: "Welcome to Grove",
    text: "Your Grove is ready. Write your first note, start a journal, or make a notebook for something you care about.",
    path: "/app",
  },
  connection_approved: {
    subject: "An agent connection was approved",
    text: "A connection now has access to your Grove. You can review its permissions or revoke access in Connections.",
    path: "/app/connections",
  },
  connection_revoked: {
    subject: "An agent connection was revoked",
    text: "A connection’s access to your Grove has been revoked. Your notes remain in your account.",
    path: "/app/connections",
  },
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
    const message = messages[job.kind];
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
    const link = `${config.siteUrl}${message.path}`;
    const escape = (text: string) =>
      text.replace(
        /[&<>"']/g,
        (value) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[value]!,
      );
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
        subject: message.subject,
        text: `${message.text}\n\n${link}\n\nGrove · Bramble Labs Inc.\nThis is a transactional account notification.`,
        html: `<!doctype html><html lang="en"><body style="margin:0;background:#f7f6ef;color:#263f32;font-family:Arial,sans-serif"><main style="max-width:520px;margin:40px auto;padding:32px;background:#fffefb;border:1px solid #e0e4d8;border-radius:12px"><p style="font-size:21px;font-weight:600;letter-spacing:2px">GROVE</p><h1 style="font-size:24px;font-weight:500;margin:32px 0 16px">${message.subject}</h1><p style="font-size:16px;line-height:1.8;color:#58685e">${message.text}</p><p style="margin:28px 0"><a href="${escape(link)}" style="display:inline-block;padding:13px 20px;background:#263f32;color:#ffffff;border-radius:8px;text-decoration:none">${job.kind === "welcome" ? "Open your notebook" : "Review connections"}</a></p><p style="font-size:12px;line-height:1.8;color:#58685e">A little space for what matters.<br>Grove · Bramble Labs Inc.</p><p style="font-size:11px;color:#58685e">This is a transactional account notification.</p></main></body></html>`,
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
