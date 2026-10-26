import { createClerkClient } from "@clerk/backend";
import { GroveError, type Principal } from "@lib/shared/contracts";
import type {
  AdminAccount,
  AdminPage,
  AdminUser,
} from "@lib/shared/system-admin";
import { SystemAdministration, type MemoryService } from "@lib/memory";
import { z } from "zod";

export interface AdminDirectory {
  find(email: string): Promise<string[]>;
  users(
    subjects: string[],
  ): Promise<{ subject: string; name: string | null; email: string | null }[]>;
}
export function clerkAdminDirectory(secretKey: string): AdminDirectory {
  const clerk = createClerkClient({ secretKey });
  return {
    async find(email) {
      const result = await clerk.users.getUserList({
        emailAddress: [email],
        limit: 30,
      });
      return result.data.map((user) => user.id);
    },
    async users(subjects) {
      if (!subjects.length) return [];
      const result = await clerk.users.getUserList({
        userId: subjects,
        limit: 30,
      });
      return result.data.map((user) => ({
        subject: user.id,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
        email:
          user.emailAddresses.find(
            (email) => email.id === user.primaryEmailAddressId,
          )?.emailAddress ?? null,
      }));
    },
  };
}
export class AdminAccounts {
  readonly administration: SystemAdministration;
  constructor(
    service: MemoryService,
    private directory?: AdminDirectory,
  ) {
    this.administration = new SystemAdministration(service);
  }
  async search(principal: Principal, raw: unknown): Promise<AdminUser[]> {
    // Authorization precedes any identity-provider lookup, including invalid input.
    await this.administration.accounts(principal, []);
    const { query } = z
      .object({ query: z.string().trim().max(254) })
      .strict()
      .parse(raw);
    let subjects: string[] | undefined;
    if (query.startsWith("user_") && /^user_[A-Za-z0-9_-]{1,128}$/.test(query))
      subjects = [query];
    else if (query) {
      if (!z.email().safeParse(query).success)
        throw new GroveError(
          "invalid_request",
          "Search by exact email or user ID",
          400,
        );
      if (!this.directory)
        throw new GroveError(
          "unavailable",
          "Account search is unavailable",
          503,
        );
      subjects = await this.directory.find(query);
    }
    const accounts = await this.administration.accounts(principal, subjects);
    return this.identities(principal, accounts);
  }
  async browse(
    principal: Principal,
    raw: unknown,
  ): Promise<AdminPage<AdminUser>> {
    const page = await this.administration.browse(principal, raw);
    return {
      ...page,
      accounts: await this.identities(principal, page.accounts),
    };
  }
  private async identities(
    principal: Principal,
    accounts: AdminAccount[],
  ): Promise<AdminUser[]> {
    const identities = new Map(
      (
        (await this.directory?.users(
          accounts.map((account) => account.subject),
        )) ?? []
      ).map((user) => [user.subject, user]),
    );
    await this.administration.accounts(principal, []);
    return accounts.map((account) => ({
      ...account,
      name: identities.get(account.subject)?.name ?? null,
      email: identities.get(account.subject)?.email ?? null,
    }));
  }
}
