import type { Knex } from "@lib/database";

export type RolloutEnvironment = Record<string, string | undefined>;
export interface RolloutDependencies {
  connect?: (
    url: string,
    options?: {
      ssl?: boolean;
      max?: number;
      acquireTimeoutMs?: number;
      statementTimeoutMs?: number;
      log?: Knex.Config["log"];
    },
  ) => Knex;
  registry?: { name: string; config?: { transaction?: boolean } }[];
  assertCurrent?: () => unknown | Promise<unknown>;
  assertSource?: (env: RolloutEnvironment) => unknown | Promise<unknown>;
  wait?: (milliseconds: number) => unknown | Promise<unknown>;
  now?: () => number;
  onRetry?: (event: {
    attempt: number;
    nextAttempt: number;
    code: string;
    stage: string;
    delayMs: number;
  }) => void;
}
export interface MigrationReceipt {
  sourceSha: string;
  tag: string;
  status: "unchanged" | "completed";
  applied: string[];
  attempts: number;
}
export function rolloutMigrations(
  env: RolloutEnvironment,
  dependencies?: RolloutDependencies,
): Promise<MigrationReceipt>;
