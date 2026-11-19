import type { Knex } from "@lib/database";
type Transaction = (
  db: Knex,
  run: (trx: Knex.Transaction) => Promise<unknown>,
) => Promise<unknown>;
export function applyLifecycleTransition(
  db: Knex,
  transaction: Transaction,
  publication: unknown,
  parent: unknown,
  command: object,
): Promise<unknown>;
export function verifyLifecycleTransition(
  db: Knex,
  publication: unknown,
  parent: unknown,
  command: object,
): Promise<{
  control: {
    phase: string;
    approvalHash: string | null;
    publicHash: string | null;
  };
}>;
