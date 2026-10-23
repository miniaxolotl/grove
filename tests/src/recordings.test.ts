import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createDatabase, tenant } from "@lib/database";
import { MemoryService } from "@lib/memory";
import { rememberSchema, type Principal } from "@lib/shared/contracts";
import { Authentication } from "../../packages/api/src/auth.ts";
import { createApp } from "../../packages/api/src/app.ts";
import { localMedia } from "../../packages/api/src/media-store.ts";
const db = createDatabase(process.env.TEST_DATABASE_URL!);
const service = new MemoryService(
  db,
  "recordings-test-cursor-secret-32-characters",
);
let root: string, principal: Principal, app: ReturnType<typeof createApp>;
const subject = `recordings_${randomUUID()}`;
const auth = new Authentication(db, {
  async verify() {
    return { subject, type: "session", sessionId: subject };
  },
});
function wave(seconds = 1) {
  const frames = 16000 * seconds,
    buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    buffer.writeInt16LE(Math.round(Math.sin(i / 12) * 1000), 44 + i * 2);
  return buffer;
}
before(async () => {
  root = await mkdtemp("/tmp/opencode/grove-recordings-");
  const media = localMedia(root);
  await media.ready();
  principal = await auth.principal(
    new Request("http://localhost", {
      headers: { authorization: "Bearer fixture" },
    }),
  );
  app = createApp({
    memories: service,
    auth,
    media,
    origin: "http://localhost",
    siteUrl: "http://localhost",
    issuer: "https://clerk.example.test",
    webhookSecret: "test",
    ready: async () => {},
  });
});
after(async () => {
  await db.destroy();
  if (root) await rm(root, { recursive: true, force: true });
});
const req = (path: string, method = "GET", body?: BodyInit, headers = {}) =>
  app.request(path, {
    method,
    body,
    headers: { authorization: "Bearer fixture", ...headers },
  });
async function attach(bytes: Buffer = wave()) {
  const note = await service.remember(
      principal,
      rememberSchema.parse({
        operationId: randomUUID(),
        content: "Voice notebook",
      }),
    ),
    id = randomUUID();
  const response = await req(
    `/v1/memories/${note.id}/media/${id}`,
    "PUT",
    new Uint8Array(bytes),
    {
      "content-type": "audio/wav",
      "content-length": String(bytes.length),
      "x-grove-note-version": String(note.version),
      "x-grove-content-sha256": createHash("sha256")
        .update(bytes)
        .digest("hex"),
    },
  );
  return { note, id, response, bytes };
}
test("original WAV recordings survive save and expose authorized range/HEAD playback", async () => {
  const { note, id, response, bytes } = await attach();
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal((await response.json()).data.durationMs, 1000);
  await service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: note.id,
      expectedVersion: note.version,
      content: `[Recording](grove-media:${id})`,
    }),
  );
  const path = `/v1/memories/${note.id}/media/${id}`;
  const range = await req(path, "GET", undefined, { range: "bytes=44-63" });
  assert.equal(range.status, 206);
  assert.equal(
    range.headers.get("content-range"),
    `bytes 44-63/${bytes.length}`,
  );
  assert.deepEqual(
    Buffer.from(await range.arrayBuffer()),
    bytes.subarray(44, 64),
  );
  const head = await req(path, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(
    (await req(path, "GET", undefined, { range: `bytes=${bytes.length}-` }))
      .status,
    416,
  );
  assert.equal(
    (await req(path, "GET", undefined, { range: "bytes=0-1,4-5" })).status,
    416,
  );
});
test("audio validation rejects truncated, compressed, excessive-duration and forged RIFF content", async () => {
  for (const bytes of [
    wave().subarray(0, 100),
    Buffer.from("RIFFnot an audio file"),
    wave(61),
    (() => {
      const bytes = wave();
      bytes.writeUInt16LE(3, 20);
      return bytes;
    })(),
  ])
    assert.equal((await attach(bytes)).response.status, 400);
});
test("transcript edits are version checked and retry safe, preserving the original recording", async () => {
  const { note, id, response, bytes } = await attach();
  assert.equal(response.status, 201);
  await service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: note.id,
      expectedVersion: note.version,
      content: `[Recording](grove-media:${id})`,
    }),
  );
  const path = `/v1/memories/${note.id}/media/${id}/transcript`,
    operationId = randomUUID();
  const empty = await req(path);
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).data.text, "");
  const body = JSON.stringify({
    operationId,
    expectedVersion: 0,
    text: "Meet on Thursday.",
  });
  const saved = await req(path, "PATCH", body, {
    "content-type": "application/json",
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).data.version, 1);
  assert.equal(
    (await req(path, "PATCH", body, { "content-type": "application/json" }))
      .status,
    200,
  );
  assert.equal(
    (
      await req(
        path,
        "PATCH",
        JSON.stringify({
          operationId: randomUUID(),
          expectedVersion: 0,
          text: "stale",
        }),
        { "content-type": "application/json" },
      )
    ).status,
    409,
  );
  assert.deepEqual(
    Buffer.from(
      await (await req(`/v1/memories/${note.id}/media/${id}`)).arrayBuffer(),
    ),
    bytes,
  );
  const updated = await req(
    path,
    "PATCH",
    JSON.stringify({
      operationId: randomUUID(),
      expectedVersion: 1,
      text: "Meet on Friday.",
    }),
    { "content-type": "application/json" },
  );
  assert.equal(updated.status, 200);
  const revisions = await tenant(db, principal.accountId, (trx) =>
    trx("media_transcript_revisions").where({ mediaId: id }).orderBy("version"),
  );
  assert.deepEqual(
    revisions.map((row) => row.text),
    ["Meet on Thursday.", "Meet on Friday."],
  );
  const archive = await req(`/v1/memories/${note.id}/archive-file?version=2`);
  assert.equal(archive.status, 200);
  const tar = Buffer.from(await archive.arrayBuffer());
  assert(tar.includes(bytes));
  assert(tar.includes(Buffer.from(`media/${id}.txt`)));
  assert(tar.includes(Buffer.from("Meet on Friday.")));
});
