import { createHarperClient } from "@lib/shared/writing-client";

/** Only static same-origin assets leave the page; text stays in a dedicated worker. */
export function openWritingChecker() {
  const worker = new Worker("/proofing/worker.js?wasm=/proofing/harper.wasm", {
    type: "module",
  });
  return createHarperClient(worker);
}
