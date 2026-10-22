import { setTimeout } from "node:timers/promises";
import { tenant, type Knex } from "@lib/database";

export function processingLease(
  db: Knex,
  job: { id: string; accountId: string; leaseId: string },
  parent?: AbortSignal,
) {
  const stop = new AbortController(),
    lost = new AbortController();
  const signal = AbortSignal.any([lost.signal, ...(parent ? [parent] : [])]);
  const pending = (async () => {
    try {
      while (!stop.signal.aborted) {
        await setTimeout(30000, undefined, { signal: stop.signal });
        const count = await tenant(db, job.accountId, (trx) =>
          trx("jobs")
            .where({ id: job.id, leaseId: job.leaseId })
            .where("leaseUntil", ">", trx.fn.now())
            .whereRaw(
              "epoch=(SELECT epoch FROM processing_control WHERE singleton)",
            )
            .whereExists(
              trx("accounts")
                .select("id")
                .where({ id: job.accountId, status: "active" }),
            )
            .update({ leaseUntil: trx.raw("now()+interval '120 seconds'") }),
        );
        if (!count) {
          lost.abort();
          return;
        }
      }
    } catch {
      if (!stop.signal.aborted) lost.abort();
    }
  })();
  return {
    signal,
    close: async () => {
      stop.abort();
      await pending;
    },
  };
}
