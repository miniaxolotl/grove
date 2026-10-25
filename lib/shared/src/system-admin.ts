import { z } from "zod";
import { uuidSchema } from "@lib/shared/contracts";

export type SystemRole = "user" | "system_admin";
export type AccessGrant = "default" | "pro" | "unlimited";
export type AdminAccount = {
  accountId: string;
  subject: string;
  status: string;
  createdAt: string;
  role: SystemRole;
  access: AccessGrant;
  version: number;
};
export type AdminUser = AdminAccount & {
  name: string | null;
  email: string | null;
};
export type AdminAudit = {
  id: string;
  actorId: string | null;
  accountId: string;
  kind: "change" | "bootstrap";
  reason: string;
  before: AdminAccount;
  after: AdminAccount;
  createdAt: string;
};
export const adminChangeSchema = z
  .object({
    accountId: uuidSchema,
    operationId: uuidSchema,
    expectedVersion: z.number().int().min(0),
    role: z.enum(["user", "system_admin"]),
    access: z.enum(["default", "pro", "unlimited"]),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export type AdminChange = z.infer<typeof adminChangeSchema>;
