import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createDatabase, tenant } from "@lib/database";
import {
  MemoryService,
  Sharing,
  Tasks,
  exportHandlers,
  runTask,
  MediaAttachments,
} from "@lib/memory";
import { localArtifacts } from "../../packages/api/src/artifacts.ts";
import { rememberSchema, type Principal } from "@lib/shared/contracts";
import { mediaReference } from "@lib/shared/media";
import { Authentication } from "../../packages/api/src/auth.ts";
import { createApp, type AppDependencies } from "../../packages/api/src/app.ts";
import { localMedia } from "../../packages/api/src/media-store.ts";
import sharp from "sharp";

const url = process.env.TEST_DATABASE_URL!,
  owner = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!url || !owner || !new URL(owner).pathname.endsWith("_test"))
  throw Error("Use disposable test databases");
const db = createDatabase(url),
  admin = createDatabase(owner);
const service = new MemoryService(db, "media-test-cursor-secret-32-characters");
const subjects = {
  alice: `user_media_${randomUUID()}`,
  bob: `user_media_${randomUUID()}`,
};
const auth = new Authentication(db, {
  async verify(token) {
    return {
      subject: subjects[token as keyof typeof subjects],
      type: "session",
      sessionId: `sess_media_${token}`,
    };
  },
});
let a: Principal,
  b: Principal,
  root: string,
  app: ReturnType<typeof createApp>,
  png: Buffer;
const input = (content: string, extra = {}) =>
  rememberSchema.parse({ operationId: randomUUID(), content, ...extra });
const request = (
  path: string,
  method = "GET",
  body?: BodyInit,
  headers = {},
  who = "alice",
) =>
  app.request(`http://localhost${path}`, {
    method,
    body,
    headers: { authorization: `Bearer ${who}`, ...headers },
  });
async function upload(
  note: { id: string; version: number },
  id = randomUUID(),
  who = "alice",
) {
  return request(
    `/v1/memories/${note.id}/media/${id}`,
    "PUT",
    new Uint8Array(png),
    {
      "content-type": "image/png",
      "content-length": String(png.length),
      "x-grove-note-version": String(note.version),
      "x-grove-content-sha256": createHash("sha256").update(png).digest("hex"),
    },
    who,
  );
}
before(async () => {
  a = await auth.principal(
    new Request("http://localhost", {
      headers: { authorization: "Bearer alice" },
    }),
  );
  b = await auth.principal(
    new Request("http://localhost", {
      headers: { authorization: "Bearer bob" },
    }),
  );
  root = await mkdtemp("/tmp/opencode/grove-media-access-");
  const media = localMedia(root);
  await media.ready();
  // Optional dependency is added by this feature; use an intersection while RED.
  app = createApp({
    memories: service,
    auth,
    origin: "http://localhost",
    siteUrl: "http://localhost:3000",
    issuer: "https://clerk.example.test",
    webhookSecret: "test",
    ready: async () => {},
    shareLinkKey: "ab".repeat(32),
    media,
    artifacts: localArtifacts(`${root}/exports`),
  } as AppDependencies & { media: typeof media });
  png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
});
after(async () => {
  await Promise.all([db.destroy(), admin.destroy()]);
  if (root) await rm(root, { recursive: true, force: true });
});

test("saved-note uploads are idempotent, version checked, private and revision-bound", async () => {
  const note = await service.remember(a, input("An image note")),
    id = randomUUID();
  const uploaded = await upload(note, id);
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const result = (await uploaded.json()).data;
  assert.equal(result.id, id);
  assert.equal(result.reference, mediaReference(id));
  assert(!JSON.stringify(result).includes("objectKey"));
  assert.equal((await upload(note, id)).status, 200);
  assert.equal((await upload(note, randomUUID(), "bob")).status, 404);
  assert.equal(
    (await request(`/v1/memories/${note.id}/media/${id}`)).status,
    404,
    "unbound media is not a saved revision",
  );
  const saved = await service.remember(
    a,
    input(`An image\n![red](${mediaReference(id)})`, {
      id: note.id,
      expectedVersion: note.version,
    }),
  );
  const read = await request(`/v1/memories/${note.id}/media/${id}`);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("content-type"), "image/png");
  assert.equal(read.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await read.arrayBuffer()), png);
  assert.equal(
    (
      await request(
        `/v1/memories/${note.id}/media/${id}`,
        "GET",
        undefined,
        {},
        "bob",
      )
    ).status,
    404,
  );
  const removed = await service.remember(
    a,
    input("Image removed from current text", {
      id: note.id,
      expectedVersion: saved.version,
    }),
  );
  assert.equal(
    (await request(`/v1/memories/${note.id}/media/${id}`)).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/v1/memories/${note.id}/media/${id}?version=${saved.version}`,
      )
    ).status,
    200,
  );
  assert.equal((await upload(note)).status, 409, "stale upload version");
  await service.forget(a, {
    operationId: randomUUID(),
    items: [{ id: note.id, expectedVersion: removed.version }],
  });
  assert.equal(
    (
      await request(
        `/v1/memories/${note.id}/media/${id}?version=${saved.version}`,
      )
    ).status,
    404,
  );
  assert.equal(
    (await admin("media_objects").where({ accountId: a.accountId, id })).length,
    1,
    "retained original metadata",
  );
});

test("forged references cannot bind foreign, missing or another note's attachment", async () => {
  const first = await service.remember(a, input("First")),
    second = await service.remember(a, input("Second")),
    id = randomUUID();
  assert.equal((await upload(first, id)).status, 201);
  for (const [principal, note, attachment] of [
    [a, second, id],
    [b, await service.remember(b, input("Foreign")), id],
    [a, first, randomUUID()],
  ] as const) {
    await assert.rejects(
      service.remember(
        principal,
        input(`![forged](${mediaReference(attachment)})`, {
          id: note.id,
          expectedVersion: note.version,
        }),
      ),
    );
    assert.equal((await service.get(principal, note.id)).version, note.version);
  }
  assert.equal((await db("media_objects")).length, 0);
  assert.equal(
    (await tenant(db, b.accountId, (trx) => trx("media_objects").where({ id })))
      .length,
    0,
  );
});

test("published metadata and revision bindings are immutable to runtime roles", async () => {
  const note = await service.remember(a, input("Immutable media")),
    id = randomUUID();
  assert.equal((await upload(note, id)).status, 201);
  await assert.rejects(
    tenant(db, a.accountId, (trx) =>
      trx("media_objects")
        .where({ id })
        .update({ sha256: "f".repeat(64) }),
    ),
    /immutable/,
  );
  await assert.rejects(
    tenant(db, a.accountId, (trx) =>
      trx("media_objects").where({ id }).delete(),
    ),
    /permission denied/,
  );
});

test("narrow agent grants cannot read another notebook's media or initiate uploads", async () => {
  const project = await service.project(a, {
    name: "Private images",
    identity: randomUUID(),
  });
  const note = await service.remember(
      a,
      input("Scoped media", { projectId: project.id }),
    ),
    id = randomUUID();
  assert.equal((await upload(note, id)).status, 201);
  await service.remember(
    a,
    input(`![scoped](${mediaReference(id)})`, {
      id: note.id,
      expectedVersion: note.version,
      projectId: project.id,
    }),
  );
  const { connection } = await service.grant(a, {
    name: "Personal-only",
    personal: true,
    allProjects: false,
    projectIds: [],
    capabilities: ["memory:read", "memory:write"],
  });
  const agent: Principal = {
    ...a,
    type: "key",
    connectionId: connection.id,
    sessionId: undefined,
  };
  const media = new MediaAttachments(service);
  await assert.rejects(media.read(agent, note.id, id), { code: "not_found" });
  await assert.rejects(
    media.claim(agent, {
      id: randomUUID(),
      memoryId: note.id,
      version: 2,
      mime: "image/png",
      bytes: png.length,
      sha256: createHash("sha256").update(png).digest("hex"),
    }),
    { code: "forbidden" },
  );
  await service.grant(
    a,
    {
      name: "Notebook read",
      personal: false,
      allProjects: false,
      projectIds: [project.id],
      capabilities: ["memory:read"],
    },
    { id: connection.id },
  );
  assert.equal((await media.read(agent, note.id, id)).bytes, png.length);
  await service.revoke(a, connection.id);
  await assert.rejects(media.read(agent, note.id, id), { code: "forbidden" });
});

test("concurrent upload claims reserve quota atomically and old leases cannot publish", async () => {
  const note = await service.remember(b, input("Quota race")),
    attachments = new MediaAttachments(service);
  const original = await admin("accounts").where({ id: b.accountId }).first();
  const make = () => ({
    id: randomUUID(),
    memoryId: note.id,
    version: note.version,
    mime: "image/png",
    bytes: png.length,
    sha256: createHash("sha256").update(png).digest("hex"),
  });
  await admin("accounts")
    .where({ id: b.accountId })
    .update({ mediaBytes: 1024 * 1024 * 1024 - png.length });
  try {
    const first = make(),
      second = make();
    const results = await Promise.allSettled([
      attachments.claim(b, first),
      attachments.claim(b, second),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const winner = results.findIndex((result) => result.status === "fulfilled"),
      reservation = (
        results[winner] as PromiseFulfilledResult<
          Awaited<ReturnType<typeof attachments.claim>>
        >
      ).value;
    const input = winner === 0 ? first : second;
    await assert.rejects(
      attachments.finish(b, input, randomUUID(), { width: 2, height: 2 }),
      { code: "media_changed" },
    );
    await admin("media_objects")
      .where({ accountId: b.accountId, id: input.id })
      .update({ leaseUntil: new Date(0) });
    await assert.rejects(
      attachments.finish(b, input, reservation.row.leaseId, {
        width: 2,
        height: 2,
      }),
      { code: "media_changed" },
    );
  } finally {
    await admin("accounts")
      .where({ id: b.accountId })
      .update({
        mediaBytes: original.mediaBytes,
        mediaAttempts: original.mediaAttempts,
      });
  }
});

test("public media follows live share scope, current revision and revocation", async () => {
  const sharing = new Sharing(service, {
    key: "ab".repeat(32),
    siteUrl: "http://localhost:3000",
  });
  const note = await service.remember(a, input("Public image")),
    id = randomUUID();
  assert.equal((await upload(note, id)).status, 201);
  const saved = await service.remember(
    a,
    input(`![red](${mediaReference(id)})`, {
      id: note.id,
      expectedVersion: note.version,
    }),
  );
  const shared = await sharing.enable(
    a,
    { kind: "note", id: note.id },
    {
      operationId: randomUUID(),
      expectedVersion: 0,
      expectedTargetVersion: saved.version,
      includeDescendants: false,
    },
  );
  const direct = shared.direct!;
  const token = new URL(direct.url!).pathname.split("/").at(-1)!;
  const path = `/public/shares/${token}/notes/${note.id}/media/${id}`;
  const response = await app.request(path);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  await service.remember(
    a,
    input("Removed image", { id: note.id, expectedVersion: saved.version }),
  );
  assert.equal((await app.request(path)).status, 404);
  assert.equal(
    (await app.request(`${path}?version=${saved.version}`)).status,
    404,
  );
  await sharing.change(a, direct.id, "revoke", {
    operationId: randomUUID(),
    expectedVersion: direct.version,
  });
  assert.equal((await app.request(path)).status, 404);
});

test("rejected uploads never publish references or bypass quotas through size/checksum lies", async () => {
  const note = await service.remember(a, input("Upload validation"));
  const response = await request(
    `/v1/memories/${note.id}/media/${randomUUID()}`,
    "PUT",
    new Uint8Array(png),
    {
      "content-type": "image/png",
      "content-length": "1",
      "x-grove-note-version": String(note.version),
      "x-grove-content-sha256": "0".repeat(64),
    },
  );
  assert.equal(response.status, 400);
  const fresh = await service.remember(a, input("Capacity"));
  await admin("accounts")
    .where({ id: a.accountId })
    .update({ mediaBytes: 1024 * 1024 * 1024 });
  assert.equal((await upload(fresh)).status, 429);
  await admin("accounts").where({ id: a.accountId }).update({ mediaBytes: 0 });
});

test("portable note archive contains exact image bytes and relative Markdown references", async () => {
  const note = await service.remember(a, input("Portable image")),
    id = randomUUID();
  assert.equal((await upload(note, id)).status, 201);
  const saved = await service.remember(
    a,
    input(`![red](${mediaReference(id)})`, {
      id: note.id,
      expectedVersion: note.version,
    }),
  );
  const response = await request(
    `/v1/memories/${note.id}/archive-file?version=${saved.version}`,
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("content-type"), "application/x-tar");
  const content = Buffer.from(await response.arrayBuffer()),
    entries = new Map<string, Buffer>();
  for (let offset = 0; offset < content.length && content[offset]; ) {
    const name = content
      .toString("utf8", offset, offset + 100)
      .replace(/\0.*$/s, "");
    const size = parseInt(
      content
        .toString("ascii", offset + 124, offset + 136)
        .replace(/\0.*$/s, "")
        .trim(),
      8,
    );
    entries.set(name, content.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(entries.get("note.md")?.toString(), `![red](media/${id}.png)`);
  assert.deepEqual(entries.get(`media/${id}.png`), png);
  const manifest = JSON.parse(entries.get("manifest.json")!.toString());
  assert.equal(manifest.version, 1);
  assert.equal(
    manifest.media[0].sha256,
    createHash("sha256").update(png).digest("hex"),
  );
  assert.equal(
    (await request(`/v1/memories/${note.id}/archive-file?version=1`)).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/v1/memories/${note.id}/archive-file`,
        "GET",
        undefined,
        {},
        "bob",
      )
    ).status,
    404,
  );
});

test("queued media-complete export carries checksummed original bytes and revision bindings", async () => {
  const note = await service.remember(b, input("Export media")),
    id = randomUUID();
  assert.equal((await upload(note, id, "bob")).status, 201);
  await service.remember(
    b,
    input(`![original](${mediaReference(id)})`, {
      id: note.id,
      expectedVersion: note.version,
    }),
  );
  const taskId = randomUUID();
  const response = await request(
    "/v1/exports",
    "POST",
    JSON.stringify({ id: taskId, includeMedia: true }),
    { "content-type": "application/json" },
    "bob",
  );
  assert.equal(response.status, 202, await response.clone().text());
  const workerUrl = new URL(url);
  workerUrl.username = "grove_jobs";
  workerUrl.password = "grove_disposable_worker";
  const worker = createDatabase(workerUrl.href),
    store = localArtifacts(`${root}/exports`);
  try {
    const handlers = (
      exportHandlers as (
        ...args: unknown[]
      ) => ReturnType<typeof exportHandlers>
    )(worker, store, localMedia(root));
    const tasks = new Tasks(service, true);
    for (let step = 0; step < 40; step++) {
      await runTask(worker, handlers, { id: taskId });
      if ((await tasks.get(b, taskId)).status === "succeeded") break;
    }
    const artifact = await tasks.artifact(b, taskId);
    const chunks: Buffer[] = [];
    for await (const chunk of await store.read(artifact.key))
      chunks.push(Buffer.from(chunk));
    const records = Buffer.concat(chunks)
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const metadata = records.find(
      (record) => record.type === "media_object" && record.id === id,
    );
    assert(metadata);
    assert(!("objectKey" in metadata));
    const bytes = Buffer.concat(
      records
        .filter((record) => record.type === "media_chunk" && record.id === id)
        .map((record) => Buffer.from(record.data, "base64")),
    );
    assert.deepEqual(bytes, png);
    assert.equal(
      metadata.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
  } finally {
    await worker.destroy();
  }
});
