import { GroveError } from "@lib/shared/contracts";

const busy = () =>
  new GroveError("overloaded", "Grove is busy. Try again shortly.", 503);

/** Buffer at most one small API body, only after admission. The stream signal
 * interrupts stalled reads; received bytes, not Content-Length, enforce the cap. */
export async function admittedRequest(request: Request, signal: AbortSignal) {
  if (!request.body) return request;
  const maximum = 128 * 1024;
  const tooLarge = () =>
    new GroveError("too_large", "Request body is too large", 413);
  if (Number(request.headers.get("content-length")) > maximum) throw tooLarge();
  let size = 0;
  const limited = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > maximum) throw tooLarge();
        controller.enqueue(chunk);
      },
    }),
    { signal },
  );
  const body = await new Response(limited).arrayBuffer();
  signal.throwIfAborted();
  return new Request(request, { body, signal });
}

/** FIFO, bounded, cancellable waiting. A permit stays owned until work settles. */
export class Admission {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(
    private limit: number,
    private queued: number,
    private waitMs: number,
  ) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.active < this.limit) {
      this.active++;
      return this.release();
    }
    if (this.waiting.length >= this.queued) throw busy();
    return new Promise((resolve, reject) => {
      const remove = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        const index = this.waiting.indexOf(ready);
        if (index >= 0) this.waiting.splice(index, 1);
      };
      const ready = () => {
        remove();
        this.active++;
        resolve(this.release());
      };
      const abort = () => {
        remove();
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        remove();
        reject(busy());
      }, this.waitMs);
      this.waiting.push(ready);
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  private release() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiting[0]?.();
    };
  }
}

export type ApiCapacity = {
  concurrency: number;
  queued: number;
  queueTimeoutMs: number;
  requestTimeoutMs: number;
  interactiveConcurrency: number;
  interactiveTimeoutMs: number;
};
export const defaultCapacity: ApiCapacity = {
  concurrency: 32,
  queued: 32,
  queueTimeoutMs: 250,
  requestTimeoutMs: 10000,
  interactiveConcurrency: 4,
  interactiveTimeoutMs: 90000,
};
