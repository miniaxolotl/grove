import { nativeBrowser as host, extensionConfig } from "../webextension.ts";
import { checkInWorker } from "./harper.ts";
import type { WritingResult, WritingSettings } from "./core.ts";

// The Chromium MV3 service worker cannot create a Worker. Address only the
// private offscreen document, never broadcast a draft to other extension pages.
type DocumentClient = {
  url: string;
  postMessage(message: unknown, ports: MessagePort[]): void;
};
declare const clients: {
  matchAll(options: {
    type: "window";
    includeUncontrolled: true;
  }): Promise<DocumentClient[]>;
};
let opening: Promise<DocumentClient> | undefined;
async function workerHost() {
  const url = host.runtime.getURL("offscreen.html");
  const find = async () =>
    (
      await clients.matchAll({ type: "window", includeUncontrolled: true })
    ).find((client) => client.url === url);
  const existing = await find();
  if (existing) return existing;
  await host.offscreen!.createDocument({
    url,
    reasons: ["WORKERS"],
    justification: "Run the bundled offline grammar worker outside the editor.",
  });
  const created = await find();
  if (!created) throw new Error("Local writing checks are unavailable.");
  return created;
}

export async function checkLocally(
  text: string,
  settings: WritingSettings,
): Promise<WritingResult> {
  if (extensionConfig.target === "firefox")
    return checkInWorker(text, settings);
  const document = await (opening ??= workerHost().finally(() => {
    opening = undefined;
  }));
  const { port1, port2 } = new MessageChannel();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<WritingResult>((resolve, reject) => {
      const fail = () =>
        reject(new Error("Local writing checks are unavailable."));
      timer = setTimeout(fail, 20000);
      port1.onmessage = (event) => (event.data ? resolve(event.data) : fail());
      port1.onmessageerror = fail;
      document.postMessage({ text, settings }, [port2]);
    });
  } finally {
    clearTimeout(timer);
    port1.close();
    port2.close();
  }
}
