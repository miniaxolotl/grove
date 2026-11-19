export type EmailEvent =
  | {
      kind:
        | "welcome"
        | "connection_approved"
        | "connection_revoked"
        | "deletion_requested";
    }
  | { kind: "export_ready"; taskId: string; expiresAt: string };

function letter(event: EmailEvent) {
  switch (event.kind) {
    case "welcome":
      return {
        section: "Your workspace",
        subject: "Welcome to Grove",
        preview: "Your workspace is ready for its first note.",
        body: "Start with a thought you want to keep. Open Grove to write a note, or make a notebook for a project.",
        action: "Open Grove",
        path: "/app",
      };
    case "connection_approved":
      return {
        section: "Account security",
        subject: "A connection was approved in Grove",
        preview: "You can review its permissions in Settings.",
        body: "A connection was granted access to your Grove. If you don’t recognize this change, review your connections and revoke any access you didn’t approve.",
        action: "Review connections",
        path: "/app/settings/connections",
      };
    case "connection_revoked":
      return {
        section: "Account security",
        subject: "A connection was revoked in Grove",
        preview: "The connection can no longer access your Grove.",
        body: "Access has been revoked for a connection to your Grove. Your notes are still in your account. You can see which connections still have access in Settings.",
        action: "Review connections",
        path: "/app/settings/connections",
      };
    case "deletion_requested":
      return {
        section: "Your account",
        subject: "We received your Grove account deletion request",
        preview: "Access is turned off while cleanup continues.",
        body: "Access to your Grove account has been turned off. If you requested this, there is nothing else you need to do. If you didn’t request this change, contact support.",
        action: "Contact support",
        path: "/support",
      };
    case "export_ready":
      return {
        section: "Your data",
        subject: "Your Grove export is ready",
        preview: "Sign in to view and download your export.",
        body: "Your file is ready. Sign in to the Grove account that requested the export to download it.",
        detail: `Download before ${new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(event.expiresAt))} UTC.`,
        action: "View export",
        path: `/app/settings/data?export=${encodeURIComponent(event.taskId)}`,
      };
  }
}

const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export function renderEmail(
  event: EmailEvent,
  siteUrl: string,
  preview = false,
) {
  const m = letter(event);
  const origin = new URL(siteUrl);
  if (
    origin.username ||
    origin.password ||
    !(
      origin.protocol === "https:" ||
      (origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
    )
  )
    throw new Error("Invalid email site origin");
  const link = new URL(m.path, origin.origin).href;
  const sample =
    "Preview only. This is a sample email; no account action took place.";
  const footer = "Grove · Bramble Labs Inc.";
  return {
    subject: `${preview ? "[Preview] " : ""}${m.subject}`,
    text: [
      preview ? sample : "",
      m.subject,
      m.body,
      m.detail,
      `${m.action}: ${link}`,
      footer,
    ]
      .filter(Boolean)
      .join("\n\n"),
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(m.subject)}</title></head><body style="margin:0;background:#f7f6f0;color:#253e31;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preview ? sample : escape(m.preview)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;background:#fffffc;border:1px solid #dce0d3;border-top:4px solid #326349"><tr><td style="padding:28px 24px 12px"><b style="font: bold 28px Georgia,serif;color:#253e31">Grove</b></td></tr><tr><td style="padding:16px 24px 28px">
${preview ? `<p style="font-size:14px;color:#505d54">${sample}</p>` : ""}<p style="margin:0 0 10px;font-size:14px;color:#526458">${m.section}</p><h1 style="margin:0 0 16px;font:normal 29px/1.2 Georgia,serif;color:#253e31">${escape(m.subject)}</h1><p style="margin:0 0 20px;font-size:16px;line-height:1.65">${escape(m.body)}</p>${m.detail ? `<p style="padding:12px;background:#e8eee6;font-size:15px">${escape(m.detail)}</p>` : ""}<a href="${escape(link)}" style="display:inline-block;background:#253e31;color:white;border:12px solid #253e31;border-left-width:18px;border-right-width:18px;border-radius:6px;line-height:22px;text-decoration:none;font-weight:bold">${m.action}</a><p style="font-size:14px;line-height:1.6;color:#526458">Or open this address:<br><a href="${escape(link)}" style="color:#326349;word-break:break-all">${escape(link)}</a></p></td></tr><tr><td style="border-top:1px solid #dce0d3;padding:18px 24px;color:#526458;font-size:13px">${footer}</td></tr></table></td></tr></table></body></html>`,
  };
}
