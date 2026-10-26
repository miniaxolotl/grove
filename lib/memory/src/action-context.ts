import { AsyncLocalStorage } from "node:async_hooks";

// Internal retrieval belongs to its parent action, not a second recall charge.
// This context is never derived from client input.
const internalRecall = new AsyncLocalStorage<boolean>();
export const withoutRecallCharge = <T>(run: () => T): T =>
  internalRecall.run(true, run);
export const recallIsInternal = () => internalRecall.getStore() === true;
