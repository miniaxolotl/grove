// Offline by default. The same synthetic letters can be submitted to an explicitly
// selected review inbox; no application database or customer account is used.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { renderEmail } from "../../packages/api/src/email-template.ts";

const [command, target] = process.argv.slice(2);
if (!["render", "send"].includes(command) || !target)
  throw Error(
    "Usage: node scripts/testing/email-previews.mjs render DIRECTORY | send REVIEW_ADDRESS",
  );
const siteUrl = process.env.SITE_URL || "https://usegrove.cloud";
const events = [
  { kind: "welcome" },
  { kind: "connection_approved" },
  { kind: "connection_revoked" },
  {
    kind: "export_ready",
    taskId: "00000000-0000-4000-a000-000000000001",
    expiresAt: "2030-03-12T18:00:00Z",
  },
  { kind: "deletion_requested" },
];
if (command === "render") await mkdir(target, { recursive: true });
else if (
  !process.env.RESEND_API_KEY ||
  !/^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/.test(target)
)
  throw Error("A Resend sending key and one review address are required");
for (const event of events) {
  const message = renderEmail(event, siteUrl, true);
  if (command === "render") {
    await writeFile(join(target, `${event.kind}.html`), message.html);
    await writeFile(join(target, `${event.kind}.txt`), message.text);
    continue;
  }
  const body = JSON.stringify({
    from: "Grove <notifications@grovenote.app>",
    to: [target],
    ...message,
  });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `grove-preview-${createHash("sha256").update(body).digest("hex")}`,
    },
    body,
  });
  if (!res.ok)
    throw Error(
      `${event.kind}: Resend HTTP ${res.status}. Re-run with the same inputs within 24 hours to resume.`,
    );
  const { id } = await res.json();
  if (!id) throw Error("Resend acceptance unknown: missing message ID");
  console.log(`${event.kind}: accepted (${id})`);
  // Stay below the provider's default per-second rate limit.
  await new Promise((resolve) => setTimeout(resolve, 600));
}
