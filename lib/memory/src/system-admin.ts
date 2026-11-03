import { GroveError, type Principal } from "@lib/shared/contracts";
import {
  adminChangeSchema,
  adminDetailsSchema,
  adminBrowseSchema,
  adminSupportSchema,
  adminUsageReportSchema,
  emptyUsageReportMetrics,
  type AdminUsageReport,
  type AdminDetails,
  type AdminPage,
  type AdminSupportState,
  type AdminAccount,
  type AdminAudit,
  type SystemRole,
} from "@lib/shared/system-admin";
import type { Knex } from "@lib/database";
import type { MemoryService } from "./index.ts";

const denied = () =>
  new GroveError(
    "system_admin_required",
    "System administrator access is required",
    403,
  );
export class SystemAdministration {
  constructor(private service: MemoryService) {}

  private access<T>(
    principal: Principal,
    run: (trx: Knex.Transaction) => Promise<T>,
    serialize = true,
  ) {
    const sessionId = principal.sessionId;
    if (principal.type !== "session" || !sessionId)
      return Promise.reject(denied());
    return this.service
      .access(principal, "admin", async ({ trx, account }) => {
        if (account.clerkSubject !== principal.subject) throw denied();
        // Session revocation can arrive while another admin holds the global lock.
        // Recheck after that wait; the SQL functions then recheck the current role.
        if (serialize) {
          await trx.raw("SELECT pg_advisory_xact_lock(68142025)");
          if (
            (
              await trx.raw("SELECT grove_session_revoked(?) AS revoked", [
                sessionId,
              ])
            ).rows[0].revoked
          )
            throw new GroveError("unauthorized", "Session revoked", 401);
        }
        return run(trx);
      })
      .catch((error: unknown) => {
        const code = (error as { code?: string }).code;
        if (code === "GA001") throw denied();
        if (code === "GA002")
          throw new GroveError(
            "invalid_request",
            "Check the request fields",
            400,
          );
        if (code === "GA003" || code === "GA005")
          throw new GroveError(
            code === "GA003" ? "operation_conflict" : "admin_version_conflict",
            "This account changed. Refresh and review it again.",
            409,
          );
        if (code === "GA004")
          throw new GroveError(
            "account_unavailable",
            "This account is unavailable",
            404,
          );
        if (code === "GA006")
          throw new GroveError(
            "last_system_admin",
            "Keep at least one active system administrator",
            409,
          );
        throw error;
      });
  }
  status(principal: Principal): Promise<{ role: SystemRole }> {
    return this.access(
      principal,
      async (trx) => ({
        role:
          (
            await trx("account_administration")
              .where({ accountId: principal.accountId })
              .first("role")
          )?.role ?? "user",
      }),
      false,
    );
  }
  accounts(principal: Principal, subjects?: string[]): Promise<AdminAccount[]> {
    return this.access(
      principal,
      async (trx) =>
        (
          await trx.raw("SELECT grove_admin_accounts(?::text[]) AS result", [
            subjects ?? null,
          ])
        ).rows[0].result,
    );
  }
  async change(principal: Principal, raw: unknown): Promise<AdminAccount> {
    const input = adminChangeSchema.parse(raw);
    return this.access(
      principal,
      async (trx) =>
        (
          await trx.raw(
            "SELECT grove_admin_change(?::uuid,?::uuid,?,?,?,?) AS result",
            [
              input.accountId,
              input.operationId,
              input.expectedVersion,
              input.role,
              input.access,
              input.reason,
            ],
          )
        ).rows[0].result,
    );
  }
  audit(principal: Principal): Promise<AdminAudit[]> {
    return this.access(
      principal,
      async (trx) =>
        (await trx.raw("SELECT grove_admin_audit() AS result")).rows[0].result,
    );
  }
  browse(principal: Principal, raw: unknown): Promise<AdminPage> {
    return this.access(principal, async (trx) => {
      await trx.raw("SELECT grove_admin_accounts(ARRAY[]::text[])");
      const input = adminBrowseSchema.parse(raw);
      return (
        await trx.raw("SELECT grove_admin_browse(?::uuid) AS result", [
          input.after ?? null,
        ])
      ).rows[0].result;
    });
  }
  details(principal: Principal, raw: unknown): Promise<AdminDetails> {
    return this.access(principal, async (trx) => {
      await trx.raw("SELECT grove_admin_accounts(ARRAY[]::text[])");
      const input = adminDetailsSchema.parse(raw);
      return (
        await trx.raw("SELECT grove_admin_details(?::uuid) AS result", [
          input.accountId,
        ])
      ).rows[0].result;
    });
  }
  usageReport(principal: Principal, raw: unknown): Promise<AdminUsageReport> {
    return this.access(principal, async (trx) => {
      await trx.raw("SELECT grove_admin_accounts(ARRAY[]::text[])");
      const input = adminUsageReportSchema.parse(raw);
      const report: AdminUsageReport = (
        await trx.raw(
          "SELECT grove_admin_usage_report(?::date,?::date,?::uuid) AS result",
          [input.from ?? null, input.to ?? null, input.after ?? null],
        )
      ).rows[0].result;
      report.totals.metrics = {
        ...emptyUsageReportMetrics(),
        ...report.totals.metrics,
      };
      report.users.accounts = report.users.accounts.map((user) => ({
        ...user,
        metrics: { ...emptyUsageReportMetrics(), ...user.metrics },
      }));
      return report;
    });
  }
  support(principal: Principal, raw: unknown): Promise<AdminSupportState> {
    return this.access(principal, async (trx) => {
      await trx.raw("SELECT grove_admin_accounts(ARRAY[]::text[])");
      const input = adminSupportSchema.parse(raw);
      return (
        await trx.raw(
          "SELECT grove_admin_support_change(?::uuid,?::uuid,?,?::jsonb,?::jsonb,?) AS result",
          [
            input.accountId,
            input.operationId,
            input.expectedVersion,
            JSON.stringify(input.expectedSettings),
            JSON.stringify(input.settings),
            input.reason,
          ],
        )
      ).rows[0].result;
    });
  }
}
