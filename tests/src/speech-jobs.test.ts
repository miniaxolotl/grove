import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createDatabase, tenant } from "@lib/database";
import {
  MemoryService,
  MediaAttachments,
  SpeechJobs,
  configureSpeech,
  runTask,
  speechHandlers,
} from "@lib/memory";
import { rememberSchema, type Principal } from "@lib/shared/contracts";
import { preferencesFor } from "@lib/shared/preferences";
import { speechText } from "@lib/shared/speech";
import { Authentication } from "../../packages/api/src/auth.ts";
import { createApp } from "../../packages/api/src/app.ts";
import { localArtifacts } from "../../packages/api/src/artifacts.ts";
import { localMedia } from "../../packages/api/src/media-store.ts";
import { readMediaBytes } from "../../packages/api/src/media-input.ts";
import type { SpeechProviders } from "../../lib/ai/src/speech.ts";
import { InferenceError } from "@lib/ai";

const db = createDatabase(process.env.TEST_DATABASE_URL!);
const worker = createDatabase(process.env.TEST_WORKER_DATABASE_URL!);
const service = new MemoryService(
  db,
  "speech-test-cursor-secret-32-characters",
);
const subject = `speech_${randomUUID()}`;
const auth = new Authentication(db, {
  async verify() {
    return { subject, type: "session", sessionId: subject };
  },
});
const generated = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200)]);
let calls = 0;
let hold: (() => Promise<void>) | undefined;
const providers: SpeechProviders = {
  transcription: {
    profile: "speech-test-whisper",
    async transcribe() {
      calls++;
      await hold?.();
      return "Meet by the river.";
    },
  },
  synthesis: {
    profile: "speech-test-tts-alloy",
    async synthesize() {
      calls++;
      await hold?.();
      return generated;
    },
  },
};
let root: string, principal: Principal, other: Principal;
let media: ReturnType<typeof localMedia>,
  store: ReturnType<typeof localArtifacts>;
let app: ReturnType<typeof createApp>, jobs: SpeechJobs;
const req = (path: string, method = "GET", body?: object, headers = {}) =>
  app.request(path, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: {
      authorization: "Bearer fixture",
      "content-type": "application/json",
      ...headers,
    },
  });
before(async () => {
  root = await mkdtemp("/tmp/opencode/grove-speech-");
  media = localMedia(`${root}/originals`);
  await media.ready();
  store = localArtifacts(`${root}/derived`);
  await store.ready!();
  principal = await auth.principal(
    new Request("http://localhost", {
      headers: { authorization: "Bearer fixture" },
    }),
  );
  other = await new Authentication(db, {
    async verify() {
      return {
        subject: `other_${subject}`,
        type: "session",
        sessionId: `other_${subject}`,
      };
    },
  }).principal(
    new Request("http://localhost", {
      headers: { authorization: "Bearer fixture" },
    }),
  );
  await configureSpeech(db, providers);
  jobs = new SpeechJobs(service, providers, store);
  app = createApp({
    memories: service,
    auth,
    media,
    artifacts: store,
    speech: providers,
    origin: "http://localhost",
    siteUrl: "http://localhost",
    issuer: "https://clerk.example.test",
    webhookSecret: "test",
    ready: async () => {},
  });
});
after(async () => {
  await db.destroy();
  await worker.destroy();
  if (root) await rm(root, { recursive: true, force: true });
});
const run = (id: string) => {
  const handlers = speechHandlers(
    service,
    providers,
    store,
    (key, signal) =>
      media.read(key, signal).then((stream) => readMediaBytes(stream, signal)),
    worker,
  );
  return runTask(worker, handlers, { id, heartbeatMs: 100 });
};
async function note() {
  return service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "# River walk\n\nMeet by the river.",
    }),
  );
}
async function recording() {
  const initial = await note(),
    id = randomUUID(),
    frames = 16000,
    bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  const upload = await app.request(`/v1/memories/${initial.id}/media/${id}`, {
    method: "PUT",
    body: new Uint8Array(bytes),
    headers: {
      authorization: "Bearer fixture",
      "content-type": "audio/wav",
      "content-length": String(bytes.length),
      "x-grove-note-version": String(initial.version),
      "x-grove-content-sha256": createHash("sha256")
        .update(bytes)
        .digest("hex"),
    },
  });
  assert.equal(upload.status, 201);
  const saved = await service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: initial.id,
      expectedVersion: initial.version,
      content: `${initial.content}\n\n[Recording](grove-media:${id})`,
    }),
  );
  return { note: saved, mediaId: id };
}

test("speech defaults are independent and read-aloud excludes attachment IDs/URLs", () => {
  assert.equal(preferencesFor({}).transcriptionEnabled, false);
  assert.equal(preferencesFor({}).readAloudEnabled, true);
  assert.equal(
    speechText(
      "# Hello\n\n[Visit](https://private.example)\n\n![Image](grove-media:opaque)\n\n```ts\nsecretCode()\n```",
    ),
    "Hello\n\nVisit",
  );
});
test("speech requires a provider, session ownership, saved source and explicit preference", async () => {
  await service.settings(principal, { readAloudEnabled: false });
  const n = await note(),
    id = randomUUID(),
    input = { id, version: n.version };
  assert.equal(
    (await req(`/v1/memories/${n.id}/speech`, "POST", input)).status,
    403,
  );
  const disabled = new SpeechJobs(service, {}, store);
  await assert.rejects(disabled.enqueue(principal, n.id, input), /configured/);
  await assert.rejects(jobs.enqueue(other, n.id, input));
  await assert.rejects(
    jobs.enqueue({ ...principal, type: "key" }, n.id, input),
  );
  const due = await tenant(db, principal.accountId, (trx) =>
    trx("accounts")
      .where({ id: principal.accountId })
      .first("organizationDueAt"),
  );
  await service.settings(principal, {
    transcriptionEnabled: true,
    readAloudEnabled: true,
  });
  const afterDue = await tenant(db, principal.accountId, (trx) =>
    trx("accounts")
      .where({ id: principal.accountId })
      .first("organizationDueAt"),
  );
  assert.deepEqual(
    afterDue,
    due,
    "speech opt-ins do not reschedule unrelated organization",
  );
  assert.equal(
    (
      await req(`/v1/memories/${n.id}/speech`, "POST", {
        ...input,
        version: n.version + 1,
      })
    ).status,
    409,
  );
});
test("queued STT retains machine text separately and never overwrites transcript edits", async () => {
  const { note: n, mediaId } = await recording(),
    input = { id: randomUUID(), version: n.version, mediaId };
  const queued = await jobs.enqueue(principal, n.id, input);
  assert.equal(queued.status, "pending");
  assert.equal((await jobs.enqueue(principal, n.id, input)).id, queued.id);
  await run(queued.id);
  const ready = await jobs.get(principal, queued.id);
  assert.equal(ready.status, "succeeded");
  assert.equal(ready.transcript, "Meet by the river.");
  assert.deepEqual(
    await new MediaAttachments(service).transcript(principal, n.id, mediaId),
    { text: "", version: 0 },
  );
  await assert.rejects(jobs.get(other, queued.id));
  await new MediaAttachments(service).saveTranscript(principal, n.id, mediaId, {
    operationId: randomUUID(),
    expectedVersion: 0,
    text: "My own words.",
  });
  assert.equal((await jobs.get(principal, queued.id)).status, "failed");
});
test("read-aloud caches exact source/profile and streams only session-owned unexpired audio", async () => {
  const n = await note(),
    initialCalls = calls;
  const queued = await jobs.enqueue(principal, n.id, {
    id: randomUUID(),
    version: n.version,
  });
  await run(queued.id);
  const ready = await jobs.get(principal, queued.id);
  assert.equal(ready.status, "succeeded");
  assert.equal(ready.playable, true);
  const path = `/v1/speech/${queued.id}/audio`;
  const audio = await req(path, "GET", undefined, { range: "bytes=0-2" });
  assert.equal(audio.status, 206);
  assert.equal(await audio.text(), "ID3");
  assert.equal((await req(path, "HEAD")).status, 200);
  const cached = await jobs.enqueue(principal, n.id, {
    id: randomUUID(),
    version: n.version,
  });
  assert.equal(cached.status, "succeeded");
  assert.equal(calls, initialCalls + 1);
  await tenant(db, principal.accountId, (trx) =>
    trx("export_objects")
      .where({ taskId: queued.id })
      .update({ expiresAt: trx.raw("now()-interval '1 second'") }),
  );
  assert.equal((await req(path)).status, 409);
  await service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: n.id,
      expectedVersion: n.version,
      content: "Changed source",
    }),
  );
  assert.equal((await jobs.get(principal, cached.id)).status, "failed");
});
test("disable/re-enable, cancellation and edited sources fence in-flight output", async () => {
  for (const action of ["preferences", "cancel", "edit"] as const) {
    const n = await note(),
      queued = await jobs.enqueue(principal, n.id, {
        id: randomUUID(),
        version: n.version,
      });
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    hold = async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const pending = run(queued.id);
    await entered;
    if (action === "preferences") {
      await service.settings(principal, { readAloudEnabled: false });
      await service.settings(principal, { readAloudEnabled: true });
    } else if (action === "cancel") await jobs.cancel(principal, queued.id);
    else
      await service.remember(
        principal,
        rememberSchema.parse({
          operationId: randomUUID(),
          id: n.id,
          expectedVersion: n.version,
          content: "Newer writing",
        }),
      );
    release();
    await pending;
    hold = undefined;
    assert.notEqual((await jobs.get(principal, queued.id)).status, "succeeded");
  }
});
test("provider retries reserve units per attempt and a lost lease cannot publish", async () => {
  const n = await note(),
    queued = await jobs.enqueue(principal, n.id, {
      id: randomUUID(),
      version: n.version,
    });
  const original = providers.synthesis!.synthesize;
  providers.synthesis!.synthesize = async () => {
    throw new InferenceError("provider_unavailable", true);
  };
  await run(queued.id);
  assert.equal((await jobs.get(principal, queued.id)).status, "pending");
  providers.synthesis!.synthesize = original;
  await tenant(db, principal.accountId, (trx) =>
    trx("background_tasks")
      .where({ id: queued.id })
      .update({ dueAt: trx.fn.now() }),
  );
  await run(queued.id);
  assert.equal((await jobs.get(principal, queued.id)).status, "succeeded");
  const usage = await tenant(db, principal.accountId, (trx) =>
    trx("speech_usage")
      .where({ kind: "speech_synthesize" })
      .whereRaw("day=CURRENT_DATE")
      .first(),
  );
  assert(usage.requests >= 2);

  const second = await note(),
    pending = await jobs.enqueue(principal, second.id, {
      id: randomUUID(),
      version: second.version,
    });
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  hold = async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const oldWorker = run(pending.id);
  await entered;
  await tenant(db, principal.accountId, (trx) =>
    trx("background_tasks")
      .where({ id: pending.id })
      .update({ leaseUntil: trx.raw("now()-interval '1 second'") }),
  );
  await run(pending.id); // The old provider slot prevents overlapping billing.
  release();
  await oldWorker;
  hold = undefined;
  assert.equal((await jobs.get(principal, pending.id)).playable, false);
  await tenant(db, principal.accountId, (trx) =>
    trx("background_tasks")
      .where({ id: pending.id })
      .update({ dueAt: trx.fn.now() }),
  );
  await run(pending.id);
  assert.equal((await jobs.get(principal, pending.id)).status, "succeeded");
});
test("global provider slots bound two workers across accounts without bypassing the bulk queue", async () => {
  const actors: Principal[] = [];
  for (let i = 0; i < 3; i++) {
    const actor = await new Authentication(db, {
      async verify() {
        return {
          subject: `speech_slots_${randomUUID()}`,
          type: "session",
          sessionId: randomUUID(),
        };
      },
    }).principal(
      new Request("http://localhost", {
        headers: { authorization: "Bearer fixture" },
      }),
    );
    await service.settings(actor, { readAloudEnabled: true });
    actors.push(actor);
  }
  const queued = [];
  for (const actor of actors) {
    const n = await service.remember(
      actor,
      rememberSchema.parse({
        operationId: randomUUID(),
        content: "Independent account",
      }),
    );
    queued.push(
      await jobs.enqueue(actor, n.id, { id: randomUUID(), version: n.version }),
    );
  }
  let started!: () => void,
    release!: () => void,
    enteredCount = 0;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  hold = async () => {
    if (++enteredCount === 2) started();
    await gate;
  };
  const workers = [run(queued[0].id), run(queued[1].id)];
  await entered;
  await run(queued[2].id);
  const blocked = await jobs.get(actors[2], queued[2].id);
  assert.equal(blocked.status, "pending");
  assert.equal(blocked.error, "speech_provider_busy");
  assert.equal(enteredCount, 2);
  release();
  await Promise.all(workers);
  hold = undefined;
  await jobs.cancel(actors[2], queued[2].id);
});
test("profile cutovers, session revocation and restore epochs invalidate pending speech", async () => {
  const n = await note(),
    queued = await jobs.enqueue(principal, n.id, {
      id: randomUUID(),
      version: n.version,
    });
  await configureSpeech(db, {
    ...providers,
    synthesis: { ...providers.synthesis!, profile: "new-voice" },
  });
  const before = calls;
  await run(queued.id);
  assert.equal(calls, before);
  assert.equal((await jobs.get(principal, queued.id)).playable, false);
  await configureSpeech(db, providers);
  const sessionPrincipal = { ...principal, sessionId: randomUUID() };
  const second = await jobs.enqueue(sessionPrincipal, n.id, {
    id: randomUUID(),
    version: n.version,
  });
  const owner = createDatabase(process.env.TEST_MIGRATION_DATABASE_URL!);
  try {
    await owner("session_revocations").insert({
      id: sessionPrincipal.sessionId,
    });
    assert.equal((await jobs.get(principal, second.id)).status, "failed");
    await run(second.id);
    assert.equal(calls, before);
    const third = await jobs.enqueue(principal, n.id, {
      id: randomUUID(),
      version: n.version,
    });
    // A stale captured epoch is equivalent to the restore operation advancing it,
    // without disturbing independent test files' shared processing epoch.
    await owner("background_tasks")
      .where({ id: third.id })
      .update({
        payload: owner.raw("jsonb_set(payload,'{epoch}',to_jsonb(-1))"),
      });
    await run(third.id);
    assert.equal(calls, before);
    assert.equal((await jobs.get(principal, third.id)).status, "failed");
    const cross = await tenant(worker, other.accountId, (trx) =>
      trx.raw("SELECT grove_speech_session_active(?::uuid) AS active", [
        third.id,
      ]),
    );
    assert.equal(cross.rows[0].active, false);
  } finally {
    await owner.destroy();
  }
});
test("daily unit/request limits refuse provider work without deleting originals or transcripts", async () => {
  const n = await note();
  await tenant(db, principal.accountId, async (trx) => {
    await trx("speech_usage")
      .insert({
        accountId: principal.accountId,
        kind: "speech_synthesize",
        requests: 20,
        units: 60000,
      })
      .onConflict(["accountId", "day", "kind"])
      .merge({ requests: 20, units: 60000 });
  });
  const queued = await jobs.enqueue(principal, n.id, {
      id: randomUUID(),
      version: n.version,
    }),
    before = calls;
  await run(queued.id);
  assert.equal(calls, before);
  const failed = await jobs.get(principal, queued.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "speech_budget");
});
test("maintenance expires machine candidates without touching accepted transcripts or original audio", async () => {
  const candidate = await tenant(db, principal.accountId, (trx) =>
    trx("background_tasks")
      .where({ kind: "speech_transcribe", status: "succeeded" })
      .whereNotNull("result")
      .first(),
  );
  assert(candidate);
  await tenant(db, principal.accountId, (trx) =>
    trx("background_tasks")
      .where({ id: candidate.id })
      .update({ expiresAt: trx.raw("now()-interval '1 second'") }),
  );
  await worker.raw("SELECT grove_expire_speech()");
  const expired = await tenant(db, principal.accountId, (trx) =>
    trx("background_tasks").where({ id: candidate.id }).first(),
  );
  assert.equal(expired.result, null);
  const authored = await tenant(db, principal.accountId, (trx) =>
    trx("media_transcripts")
      .where({ mediaId: candidate.payload.mediaId })
      .first(),
  );
  assert.equal(authored.text, "My own words.");
  const original = await new MediaAttachments(service).read(
    principal,
    candidate.payload.memoryId,
    candidate.payload.mediaId,
  );
  const bytes = await readMediaBytes(
    await media.read(original.key, AbortSignal.timeout(1000)),
    AbortSignal.timeout(1000),
  );
  assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
});
