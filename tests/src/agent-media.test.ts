import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createDatabase } from "@lib/database";
import {
  MemoryService,
  MediaAttachments,
  executeMemoryTool,
} from "@lib/memory";
import { rememberSchema, type Principal } from "@lib/shared/contracts";
import { mediaReference } from "@lib/shared/media";
import {
  listNoteMediaSchema,
  describeNoteMediaSchema,
  readMediaTranscriptSchema,
} from "@lib/shared/agent-media";
import { Authentication } from "../../packages/api/src/auth.ts";
import sharp from "sharp";

const url = process.env.TEST_DATABASE_URL!;
const owner = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!url || !owner || !new URL(owner).pathname.endsWith("_test"))
  throw Error("Use disposable test databases");
const db = createDatabase(url);
const adminDb = createDatabase(owner);
const service = new MemoryService(db, "agent-media-test-cursor-32-char-secr");
const subjects = {
  alice: `user_agentmedia_${randomUUID()}`,
  bob: `user_agentmedia_${randomUUID()}`,
};
const auth = new Authentication(db, {
  async verify(token) {
    return {
      subject: subjects[token as keyof typeof subjects],
      type: "session",
      sessionId: `sess_agentmedia_${token}`,
    };
  },
});
let a: Principal;
let b: Principal;
let png: Buffer;
const input = (content: string, extra = {}) =>
  rememberSchema.parse({ operationId: randomUUID(), content, ...extra });

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
  png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
});

after(async () => {
  await Promise.all([db.destroy(), adminDb.destroy()]);
});

async function agentFor(
  ownerPrincipal: Principal,
  opts: {
    personal: boolean;
    projectIds: string[];
    capabilities: ("memory:read" | "memory:write")[];
  },
): Promise<Principal> {
  const { connection } = await service.grant(ownerPrincipal, {
    name: `agent-media-${randomUUID()}`,
    personal: opts.personal,
    allProjects: false,
    projectIds: opts.projectIds,
    capabilities: opts.capabilities,
  });
  return {
    ...ownerPrincipal,
    type: "key",
    connectionId: connection.id,
    sessionId: undefined,
  } as Principal;
}

test("agent media tools validate schemas and expose no keys", () => {
  const memoryId = randomUUID();
  const mediaId = randomUUID();
  assert.equal(
    listNoteMediaSchema.parse({ memoryId }).memoryId,
    memoryId,
  );
  assert.equal(
    describeNoteMediaSchema.parse({ memoryId, mediaId }).mediaId,
    mediaId,
  );
  assert.equal(
    readMediaTranscriptSchema.parse({ memoryId, mediaId }).mediaId,
    mediaId,
  );
  assert.throws(() => listNoteMediaSchema.parse({ memoryId: "bad" }));
});

test("scoped agents discover bound media and transcripts without byte/key leaks", async () => {
  const note = await service.remember(a, input("Agent media note"));
  const id = randomUUID();
  const sha = createHash("sha256").update(png).digest("hex");
  const attachments = new MediaAttachments(service);
  const claimed = await attachments.claim(a, {
    id,
    memoryId: note.id,
    version: note.version,
    mime: "image/png",
    bytes: png.length,
    sha256: sha,
  });
  assert.equal(claimed.replay, false);
  await attachments.finish(
    a,
    {
      id,
      memoryId: note.id,
      version: note.version,
      mime: "image/png",
      bytes: png.length,
      sha256: sha,
    },
    claimed.row.leaseId,
    { width: 2, height: 2 },
  );
  const bound = await service.remember(
    a,
    input(`Scoped image\n![red](${mediaReference(id)})`, {
      id: note.id,
      expectedVersion: note.version,
    }),
  );
  const projectId = bound.projectId;
  const agent = await agentFor(a, {
    personal: projectId === null,
    projectIds: projectId === null ? [] : [projectId],
    capabilities: ["memory:read"],
  });
  const listed = (await executeMemoryTool(service, agent, "list_note_media", {
    memoryId: note.id,
  })) as Array<Record<string, unknown>>;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, id);
  assert.equal(listed[0].reference, mediaReference(id));
  assert.equal(listed[0].mime, "image/png");
  const serialized = JSON.stringify(listed);
  assert.ok(!serialized.includes("objectKey"));
  assert.ok(!serialized.includes("sha256"));
  assert.ok(!serialized.includes(sha));
  const described = (await executeMemoryTool(
    service,
    agent,
    "describe_note_media",
    { memoryId: note.id, mediaId: id },
  )) as Record<string, unknown>;
  assert.equal(described.id, id);
  // Foreign tenant cannot enumerate or describe.
  await assert.rejects(
    executeMemoryTool(service, b, "list_note_media", { memoryId: note.id }),
    { code: "not_found" },
  );
  await service.revoke(a, (agent as { connectionId: string }).connectionId);
});

test("agents with memory:write on the note scope can attach and save transcripts", async () => {
  const project = await service.project(a, {
    name: `Agent upload ${randomUUID()}`,
    identity: randomUUID(),
  });
  const note = await service.remember(
    a,
    input("Agent upload note", { projectId: project.id }),
  );
  const writer = await agentFor(a, {
    personal: false,
    projectIds: [project.id],
    capabilities: ["memory:read", "memory:write"],
  });
  const attachments = new MediaAttachments(service);
  const id = randomUUID();
  const sha = createHash("sha256").update(png).digest("hex");
  const claimed = await attachments.claim(writer, {
    id,
    memoryId: note.id,
    version: note.version,
    mime: "image/png",
    bytes: png.length,
    sha256: sha,
  });
  assert.equal(claimed.replay, false);
  // Cross-note transfer is rejected even with write scope.
  const other = await service.remember(
    a,
    input("Other note", { projectId: project.id }),
  );
  await assert.rejects(
    attachments.claim(writer, {
      id,
      memoryId: other.id,
      version: other.version,
      mime: "image/png",
      bytes: png.length,
      sha256: sha,
    }),
    { code: "media_changed" },
  );
  await attachments.fail(writer, id, claimed.row.leaseId);
  await service.revoke(a, (writer as { connectionId: string }).connectionId);
});

test("unknown agent tool names stay rejected", async () => {
  await assert.rejects(executeMemoryTool(service, a, "upload_media_bytes", {}), {
    code: "not_found",
  });
});
