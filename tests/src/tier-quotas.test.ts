import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createDatabase, tenant, type Knex } from "@lib/database";
import { billingLimits } from "@lib/shared/billing";
import { rememberSchema } from "@lib/shared/contracts";
import { budgetedInference } from "../../lib/memory/src/processing.ts";
import * as memory from "@lib/memory";
import { localArtifacts } from "../../packages/api/src/artifacts.ts";
import { mp3Fixture } from "./fixtures/speech-audio.ts";
import { mp3DurationMs } from "@lib/ai";

const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!ownerUrl || !new URL(ownerUrl).pathname.endsWith("_test"))
  throw new Error("Use a disposable test database");
const authority = createDatabase(ownerUrl);
const name = `grove_tiers_${randomUUID().replaceAll("-", "")}_test`;
let db: Knex, worker: Knex, admin: Knex, root: string;
let store: ReturnType<typeof localArtifacts>;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = (url: string) => {
    const parsed = new URL(url);
    parsed.pathname = `/${name}`;
    return parsed.href;
  };
  admin = createDatabase(target(ownerUrl));
  await admin.migrate.latest();
  db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  root = await mkdtemp("/tmp/opencode/grove-tier-quotas-");
  store = localArtifacts(root);
  await store.ready!();
});
after(async () => {
  await Promise.all([db?.destroy(), worker?.destroy(), admin?.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
  await authority.destroy();
  if (root) await rm(root, { recursive: true, force: true });
});
async function account(pro = false) {
  const subject = `tiers_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = memory.sessionPrincipal(rows[0].id, subject);
  if (pro)
    await tenant(db, principal.accountId, async (trx) => {
      await trx("billing_customers").insert({
        accountId: principal.accountId,
        customerId: `cus_${principal.accountId}`,
      });
      await trx("billing_subscriptions").insert({
        accountId: principal.accountId,
        customerId: `cus_${principal.accountId}`,
        id: `sub_${principal.accountId}`,
        priceId: "price_pro",
        status: "active",
        periodEnd: new Date(Date.now() + 86400000),
      });
    });
  return principal;
}
function configure(enabled = true, synthesis?: number) {
  const configuration = {
    enabled: async () => enabled,
    priceIds: ["price_pro"],
    ...(synthesis === undefined
      ? {}
      : {
          limits: {
            free: {
              ...billingLimits.free,
              synthesis: { daily: null, monthly: synthesis },
            },
            pro: {
              ...billingLimits.pro,
              synthesis: { daily: null, monthly: synthesis },
            },
          },
        }),
  };
  memory.configureBillingQuotas(db, configuration);
  memory.configureBillingQuotas(worker, configuration);
}

for (const pro of [false, true])
  test(`${pro ? "Pro" : "Free"} generation reaches its new daily boundary across API/worker without charging embeddings to it`, async () => {
    configure();
    const a = await account(pro),
      limit = billingLimits[pro ? "pro" : "free"].generation.daily!;
    await tenant(db, a.accountId, (trx) =>
      trx("inference_usage").insert({
        accountId: a.accountId,
        role: "generation",
        requests: limit - 1,
      }),
    );
    let calls = 0;
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        budgetedInference(
          index % 2 ? db : worker,
          a.accountId,
          "generation",
          2000,
          async () => ++calls,
        ),
      ),
    );
    assert.equal(calls, 1);
    assert.equal(
      attempts.filter((result) => result.status === "rejected").length,
      4,
    );
    await budgetedInference(
      db,
      a.accountId,
      "embedding",
      2000,
      async () => ++calls,
    );
    assert.equal(calls, 2);
    assert.equal(
      (await tenant(db, a.accountId, (trx) =>
        memory.billingUsage(db, trx, a.accountId),
      ))!.metrics.generation.today,
      limit,
    );
  });

test("billing-disabled generation keeps the installation guard even for a subscribed account", async () => {
  configure(false);
  const a = await account(true);
  await tenant(db, a.accountId, (trx) =>
    trx("inference_usage").insert({
      accountId: a.accountId,
      role: "generation",
      requests: 2000,
    }),
  );
  await assert.rejects(
    budgetedInference(db, a.accountId, "generation", 2000, async () =>
      assert.fail("must not dispatch"),
    ),
    { code: "inference_budget" },
  );
});

for (const pro of [false, true]) {
  test(`${pro ? "Pro" : "Free"} transcription uses its independent hour allowance above the old daily guard and stops provider dispatch at the boundary`, async () => {
    configure();
    const a = await account(pro);
    const service = new memory.MemoryService(
      db,
      "tier-test-cursor-secret-32-characters",
    );
    await service.settings(a, { transcriptionEnabled: true });
    let note = await service.remember(
      a,
      rememberSchema.parse({
        operationId: randomUUID(),
        content: "Lecture excerpt.",
      }),
    );
    const audio = Buffer.alloc(32044);
    audio.write("RIFF");
    audio.writeUInt32LE(audio.length - 8, 4);
    audio.write("WAVEfmt ", 8);
    audio.writeUInt32LE(16, 16);
    audio.writeUInt16LE(1, 20);
    audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(16000, 24);
    audio.writeUInt32LE(32000, 28);
    audio.writeUInt16LE(2, 32);
    audio.writeUInt16LE(16, 34);
    audio.write("data", 36);
    audio.writeUInt32LE(32000, 40);
    const attachments = new memory.MediaAttachments(service);
    const input = {
      id: randomUUID(),
      memoryId: note.id,
      version: note.version,
      bytes: audio.length,
      mime: "audio/wav",
      sha256: createHash("sha256").update(audio).digest("hex"),
    };
    const claimed = await attachments.claim(a, input);
    await attachments.finish(a, input, claimed.row.leaseId, {
      width: 0,
      height: 0,
      durationMs: 1000,
    });
    note = await service.remember(
      a,
      rememberSchema.parse({
        operationId: randomUUID(),
        id: note.id,
        expectedVersion: note.version,
        content: `${note.content}\n\n[Recording](grove-media:${input.id})`,
      }),
    );
    let calls = 0;
    const providers = {
      transcription: {
        profile: `transcription_${randomUUID()}`,
        transcribe: async () => {
          calls++;
          return "Lecture excerpt.";
        },
      },
    };
    await memory.configureSpeech(db, providers);
    const jobs = new memory.SpeechJobs(service, providers, store);
    const limit = billingLimits[pro ? "pro" : "free"].transcription.monthly;
    await tenant(db, a.accountId, (trx) =>
      trx("speech_usage").insert({
        accountId: a.accountId,
        kind: "speech_transcribe",
        requests: 1,
        units: limit - 1000,
      }),
    );
    const run = (id: string) =>
      memory.runTask(
        worker,
        memory.speechHandlers(
          service,
          providers,
          store,
          async () => audio,
          worker,
        ),
        { id },
      );
    const first = await jobs.enqueue(a, note.id, {
      id: randomUUID(),
      version: note.version,
      mediaId: input.id,
    });
    await run(first.id);
    assert.equal((await jobs.get(a, first.id)).status, "succeeded");
    const next = await jobs.enqueue(a, note.id, {
      id: randomUUID(),
      version: note.version,
      mediaId: input.id,
    });
    await run(next.id);
    assert.equal((await jobs.get(a, next.id)).error, "speech_budget");
    assert.equal(calls, 1);
    const usage = await tenant(db, a.accountId, (trx) =>
      memory.billingUsage(db, trx, a.accountId),
    );
    assert.equal(usage!.metrics.transcription.month, limit);
    assert.equal(usage!.metrics.synthesis.month, 0);
  });
}

async function narration(synthesize: () => Promise<Buffer>, monthly = 1000) {
  configure(true, monthly);
  const a = await account();
  const providers = {
    synthesis: { reed: { profile: `duration_${randomUUID()}`, synthesize } },
  };
  await memory.configureSpeech(db, providers);
  const service = new memory.MemoryService(
    db,
    "tier-test-cursor-secret-32-characters",
  );
  const note = await service.remember(
    a,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "A lecture summary.",
    }),
  );
  const jobs = new memory.SpeechJobs(service, providers, store);
  const enqueue = () =>
    jobs.enqueue(a, note.id, { id: randomUUID(), version: note.version });
  const run = (id: string) =>
    memory.runTask(
      worker,
      memory.speechHandlers(service, providers, store, null, worker),
      { id, accountLimit: 2, heartbeatMs: 100 },
    );
  const usage = () =>
    tenant(db, a.accountId, (trx) => memory.billingUsage(db, trx, a.accountId));
  return { a, note, jobs, enqueue, run, usage };
}

test("TTS settles measured duration, preserves legacy characters and reuses audio without another charge", async () => {
  let calls = 0;
  const audio = mp3Fixture();
  const f = await narration(async () => {
    calls++;
    return audio;
  });
  const first = await f.enqueue();
  await f.run(first.id);
  assert.equal((await f.jobs.get(f.a, first.id)).status, "succeeded");
  assert.equal(
    (await f.usage())!.metrics.synthesis.month,
    mp3DurationMs(audio),
  );
  const counter = await tenant(db, f.a.accountId, (trx) =>
    trx("speech_usage").where({ kind: "speech_synthesize" }).first(),
  );
  assert.equal(Number(counter.units), f.note.content.length);
  assert.equal(Number(counter.durationMs), mp3DurationMs(audio));
  const cached = await f.enqueue();
  assert.equal(cached.status, "succeeded");
  assert.equal(calls, 1);
  assert.equal(
    (await f.usage())!.metrics.synthesis.month,
    mp3DurationMs(audio),
  );
});

test("unlimited grants bypass exhausted duration allowances but retain speech attempt protection", async () => {
  let calls = 0;
  const audio = mp3Fixture();
  const f = await narration(async () => {
    calls++;
    return audio;
  });
  await tenant(db, f.a.accountId, (trx) =>
    trx("speech_usage").insert({
      accountId: f.a.accountId,
      kind: "speech_synthesize",
      requests: 1,
      units: 100,
      durationMs: 1000,
    }),
  );
  const exhausted = await f.enqueue();
  await f.run(exhausted.id);
  assert.equal((await f.jobs.get(f.a, exhausted.id)).error, "speech_budget");
  await admin("account_administration").insert({
    accountId: f.a.accountId,
    access: "unlimited",
  });
  const allowed = await f.enqueue();
  await f.run(allowed.id);
  assert.equal((await f.jobs.get(f.a, allowed.id)).status, "succeeded");
  assert.equal(calls, 1);
  assert.equal(
    (await f.usage())!.metrics.synthesis.month,
    1000 + mp3DurationMs(audio),
  );
  assert.equal((await f.usage())!.metrics.synthesis.monthlyLimit, null);
  const service = new memory.MemoryService(
    db,
    "tier-test-cursor-secret-32-characters",
  );
  const changed = await service.remember(
    f.a,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: f.note.id,
      expectedVersion: f.note.version,
      content: "Changed synthetic lecture summary.",
    }),
  );
  await tenant(db, f.a.accountId, (trx) =>
    trx("speech_usage")
      .where({ kind: "speech_synthesize" })
      .update({ requests: 20 }),
  );
  const bounded = await f.jobs.enqueue(f.a, changed.id, {
    id: randomUUID(),
    version: changed.version,
  });
  await f.run(bounded.id);
  assert.equal((await f.jobs.get(f.a, bounded.id)).error, "speech_budget");
  assert.equal(calls, 1);
});

test("concurrent TTS final-slot admission cannot overspend while a provider is held", async () => {
  const audio = mp3Fixture(),
    duration = mp3DurationMs(audio);
  let release!: () => void,
    started!: () => void,
    calls = 0;
  const held = new Promise<void>((resolve) => (release = resolve));
  const dispatched = new Promise<void>((resolve) => (started = resolve));
  const f = await narration(async () => {
    calls++;
    started();
    if (calls === 1) await held;
    return audio;
  }, duration);
  const first = await f.enqueue();
  const second = await f.enqueue();
  const running = f.run(first.id);
  try {
    await dispatched;
    await f.run(second.id);
    assert.equal(calls, 1);
    assert.equal((await f.jobs.get(f.a, second.id)).error, "speech_budget");
  } finally {
    release();
    await running;
  }
  assert.equal((await f.usage())!.metrics.synthesis.month, duration);
});

test("invalid, failed and over-reservation audio cannot publish or clear the committed reservation", async () => {
  for (const response of ["invalid", "failure", "overrun"]) {
    const f = await narration(async () => {
      if (response === "failure") throw new Error("Synthetic provider failure");
      return response === "invalid" ? Buffer.from("ID3") : mp3Fixture(100);
    }, 10);
    const first = await f.enqueue();
    await f.run(first.id);
    assert.notEqual(
      (await f.jobs.get(f.a, first.id)).status,
      "succeeded",
      response,
    );
    assert.equal((await f.usage())!.metrics.synthesis.month, 10, response);
    assert.equal(
      (await tenant(db, f.a.accountId, (trx) => trx("export_objects"))).length,
      0,
      response,
    );
  }
});
