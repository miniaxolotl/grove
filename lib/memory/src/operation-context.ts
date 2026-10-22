import { AsyncLocalStorage } from "node:async_hooks";
import { withDatabaseSignal } from "@lib/database";
import type { Principal } from "@lib/shared/contracts";

const operations = new AsyncLocalStorage<
  Map<object, Map<string, Promise<void>>>
>();

/** One external REST request or MCP operation; internal reauthorization is free. */
export function withMemoryOperation<T>(run: () => T, signal?: AbortSignal): T {
  return withDatabaseSignal(signal, () => operations.run(new Map(), run));
}

export async function admitOperation(
  owner: object,
  principal: Principal,
  run: () => Promise<void>,
) {
  const operation = operations.getStore();
  if (!operation) return run();
  let admitted = operation.get(owner);
  if (!admitted) operation.set(owner, (admitted = new Map()));
  const key = JSON.stringify(principal);
  let pending = admitted.get(key);
  if (!pending) admitted.set(key, (pending = run()));
  await pending;
}
