import { GroveError, type Principal } from "@lib/shared/contracts";
import {
  adminChangeSchema,
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
  ) {
    if (principal.type !== "session" || !principal.sessionId)
      return Promise.reject(denied());
    return this.service
      .access(principal, "admin", async ({ trx, account }) => {
        if (account.clerkSubject !== principal.subject) throw denied();
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
    return this.access(principal, async (trx) => ({
      role:
        (
          await trx("account_administration")
            .where({ accountId: principal.accountId })
            .first("role")
        )?.role ?? "user",
    }));
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
}
