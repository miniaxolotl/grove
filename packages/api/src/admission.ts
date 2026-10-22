import { GroveError } from "@lib/shared/contracts";

const busy = () =>
  new GroveError("overloaded", "Grove is busy. Try again shortly.", 503);

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
