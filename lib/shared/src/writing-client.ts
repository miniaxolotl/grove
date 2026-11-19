import type { WritingResult, WritingSettings } from "./writing-settings.ts";

export type HarperRequest =
  | { type: "boot"; wasm: string }
  | { type: "check"; id: number; text: string; settings: WritingSettings };
export type HarperReply = { id: number; result?: WritingResult };
type WorkerPort = Pick<
  Worker,
  "postMessage" | "terminate" | "addEventListener" | "removeEventListener"
>;
const unavailable = () => new Error("Local writing checks are unavailable.");

export function createHarperClient(worker: WorkerPort) {
  const pending = new Map<
    number,
    { resolve: (result: WritingResult) => void; reject: (err: Error) => void }
  >();
  let sequence = 0,
    closed = false;
  const reply = (event: MessageEvent<HarperReply>) => {
    const { id, result } = event.data;
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (result) request.resolve(result);
    else request.reject(unavailable());
  };
  const dispose = () => {
    if (closed) return;
    closed = true;
    worker.removeEventListener("message", reply);
    worker.removeEventListener("error", dispose);
    worker.removeEventListener("messageerror", dispose);
    worker.terminate();
    for (const request of pending.values()) request.reject(unavailable());
    pending.clear();
  };
  worker.addEventListener("message", reply);
  worker.addEventListener("error", dispose);
  worker.addEventListener("messageerror", dispose);
  return {
    check(text: string, settings: WritingSettings): Promise<WritingResult> {
      if (closed) return Promise.reject(unavailable());
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          worker.postMessage({
            type: "check",
            id,
            text: text.slice(0, 6001),
            settings,
          } satisfies HarperRequest);
        } catch {
          dispose();
        }
      });
    },
    dispose,
  };
}
