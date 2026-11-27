import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createDatabase, tenant, withDatabaseSignal } from "@lib/database";
import { InferenceError, type Embedder } from "@lib/ai";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import {
  listSchema,
  recallSchema,
  rememberSchema,
} from "@lib/shared/contracts";
import { withTelemetry, type TelemetrySink } from "@lib/telemetry/context";
import { configureBillingQuotas } from "@lib/memory";
import { resourceLimits } from "@lib/shared/billing";
import { projectProperties } from "../../lib/telemetry/src/policy.ts";

const db = createDatabase(process.env.TEST_DATABASE_URL!);
const vector = [1, ...Array<number>(383).fill(0)];
after(() => db.destroy());
async function fixture(embed: Embedder["embed"]) {
  const subject = randomUUID();
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const owner = sessionPrincipal(rows[0].id, subject);
  const embedder: Embedder = {
    profile: `synthetic-${randomUUID()}`,
    model: "synthetic",
    dimensions: 384,
    embed,
  };
  const service = new MemoryService(db, "synthetic-retrieval-secret", embedder);
  const note = await service.remember(
    owner,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "# Lantern\nSynthetic private orchard evidence.",
    }),
  );
  return { owner, service, note, embedder };
}

test("bounded query inference accepts a healthy one-second response instead of silently degrading at 850ms", async () => {
  let calls = 0;
  const f = await fixture(async (_text, _purpose, options) => {
    calls++;
    await delay(1050, undefined, { signal: options?.signal });
    return vector;
  });
  const admin = createDatabase(process.env.TEST_MIGRATION_DATABASE_URL!);
  try {
    await admin("embedding_profiles").insert({
      id: f.embedder.profile,
      model: f.embedder.model,
      dimensions: f.embedder.dimensions,
    });
    await tenant(db, f.owner.accountId, (trx) =>
      trx("memory_embeddings").insert({
        accountId: f.owner.accountId,
        memoryId: f.note.id,
        version: 1,
        profile: f.embedder.profile,
        embedding: JSON.stringify(vector),
      }),
    );
  } finally {
    await admin.destroy();
  }
  const first = await f.service.list(
    f.owner,
    listSchema.parse({ query: "cultivation", searchMode: "hybrid" }),
  );
  assert.equal(first.searchMode, "hybrid");
  assert.equal(first.items[0]?.id, f.note.id);
  const repeat = await f.service.list(
    f.owner,
    listSchema.parse({ query: "cultivation", searchMode: "hybrid" }),
  );
  assert.equal(repeat.searchMode, "hybrid");
  assert.equal(calls, 1, "the repeated embedding must reuse the exact cache");
  assert.equal(first.matches?.[f.note.id]?.kind, "semantic");
});

test("incompatible query vectors preserve keyword results with a profile diagnostic", async () => {
  const f = await fixture(async () => [1, 0]);
  const result = await f.service.list(
    f.owner,
    listSchema.parse({ query: "orchard", searchMode: "hybrid" }),
  );
  assert.equal(result.retrieval?.reason, "embedding_profile_mismatch");
  assert.equal(result.items[0]?.id, f.note.id);
});

test("the revised query deadline remains bounded and preserves lexical evidence", async () => {
  const f = await fixture(async (_text, _purpose, options) => {
    try {
      await delay(10_000, undefined, { signal: options?.signal });
    } catch {
      throw new InferenceError("provider_timeout");
    }
    return vector;
  });
  const started = performance.now();
  const result = await f.service.list(
    f.owner,
    listSchema.parse({ query: "orchard", searchMode: "hybrid" }),
  );
  assert(
    performance.now() - started < 8000,
    "the provider must not run to its ten-second delay",
  );
  assert.equal(result.retrieval?.reason, "provider_timeout");
  assert.equal(result.items[0]?.id, f.note.id);
});

test("list and recall expose sanitized timeout degradation while retaining keyword results", async () => {
  const f = await fixture(async () => {
    throw new InferenceError("provider_timeout");
  });
  const events: unknown[] = [];
  const sink: TelemetrySink = {
    capture(event, properties) {
      if (event === ("retrieval_completed" as string)) events.push(properties);
    },
    operation() {},
  };
  const list = await withTelemetry(sink, () =>
    f.service.list(
      f.owner,
      listSchema.parse({ query: "orchard", searchMode: "hybrid" }),
    ),
  );
  assert.equal(list.searchMode, "lexical");
  assert.equal(list.items[0]?.id, f.note.id);
  assert.deepEqual((list as { retrieval?: unknown }).retrieval, {
    requested: "hybrid",
    executed: "lexical",
    reason: "provider_timeout",
  });
  const recalled = await withTelemetry(sink, () =>
    f.service.recall(
      f.owner,
      recallSchema.parse({ query: "orchard", includePersonal: true }),
    ),
  );
  assert.equal(recalled.mode, "lexical");
  assert.equal(
    (recalled as { retrieval?: { reason: string } }).retrieval?.reason,
    "provider_cooling_down",
  );
  assert.equal(events.length, 2);
  assert.doesNotMatch(
    JSON.stringify(events),
    /orchard|Lantern|synthetic|account|secret/i,
  );
});

test("explicit keyword search does not call a provider or masquerade as degraded semantic work", async () => {
  const f = await fixture(async () => {
    throw new Error("Must not call inference");
  });
  const result = await f.service.list(
    f.owner,
    listSchema.parse({ query: "orchard", searchMode: "lexical" }),
  );
  assert.deepEqual((result as { retrieval?: unknown }).retrieval, {
    requested: "lexical",
    executed: "lexical",
  });
});

test("exhausted semantic allowance reports quota fallback, not a pinned cursor", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return vector;
  });
  configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: [],
    resourceLimits: {
      free: { ...resourceLimits.free, recall: 0 },
      pro: resourceLimits.pro,
    },
  });
  try {
    const result = await f.service.list(
      f.owner,
      listSchema.parse({ query: "orchard", searchMode: "hybrid" }),
    );
    assert.equal(result.items[0]?.id, f.note.id);
    assert.equal(result.retrieval?.reason, "recall_limit");
    assert.equal(calls, 0);
  } finally {
    configureBillingQuotas(db, { enabled: async () => false, priceIds: [] });
  }
});

test("unknown provider failures stay private and explicit cancellation never becomes lexical success", async () => {
  const f = await fixture(async () => {
    throw new Error("PRIVATE provider endpoint and query");
  });
  const result = await f.service.recall(
    f.owner,
    recallSchema.parse({ query: "orchard", includePersonal: true }),
  );
  assert.equal(result.retrieval?.reason, "query_unavailable");
  assert.doesNotMatch(JSON.stringify(result.retrieval), /PRIVATE/);
  const signal = AbortSignal.abort(new Error("cancelled by caller"));
  await assert.rejects(
    f.service.recall(f.owner, recallSchema.parse({ query: "orchard" }), signal),
    /cancelled by caller/,
  );
});

test("retrieval telemetry projects only bounded approved values", () => {
  assert.deepEqual(
    projectProperties({
      retrieval_mode: "lexical",
      retrieval_reason: "provider_timeout",
      query: "PRIVATE",
      accountId: "PRIVATE",
      duration_ms: Infinity,
    }),
    { retrieval_mode: "lexical", retrieval_reason: "provider_timeout" },
  );
  assert.deepEqual(
    projectProperties({
      retrieval_mode: "PRIVATE",
      retrieval_reason: "PRIVATE",
    }),
    {},
  );
});

test("ambient request cancellation does not emit a completed lexical fallback", async () => {
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const f = await fixture(async (_text, _purpose, options) => {
    start();
    await delay(10_000, undefined, { signal: options?.signal });
    return vector;
  });
  const controller = new AbortController();
  let completions = 0;
  const sink: TelemetrySink = {
    capture(event) {
      if (event === "retrieval_completed") completions++;
    },
    operation() {},
  };
  const result = withTelemetry(sink, () =>
    withDatabaseSignal(controller.signal, () =>
      f.service.list(
        f.owner,
        listSchema.parse({ query: "orchard", searchMode: "hybrid" }),
      ),
    ),
  );
  await started;
  controller.abort(new Error("cancelled ambient request"));
  await assert.rejects(result);
  assert.equal(completions, 0);
});
