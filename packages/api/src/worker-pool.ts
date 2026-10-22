/** Shared by broker consumers and database fallback, including reconnect overlap. */
export class WorkerPool {
  active = 0;
  private pending = new Set<Promise<unknown>>();
  constructor(readonly capacity: number) {}
  async run(work: () => Promise<boolean>): Promise<boolean> {
    if (this.active >= this.capacity) return false;
    this.active++;
    const task = Promise.resolve().then(work);
    this.pending.add(task);
    try {
      return await task;
    } finally {
      this.pending.delete(task);
      this.active--;
    }
  }
  async drain() {
    await Promise.allSettled([...this.pending]);
  }
}
