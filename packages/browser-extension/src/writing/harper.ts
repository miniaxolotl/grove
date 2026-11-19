import { createHarperClient } from "@lib/shared/writing-client";
import type { WritingSettings } from "./core.ts";
import { nativeBrowser as host } from "../webextension.ts";

let client: ReturnType<typeof createHarperClient> | undefined;

/** Called only inside a private extension document. Never use a host-page URL. */
export async function checkInWorker(text: string, settings: WritingSettings) {
  if (!client) {
    const entry = new URL(host.runtime.getURL("harper-worker.js"));
    entry.searchParams.set("wasm", host.runtime.getURL("harper.wasm"));
    client = createHarperClient(new Worker(entry, { type: "module" }));
  }
  const current = client;
  try {
    return await current.check(text, settings);
  } catch {
    if (client === current) {
      client = undefined;
      current.dispose();
    }
    throw new Error("Local writing checks are unavailable.");
  }
}
