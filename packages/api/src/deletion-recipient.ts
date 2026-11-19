import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { Principal } from "@lib/shared/contracts";
import { z } from "zod";

const purpose = (accountId: string, id: string) =>
  Buffer.from(`grove:deletion_requested:v1:${accountId}:${id}`);
type Identity = { accountId: string; id: string; snapshot: Buffer };

/** Only the authenticated owner subject is used; form fields never select the recipient. */
export function clerkDeletionRecipient(secret: string, send = fetch) {
  return async (subject: string) => {
    const response = await send(
      `https://api.clerk.com/v1/users/${encodeURIComponent(subject)}`,
      {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(1200),
        redirect: "error",
      },
    );
    if (!response.ok) return null;
    const user = (await response.json()) as {
      id: string;
      primary_email_address_id: string | null;
      email_addresses: {
        id: string;
        email_address: string;
        verification?: { status: string } | null;
      }[];
    };
    return user.id === subject
      ? (user.email_addresses.find(
          (a) =>
            !!user.primary_email_address_id &&
            a.id === user.primary_email_address_id &&
            a.verification?.status === "verified",
        )?.email_address ?? null)
      : null;
  };
}

export async function prepareDeletionReceipt(
  principal: Principal,
  config?: {
    key?: string;
    recipient: (subject: string) => Promise<string | null>;
  },
) {
  if (!config || principal.type !== "session") return undefined;
  if (!config.key) {
    console.info(JSON.stringify({ code: "receipt_key_unavailable" }));
    return undefined;
  }
  try {
    const to = await config.recipient(principal.subject);
    if (!to || !z.email().max(254).safeParse(to).success) throw new Error();
    const id = randomUUID(),
      iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(config.key, "hex"),
      iv,
    );
    cipher.setAAD(purpose(principal.accountId, id));
    const bytes = Buffer.concat([cipher.update(to, "utf8"), cipher.final()]);
    return { id, snapshot: Buffer.concat([iv, cipher.getAuthTag(), bytes]) };
  } catch {
    console.info(JSON.stringify({ code: "receipt_recipient_unavailable" }));
    return undefined;
  }
}

export function openDeletionRecipient(key: string, row: Identity) {
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    row.snapshot.subarray(0, 12),
  );
  cipher.setAAD(purpose(row.accountId, row.id));
  cipher.setAuthTag(row.snapshot.subarray(12, 28));
  return Buffer.concat([
    cipher.update(row.snapshot.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
