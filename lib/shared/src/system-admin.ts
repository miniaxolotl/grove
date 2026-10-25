import { z } from "zod";
import { uuidSchema } from "@lib/shared/contracts";
import type { BillingMetric } from "@lib/shared/billing";

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
  kind: "change" | "bootstrap" | "support";
  reason: string;
  before: AdminAccount & { settings?: AdminSettings };
  after: AdminAccount & { settings?: AdminSettings };
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

export const adminSettingsSchema = z
  .object({
    captureEnabled: z.boolean(),
    recallEnabled: z.boolean(),
    suspended: z.boolean(),
    supportNote: z.string().max(500),
  })
  .strict();
export type AdminSettings = z.infer<typeof adminSettingsSchema>;
export type AdminSupportState = {
  account: AdminAccount;
  settings: AdminSettings;
};
export type AdminDetails = AdminSupportState & {
  usage: {
    dailyResetAt: string;
    monthlyResetAt: string;
    metrics: Record<BillingMetric, { today: number; month: number }>;
  };
  counts: { notes: number; notebooks: number; connections: number };
};
export type AdminPage<T = AdminAccount> = {
  accounts: T[];
  total: number;
  nextCursor: string | null;
};
export const adminSupportSchema = z
  .object({
    accountId: uuidSchema,
    operationId: uuidSchema,
    expectedVersion: z.number().int().min(0),
    expectedSettings: adminSettingsSchema,
    settings: adminSettingsSchema,
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export type AdminSupportChange = z.infer<typeof adminSupportSchema>;
export const adminDetailsSchema = z.object({ accountId: uuidSchema }).strict();
export const adminBrowseSchema = z
  .object({ after: uuidSchema.optional() })
  .strict();
