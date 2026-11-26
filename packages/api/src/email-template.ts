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
        subject: "Welcome to Grove",
        heading: "Welcome to Grove",
        preview: "Open Grove to write your first note.",
        body: ["Write your first note, or create a notebook for a project."],
        action: "Open Grove",
        path: "/app",
      };
    case "connection_approved":
      return {
        subject: "A connection was approved in Grove",
        heading: "Connection approved",
        preview: "You can review its permissions in Settings.",
        body: [
          "A connection was granted access to your Grove.",
          "If you didn’t approve this, review your connections and revoke any access you don’t recognize.",
        ],
        action: "Review connections",
        path: "/app/settings/connections",
      };
    case "connection_revoked":
      return {
        subject: "A connection was revoked in Grove",
        heading: "Connection revoked",
        preview: "The connection can no longer access your Grove.",
        body: [
          "A connection’s access to your Grove was revoked. Revoking a connection does not delete your notes.",
          "Review your connections to see which still have access.",
        ],
        action: "Review connections",
        path: "/app/settings/connections",
      };
    case "deletion_requested":
      return {
        subject: "We received your Grove account deletion request",
        heading: "Account deletion requested",
        preview: "Access to your Grove account is off.",
        body: [
          "Access to your Grove account is off. This email confirms your request; it does not confirm that cleanup is complete.",
          "If you didn’t request this, contact support.",
        ],
        action: "Contact support",
        path: "/support",
      };
    case "export_ready":
      return {
        subject: "Your Grove export is ready",
        heading: "Your export is ready",
        preview: "Sign in to view and download your export.",
        body: [
          "Sign in to the Grove account that requested the export to download it.",
        ],
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

// Email-safe counterparts of globals.css's interface stack, brand ink, and
// dashboard.css's paper/muted/line/sage tokens. Keep styles inline: mail clients
// cannot load the app stylesheet, and no remote assets are needed to read mail.
const style = {
  font: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif",
  paper: "#fbfcfb",
  ink: "#284c38",
  muted: "#535f57",
  line: "#dce2dc",
  sage: "#edf0ec",
};

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
      m.heading,
      ...m.body,
      m.detail,
      `${m.action}: ${link}`,
      footer,
    ]
      .filter(Boolean)
      .join("\n\n"),
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escape(m.subject)}</title>
<style>a:focus-visible{outline:2px solid ${style.ink};outline-offset:4px}</style>
</head>
<body style="margin:0;padding:0;background:${style.paper};color:${style.ink};font-family:${style.font}">
<div aria-hidden="true" style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preview ? sample : escape(m.preview)}</div>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${style.paper};border-collapse:collapse">
<tr><td align="center" style="padding:32px 20px">
<!--[if mso]><table role="presentation" width="560" border="0" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;table-layout:fixed;border-collapse:collapse">
<tr><td style="padding:0 0 28px;font-family:${style.font};color:${style.ink};font-size:20px;font-weight:600;line-height:24px">Grove</td></tr>
<tr><td style="padding:0 0 28px;font-family:${style.font};color:${style.ink}">
${preview ? `<p style="margin:0 0 24px;padding:12px;background:${style.sage};border-radius:5px;color:${style.muted};font-size:13px;line-height:20px">${sample}</p>` : ""}
<h1 style="margin:0 0 16px;font-size:24px;font-weight:600;line-height:30px;letter-spacing:-0.5px;color:${style.ink}">${escape(m.heading)}</h1>
${m.body.map((paragraph) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px">${escape(paragraph)}</p>`).join("\n")}
${m.detail ? `<p style="margin:0 0 24px;color:${style.muted};font-size:14px;line-height:22px">${escape(m.detail)}</p>` : ""}
<p style="margin:8px 0 0"><a class="email-action" href="${escape(link)}" style="display:inline-block;background:${style.ink};color:#ffffff;border:12px solid ${style.ink};border-left-width:18px;border-right-width:18px;border-radius:5px;font-size:14px;font-weight:600;line-height:20px;text-decoration:none">${m.action}</a></p>
<p style="margin:24px 0 0;color:${style.muted};font-size:13px;line-height:20px">If the button doesn’t work, open this address:<br><a href="${escape(link)}" style="color:${style.ink};text-decoration:underline;overflow-wrap:anywhere;word-break:break-all">${escape(link)}</a></p>
</td></tr>
<tr><td style="border-top:1px solid ${style.line};padding:20px 0 0;font-family:${style.font};color:${style.muted};font-size:13px;line-height:20px">${footer}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`,
  };
}
