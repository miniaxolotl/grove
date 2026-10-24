import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createDatabase, migrationSource, tenant } from "@lib/database";
import {
  MemoryService,
  SpeechJobs,
  configureSpeech,
  exportHandlers,
  runTask,
  speechHandlers,
} from "@lib/memory";
import { rememberSchema, type Principal } from "@lib/shared/contracts";
import { Authentication } from "../../packages/api/src/auth.ts";
import { localArtifacts } from "../../packages/api/src/artifacts.ts";

const databaseName = `grove_speech_cache_${randomUUID().replaceAll("-", "")}_test`;
const target = (input: string) => {
  const url = new URL(input);
  assert(url.pathname.endsWith("_test"));
  url.pathname = `/${databaseName}`;
  return url.href;
};
const authority = createDatabase(process.env.TEST_MIGRATION_DATABASE_URL!);
const owner = createDatabase(target(process.env.TEST_MIGRATION_DATABASE_URL!));
const db = createDatabase(target(process.env.TEST_DATABASE_URL!));
const worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
const service = new MemoryService(
  db,
  "speech-cache-test-cursor-secret-32-characters",
);
const bytes = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200)]);
let calls = 0;
let alternateEnabled = true;
const providers = {
  synthesis: {
    reed: {
      profile: "speech-cache-reed",
      async synthesize() {
        calls++;
        return bytes;
      },
    },
    willow: {
      profile: "speech-cache-willow",
      async available() {
        return alternateEnabled;
      },
      async synthesize() {
        calls++;
        return bytes;
      },
    },
  },
};
let root: string;
let store: ReturnType<typeof localArtifacts>;
let jobs: SpeechJobs;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [databaseName]);
  await owner.migrate.latest({ migrationSource });
  root = await mkdtemp("/tmp/opencode/grove-text-cache-");
  store = localArtifacts(root);
  await store.ready!();
  await configureSpeech(db, providers);
  jobs = new SpeechJobs(service, providers, store);
});
after(async () => {
  await Promise.all([db.destroy(), worker.destroy(), owner.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [databaseName]);
  await authority.destroy();
  if (root) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const subject = randomUUID();
  const principal = await new Authentication(db, {
    async verify() {
      return { subject, type: "session", sessionId: subject };
    },
  }).principal(
    new Request("http://localhost", {
      headers: { authorization: "Bearer fixture" },
    }),
  );
  const note = await service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "A river flows through the woods.",
    }),
  );
  return { principal, note };
}
async function prepare(
  principal: Principal,
  note: { id: string; version: number },
) {
  const task = await jobs.enqueue(principal, note.id, {
    id: randomUUID(),
    version: note.version,
  });
  if (task.status === "pending")
    await runTask(
      worker,
      speechHandlers(service, providers, store, null, worker),
      { id: task.id },
    );
  assert.equal((await jobs.get(principal, task.id)).playable, true);
  return { task, audio: await jobs.audio(principal, task.id) };
}
const edit = (
  principal: Principal,
  note: { id: string; version: number },
  content: string,
) =>
  service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: note.id,
      expectedVersion: note.version,
      content,
    }),
  );
const object = (principal: Principal, key: string) =>
  tenant(db, principal.accountId, (trx) =>
    trx("export_objects").where({ objectKey: key }).first(),
  );

test("text A→B→A reuses the original audio without another synthesis", async () => {
  const { principal, note } = await fixture();
  const a = await prepare(principal, note);
  const b = await edit(principal, note, "A different text.");
  await prepare(principal, b);
  await assert.rejects(jobs.audio(principal, a.task.id));
  const restored = await edit(principal, b, note.content);
  const before = calls;
  const reused = await prepare(principal, restored);
  assert.equal(
    reused.task.status,
    "succeeded",
    "a text revert must hit the cache",
  );
  assert.equal(reused.audio.key, a.audio.key);
  assert.equal(calls, before);
});

test("current audio survives request receipt expiration and machine-result cleanup", async () => {
  const { principal, note } = await fixture();
  const first = await prepare(principal, note);
  await tenant(db, principal.accountId, (trx) =>
    trx("background_tasks")
      .where({ id: first.task.id })
      .update({ expiresAt: trx.raw("now()-interval '8 days'") }),
  );
  await worker.raw("SELECT grove_expire_speech()");
  const before = calls;
  const reused = await prepare(principal, note);
  assert.equal(
    reused.task.status,
    "succeeded",
    "cache lifetime must not depend on a task receipt",
  );
  assert.equal(reused.audio.key, first.audio.key);
  assert.equal(calls, before);
});

test("matching audio has no age expiry; first mismatch starts a seven-day window", async () => {
  const { principal, note } = await fixture();
  const first = await prepare(principal, note);
  assert.equal((await object(principal, first.audio.key)).expiresAt, Infinity);
  assert.equal(
    (await object(principal, first.audio.key)).speechTextHash,
    createHash("sha256").update(note.content).digest("hex"),
  );
  const changed = await edit(principal, note, "Changed text.");
  const stale = await object(principal, first.audio.key);
  const remaining = new Date(stale.expiresAt).getTime() - Date.now();
  assert(remaining > 7 * 86400000 - 10000 && remaining <= 7 * 86400000);
  await edit(principal, changed, "Changed again.");
  assert.deepEqual(
    (await object(principal, first.audio.key)).expiresAt,
    stale.expiresAt,
    "later mismatches must not extend the old audio's retention",
  );
});

test("reverting before expiry protects restored audio and expires only the replaced version", async () => {
  const { principal, note } = await fixture();
  const a = await prepare(principal, note);
  const changed = await edit(principal, note, "Changed text.");
  const b = await prepare(principal, changed);
  await tenant(db, principal.accountId, (trx) =>
    trx("export_objects")
      .where({ objectKey: a.audio.key })
      .update({ expiresAt: trx.raw("now()+interval '1 hour'") }),
  );
  await edit(principal, changed, note.content);
  assert.equal((await object(principal, a.audio.key)).expiresAt, Infinity);
  assert.notEqual((await object(principal, b.audio.key)).expiresAt, Infinity);
});

test("expired superseded audio is removed without deleting current audio and cannot be revived", async () => {
  const { principal, note } = await fixture();
  const a = await prepare(principal, note);
  const changed = await edit(principal, note, "Changed text.");
  const b = await prepare(principal, changed);
  await tenant(db, principal.accountId, (trx) =>
    trx("export_objects")
      .where({ objectKey: a.audio.key })
      .update({ expiresAt: trx.raw("now()-interval '1 second'") }),
  );
  const restored = await edit(principal, changed, note.content);
  assert(
    new Date((await object(principal, a.audio.key)).expiresAt).getTime() <
      Date.now(),
  );
  await worker.raw("SELECT grove_schedule_artifacts()");
  const cleanup = await tenant(db, principal.accountId, (trx) =>
    trx("background_tasks")
      .where({ kind: "artifact_cleanup", status: "pending" })
      .first(),
  );
  assert(cleanup);
  await runTask(worker, exportHandlers(worker, store), { id: cleanup.id });
  assert.equal(await object(principal, a.audio.key), undefined);
  assert(await object(principal, b.audio.key));
  const fresh = await prepare(principal, restored);
  assert.notEqual(fresh.audio.key, a.audio.key);
});

test("cache is isolated by note and account even with identical text", async () => {
  const a = await fixture(),
    b = await fixture();
  const first = await prepare(a.principal, a.note);
  await assert.rejects(jobs.audio(b.principal, first.task.id));
  assert.equal(await object(b.principal, first.audio.key), undefined);
  const second = await prepare(b.principal, b.note);
  assert.notEqual(second.audio.key, first.audio.key);
  const another = await service.remember(
    a.principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: a.note.content,
    }),
  );
  assert.notEqual(
    (await prepare(a.principal, another)).audio.key,
    first.audio.key,
  );
});

test("cleanup claims cannot be revived by an edit whose transaction began before expiry", async () => {
  const { principal, note } = await fixture();
  const a = await prepare(principal, note);
  await edit(principal, note, "Different text.");
  const staleTransaction = await db.transaction();
  let observed: unknown;
  try {
    await staleTransaction.raw(
      "SELECT set_config('grove.account_id',?,true),now()",
      [principal.accountId],
    );
    // The editing transaction's now() is older than this expiry. A cleanup claim
    // must remain irreversible even for that transaction's stale clock.
    await owner.raw("SELECT pg_sleep(0.01)");
    await tenant(db, principal.accountId, (trx) =>
      trx("export_objects")
        .where({ objectKey: a.audio.key })
        .update({ expiresAt: trx.fn.now() }),
    );
    await worker.raw("SELECT grove_schedule_artifacts()");
    const cleanup = await tenant(db, principal.accountId, (trx) =>
      trx("background_tasks")
        .where({ kind: "artifact_cleanup", status: "pending" })
        .first(),
    );
    await runTask(
      worker,
      exportHandlers(worker, {
        ...store,
        async remove(key, signal) {
          await staleTransaction("memories")
            .where({ id: note.id })
            .update({ content: note.content });
          observed = (
            await staleTransaction("export_objects")
              .where({ objectKey: key })
              .first()
          ).expiresAt;
          await staleTransaction.commit();
          await store.remove(key, signal);
        },
      }),
      { id: cleanup.id },
    );
    assert(
      observed === -Infinity ||
        (observed instanceof Date && observed.getTime() < Date.now()),
      "claimed audio must not become current while its bytes are being deleted",
    );
    assert.equal(await object(principal, a.audio.key), undefined);
  } finally {
    if (!staleTransaction.isCompleted()) await staleTransaction.rollback();
  }
});

test("metadata-only revisions reuse text audio but consent and restore generations do not", async () => {
  const { principal, note } = await fixture();
  const a = await prepare(principal, note);
  const revised = await service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: note.id,
      expectedVersion: note.version,
      content: note.content,
      kind: "decision",
    }),
  );
  assert(revised.version > note.version);
  assert.equal((await prepare(principal, revised)).audio.key, a.audio.key);
  await service.settings(principal, { readAloudEnabled: false });
  await assert.rejects(jobs.audio(principal, a.task.id));
  await service.settings(principal, { readAloudEnabled: true });
  const consent = await prepare(principal, revised);
  assert.notEqual(consent.audio.key, a.audio.key);
  await owner("processing_control").increment("epoch", 1);
  const restored = await prepare(principal, revised);
  assert.notEqual(restored.audio.key, consent.audio.key);
});

test("failed storage writes never publish durable cache metadata", async () => {
  const { principal, note } = await fixture();
  const task = await jobs.enqueue(principal, note.id, {
    id: randomUUID(),
    version: note.version,
  });
  await runTask(
    worker,
    speechHandlers(
      service,
      providers,
      {
        ...store,
        async write() {
          throw new Error("synthetic_storage_failure");
        },
      },
      null,
      worker,
    ),
    { id: task.id },
  );
  const staged = await tenant(db, principal.accountId, (trx) =>
    trx("export_objects").where({ taskId: task.id }).first(),
  );
  assert(staged);
  assert.equal(staged.speechCacheKey, null);
  assert(staged.expiresAt instanceof Date);
  await jobs.cancel(principal, task.id);
  const fresh = await prepare(principal, note);
  assert.equal(fresh.task.status, "pending");
  assert.notEqual(fresh.audio.key, staged.objectKey);
});

test("archival and scheduled note expiry bound otherwise matching cache retention", async () => {
  const { principal, note } = await fixture();
  const a = await prepare(principal, note);
  await tenant(db, principal.accountId, (trx) =>
    trx("memories").where({ id: note.id }).update({ status: "archived" }),
  );
  assert((await object(principal, a.audio.key)).expiresAt instanceof Date);
  await tenant(db, principal.accountId, (trx) =>
    trx("memories").where({ id: note.id }).update({ status: "active" }),
  );
  assert.equal((await object(principal, a.audio.key)).expiresAt, Infinity);
  const ephemeral = await service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Temporary narration.",
      capture: "automatic",
      retentionDays: 1,
    }),
  );
  const audio = await prepare(principal, ephemeral);
  const current = await tenant(db, principal.accountId, (trx) =>
    trx("memories").where({ id: ephemeral.id }).first(),
  );
  assert.equal(
    (await object(principal, audio.audio.key)).expiresAt.getTime(),
    current.expiresAt.getTime() + 7 * 86400000,
  );
});

test("alternate flag controls discovery, cached reads and new requests independently of Reed", async () => {
  const { principal, note } = await fixture();
  const first = await jobs.enqueue(principal, note.id, {
    id: randomUUID(),
    version: note.version,
    voiceId: "willow",
  });
  await runTask(
    worker,
    speechHandlers(service, providers, store, null, worker),
    { id: first.id },
  );
  assert.equal((await jobs.get(principal, first.id)).playable, true);
  const audio = await jobs.audio(principal, first.id);
  alternateEnabled = false;
  try {
    const description = await jobs.describe();
    assert.equal(
      description.speechVoices.find((voice) => voice.id === "willow")
        ?.available,
      false,
    );
    assert.equal(
      description.speechVoices.find((voice) => voice.id === "reed")?.available,
      true,
    );
    await assert.rejects(jobs.audio(principal, first.id));
    await assert.rejects(
      jobs.enqueue(principal, note.id, {
        id: randomUUID(),
        version: note.version,
        voiceId: "willow",
      }),
    );
    assert.equal((await jobs.get(principal, first.id)).playable, false);
  } finally {
    alternateEnabled = true;
  }
  const before = calls;
  const reused = await jobs.enqueue(principal, note.id, {
    id: randomUUID(),
    version: note.version,
    voiceId: "willow",
  });
  assert.equal(reused.status, "succeeded");
  assert.equal((await jobs.audio(principal, reused.id)).key, audio.key);
  assert.equal(calls, before);
});

test("worker rechecks alternate flag before dispatch and after held inference", async () => {
  for (const phase of ["before", "during"] as const) {
    const { principal, note } = await fixture();
    const task = await jobs.enqueue(principal, note.id, {
      id: randomUUID(),
      version: note.version,
      voiceId: "willow",
    });
    const before = calls;
    const gated = {
      ...providers,
      synthesis: {
        ...providers.synthesis,
        willow: {
          ...providers.synthesis.willow,
          async synthesize() {
            calls++;
            alternateEnabled = false;
            return bytes;
          },
        },
      },
    };
    if (phase === "before") alternateEnabled = false;
    try {
      await runTask(
        worker,
        speechHandlers(service, gated, store, null, worker),
        { id: task.id },
      );
      assert.equal(calls, before + (phase === "during" ? 1 : 0));
      assert.equal((await jobs.get(principal, task.id)).playable, false);
      const objects = await tenant(db, principal.accountId, (trx) =>
        trx("export_objects").where({ taskId: task.id }),
      );
      assert.equal(objects.length, 0);
    } finally {
      alternateEnabled = true;
    }
  }
});

test("flag evaluation failures deny alternates without affecting Reed or disclosing diagnostics", async () => {
  const { principal, note } = await fixture();
  const unavailable = {
    ...providers,
    synthesis: {
      ...providers.synthesis,
      willow: {
        ...providers.synthesis.willow,
        async available(): Promise<boolean> {
          throw new Error("private_flag_diagnostic");
        },
      },
    },
  };
  const failed = new SpeechJobs(service, unavailable, store);
  const description = await failed.describe();
  assert.equal(
    description.speechVoices.find((voice) => voice.id === "willow")?.available,
    false,
  );
  assert.equal(
    description.speechVoices.find((voice) => voice.id === "reed")?.available,
    true,
  );
  await assert.rejects(
    failed.enqueue(principal, note.id, {
      id: randomUUID(),
      version: note.version,
      voiceId: "willow",
    }),
    (error) =>
      error instanceof Error && error.message === "Speech is not configured",
  );
});
