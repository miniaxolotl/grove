import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { JobBroker } from "../../packages/api/src/broker.ts";
import { WorkerPool } from "../../packages/api/src/worker-pool.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test(
  "broker lanes progress independently, reconnect and drain through shared capacity",
  { skip: !process.env.TEST_AMQP_URL, timeout: 30000 },
  async () => {
    const entered = deferred(),
      release = deferred(),
      indexed = deferred();
    const bulkId = randomUUID(),
      indexId = randomUUID();
    const pool = new WorkerPool(1);
    const seen = new Set<string>();
    const broker = new JobBroker(
      process.env.TEST_AMQP_URL!,
      { bulk: 1, indexing: 1 },
      async (job, lane) => {
        if (job.id === bulkId)
          await pool.run(async () => {
            entered.resolve();
            await release.promise;
            seen.add(job.id);
            return true;
          });
        if (job.id === indexId) {
          assert.equal(lane, "indexing");
          seen.add(job.id);
          indexed.resolve();
        }
      },
      false,
    );
    try {
      await broker.connect();
      await broker.publish({ kind: "task", id: bulkId }, "bulk");
      await entered.promise;
      assert.equal(
        await pool.run(async () => {
          throw new Error("fallback exceeded capacity");
        }),
        false,
      );
      await broker.publish({ kind: "memory", id: indexId }, "indexing");
      await indexed.promise;
      assert(!seen.has(bulkId));
      let closed = false;
      const closing = broker.close().then(() => {
        closed = true;
      });
      assert.equal(closed, false);
      release.resolve();
      await closing;
      assert(seen.has(bulkId));
      assert.equal(pool.active, 0);
      await assert.rejects(
        broker.publish({ kind: "task", id: bulkId }, "bulk"),
        /unavailable/,
      );
    } finally {
      release.resolve();
      await broker.close();
    }
    const delivered = deferred();
    const reconnect = new JobBroker(
      process.env.TEST_AMQP_URL!,
      { indexing: 1 },
      async () => delivered.resolve(),
      false,
    );
    try {
      await reconnect.connect();
      await reconnect.disconnect();
      assert.equal(reconnect.connected, false);
      await reconnect.connect();
      await reconnect.publish({ kind: "memory", id: randomUUID() }, "indexing");
      await delivered.promise;
    } finally {
      await reconnect.close();
    }
  },
);
