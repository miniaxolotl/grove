import { AsyncLocalStorage } from "node:async_hooks";

const signals = new AsyncLocalStorage<AbortSignal | undefined>();
export const databaseSignal = () => signals.getStore();
export const withDatabaseSignal = <T>(
  signal: AbortSignal | undefined,
  run: () => T,
): T => signals.run(signal, run);
