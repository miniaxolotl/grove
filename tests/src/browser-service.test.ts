import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant } from "@lib/database";
import {
  MemoryService,
  Tasks,
  runTask,
  importHandlers,
  exportHandlers,
} from "@lib/memory";
import { mkdir, mkdtemp } from "node:fs/promises";
import { localArtifacts } from "../../packages/api/src/artifacts.ts";
import { Authentication } from "../../packages/api/src/auth.ts";
import { createApp } from "../../packages/api/src/app.ts";
import { GroveError, type Principal } from "@lib/shared/contracts";

const db = createDatabase(process.env.TEST_DATABASE_URL!);
const service = new MemoryService(
  db,
  "browser-test-cursor-secret-at-least-32-characters",
);
const auth = new Authentication(db, {
  async verify(token) {
    return { subject: token, type: "session" as const };
  },
});
let a: Principal, b: Principal;
before(async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  a = await auth.principal(
    new Request("http://localhost/v1/me", {
      headers: { authorization: `Bearer user_browser_${randomUUID()}` },
    }),
  );
  b = await auth.principal(
    new Request("http://localhost/v1/me", {
      headers: { authorization: `Bearer user_browser_${randomUUID()}` },
    }),
  );
});
after(() => db.destroy());

test("native extension origins require verified OAuth and never bypass website, key, grant or revocation boundaries", async () => {
  const clientId = randomUUID(),
    pendingClientId = randomUUID();
  const grant = {
    name: "Native browser origin test",
    capabilities: ["memory:read", "memory:write"] as (
      | "memory:read"
      | "memory:write"
    )[],
    personal: true,
    allProjects: false,
    projectIds: [],
  };
  const approved = await service.grant(a, grant, { clientId });
  const key = await service.grant(a, grant, { key: true });
  const authentication = new Authentication(db, {
    async verify(token) {
      if (token === "native-owner-session")
        return {
          subject: a.subject,
          type: "session" as const,
          sessionId: "native-test-session",
        };
      if (token === "native-oauth" || token === "native-pending")
        return {
          subject: a.subject,
          type: "oauth" as const,
          clientId: token === "native-oauth" ? clientId : pendingClientId,
          issuedAt: Date.now(),
          scopes: ["openid"],
        };
      throw new GroveError("unauthorized", "Invalid test token", 401);
    },
  });
  const api = createApp({
    memories: service,
    auth: authentication,
    origin: "https://api.grove.example",
    siteUrl: "https://grove.example",
    issuer: "https://issuer.grove.example",
    webhookSecret: "fixture-only",
    ready: async () => {},
  });
  const request = (
    path: string,
    origin: string,
    token: string,
    body: unknown = {},
  ) =>
    api.request(path, {
      method: "POST",
      headers: {
        Origin: origin,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const origins = [
    `chrome-extension://${"a".repeat(32)}`,
    "moz-extension://00000000-0000-4000-a000-000000000001",
  ];
  for (const origin of origins) {
    const connected = await request(
      "/v1/browser/connect",
      origin,
      "native-oauth",
    );
    assert.equal(
      connected.status,
      200,
      `approved OAuth connects from ${origin}`,
    );
    assert.notEqual(
      connected.headers.get("Access-Control-Allow-Origin"),
      "*",
      "website CORS must not become a wildcard",
    );
    const saved = await request(
      "/v1/browser/captures",
      origin,
      "native-oauth",
      {
        operationId: randomUUID(),
        content: "Native HTTP origin capture",
        projectId: null,
        capture: "explicit",
      },
    );
    assert.equal(saved.status, 200);
    assert.equal(
      (await request("/v1/browser/connect", origin, "native-owner-session"))
        .status,
      403,
    );
    assert.equal(
      (await request("/v1/browser/connect", origin, key.secret!)).status,
      403,
    );
    assert.equal(
      (await request("/v1/browser/connect", origin, "invalid-token")).status,
      401,
    );
  }
  for (const origin of [
    "https://evil.example",
    "null",
    `chrome-extension://${"z".repeat(32)}`,
    `chrome-extension://${"a".repeat(32)}/path`,
    "moz-extension://invalid",
  ])
    assert.equal(
      (await request("/v1/browser/connect", origin, "native-oauth")).status,
      403,
    );
  assert.equal(
    (
      await request(
        "/v1/browser/connect",
        "https://grove.example",
        "native-owner-session",
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/v1/browser/connect", origins[0], "native-pending")).status,
    200,
  );
  assert.equal(
    (
      await request("/v1/browser/captures", origins[0], "native-pending", {
        operationId: randomUUID(),
        content: "Must remain unapproved",
        projectId: null,
        capture: "explicit",
      })
    ).status,
    403,
  );
  await service.revoke(a, approved.connection.id);
  assert.equal(
    (await request("/v1/browser/connect", origins[0], "native-oauth")).status,
    403,
  );
});

test("durable exports include source provenance without changing structured note bodies", async () => {
  const workerDb = createDatabase(process.env.TEST_WORKER_DATABASE_URL!);
  try {
    const store = localArtifacts(
      await mkdtemp("/tmp/opencode/grove-browser-export-"),
    );
    const tasks = new Tasks(service, true),
      handlers = exportHandlers(workerDb, store);
    const project = await service.project(a, {
      name: "Browser export",
      identity: `browser-export-${randomUUID()}`,
    });
    const provenance = {
      url: "https://example.com/export?utm_source=fixture",
      title: "Export source",
      capturedAt: "2026-11-05T12:00:00Z",
    };
    const note = await service.captureWeb(a, {
      operationId: randomUUID(),
      content: "Exported browser note",
      projectId: project.id,
      capture: "explicit",
      provenance,
    });
    const task = await tasks.export(a, {
      id: randomUUID(),
      projectId: project.id,
      includeDescendants: false,
    });
    for (let i = 0; i < 40; i++)
      if (!(await runTask(workerDb, handlers, { id: task.id }))) break;
    assert.equal((await tasks.get(a, task.id)).downloadable, true);
    const artifact = await tasks.artifact(a, task.id),
      chunks: Buffer[] = [];
    for await (const chunk of await store.read(artifact.key))
      chunks.push(chunk);
    const rows = Buffer.concat(chunks)
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const exported = rows.find(
      (row) => row.type === "note" && row.id === note.id,
    );
    assert.equal(exported.content, note.content);
    assert.deepEqual(exported.webCapture, {
      ...provenance,
      url: "https://example.com/export",
    });
  } finally {
    await workerDb.destroy();
  }
});

test("queued imports preserve provenance through replay and provenance-only changes", async () => {
  const workerDb = createDatabase(process.env.TEST_WORKER_DATABASE_URL!);
  try {
    const tasks = new Tasks(service, false),
      handlers = importHandlers(
        new MemoryService(
          workerDb,
          "browser-test-cursor-secret-at-least-32-characters",
        ),
      );
    const sourceId = randomUUID(),
      source = `browser-${randomUUID()}`;
    const url = `https://example.com/import/${sourceId}`;
    for (const title of ["Original", "Original", "Revised attribution"]) {
      const task = await tasks.import(a, {
        id: randomUUID(),
        source,
        records: [
          {
            sourceId,
            content: "Imported source note",
            projectId: null,
            webCapture: { url, title, capturedAt: "2026-11-05T12:00:00Z" },
          },
        ],
      });
      await runTask(workerDb, handlers, { id: task.id });
      assert.equal((await tasks.get(a, task.id)).status, "succeeded");
      const notes = await service.pageCaptures(a, { url, projectId: null });
      assert.equal(notes.items.length, 1);
      await tenant(db, a.accountId, async (trx) => {
        const capture = await trx("web_captures")
          .where({ memoryId: notes.items[0].id, active: true })
          .first();
        assert.equal(capture.provenance.title, title);
      });
    }
  } finally {
    await workerDb.destroy();
  }
});

test("browser capture service commits provenance and scope-checked replay atomically", async (t) => {
  assert.equal(typeof service.captureWeb, "function");
  assert.equal(typeof service.webCaptureStatus, "function");
  assert.equal(typeof service.pageCaptures, "function");
  const command = () => ({
    operationId: randomUUID(),
    content: "A useful external observation",
    projectId: null,
    capture: "explicit" as const,
    provenance: {
      url: "https://example.com/docs?utm_source=test&id=1",
      title: "Docs",
      capturedAt: new Date().toISOString(),
    },
  });

  await t.test(
    "provenance follows the owning note's physical retention boundary",
    async () => {
      const constraints = await db.raw(
        "SELECT confdeltype FROM pg_constraint WHERE conrelid='web_captures'::regclass AND contype='f'",
      );
      assert.equal(constraints.rows[0].confdeltype, "c");
    },
  );

  await t.test(
    "page cursors bind URL, tenant and notebook and never duplicate a page",
    async () => {
      const url = `https://example.com/pagination/${randomUUID()}`;
      for (let i = 0; i < 22; i++)
        await service.captureWeb(a, {
          ...command(),
          provenance: {
            url,
            title: "Paging",
            capturedAt: new Date().toISOString(),
          },
        });
      const first = await service.pageCaptures(a, { url, projectId: null });
      assert.equal(first.items.length, 20);
      assert.ok(first.nextCursor);
      const second = await service.pageCaptures(a, {
        url,
        projectId: null,
        cursor: first.nextCursor!,
      });
      assert.equal(second.items.length, 2);
      assert.equal(second.nextCursor, null);
      assert.equal(
        new Set([...first.items, ...second.items].map((item) => item.id)).size,
        22,
      );
      await assert.rejects(
        service.pageCaptures(b, {
          url,
          projectId: null,
          cursor: first.nextCursor!,
        }),
      );
      await assert.rejects(
        service.pageCaptures(a, {
          url: `${url}/different`,
          projectId: null,
          cursor: first.nextCursor!,
        }),
      );
    },
  );

  await t.test(
    "replay returns one note, conflicts on changed data and hides other accounts",
    async () => {
      const input = command();
      const first = await service.captureWeb(a, input);
      assert.equal((await service.captureWeb(a, input)).id, first.id);
      await assert.rejects(
        service.captureWeb(a, { ...input, content: "Changed" }),
        { code: "operation_conflict" },
      );
      const found = await service.pageCaptures(a, {
        url: "https://example.com/docs?id=1",
        projectId: null,
      });
      assert.ok(found.items.some((note) => note.id === first.id));
      assert.equal(
        (
          await service.pageCaptures(b, {
            url: input.provenance.url,
            projectId: null,
          })
        ).items.length,
        0,
      );
      assert.equal((await db("memories").where({ id: first.id })).length, 0);
      const status = await service.webCaptureStatus(a, input.operationId);
      assert.equal(status.noteId, first.id);
      await assert.rejects(service.webCaptureStatus(b, input.operationId), {
        code: "not_found",
      });
      await service.forget(a, {
        operationId: randomUUID(),
        items: [{ id: first.id, expectedVersion: first.version }],
      });
      await assert.rejects(service.captureWeb(a, input), { code: "gone" });
      assert.equal(
        (
          await service.pageCaptures(a, {
            url: input.provenance.url,
            projectId: null,
          })
        ).items.length,
        0,
      );
    },
  );

  await t.test(
    "content edits invalidate page association at the database boundary",
    async () => {
      const input = command();
      const note = await service.captureWeb(a, input);
      const before = await service.getMemoryDocument(a, note.id);
      assert.equal(
        before.blocks.map((block) => block.source).join(""),
        input.content,
      );
      await service.updateMemory(a, {
        operationId: randomUUID(),
        id: note.id,
        expectedVersion: note.version,
        edits: [{ from: 2, to: 8, oldText: "useful", text: "bounded" }],
        capture: "explicit",
      });
      const after = await service.getMemoryDocument(a, note.id);
      assert.equal(
        after.blocks.map((block) => block.source).join(""),
        "A bounded external observation",
      );
      assert.equal(
        (
          await service.pageCaptures(a, {
            url: input.provenance.url,
            projectId: null,
          })
        ).items.some((item) => item.id === note.id),
        false,
      );
    },
  );

  await t.test(
    "guarded autosave updates one note behind a version fence and never rebases silently",
    async () => {
      const url = `https://example.com/autosave/${randomUUID()}`;
      const provenance = {
        url,
        title: "Source",
        capturedAt: new Date().toISOString(),
      };
      const note = await service.captureWeb(a, {
        operationId: randomUUID(),
        content: "A first note",
        projectId: null,
        capture: "explicit" as const,
        provenance,
      });
      const editSession = randomUUID();
      const edit = (expectedVersion: number, content: string) => ({
        operationId: randomUUID(),
        id: note.id,
        expectedVersion,
        editSession,
        content,
        projectId: null,
        capture: "explicit" as const,
        provenance,
      });
      const first = edit(note.version, "A first note, edited");
      const updated = await service.captureWeb(a, first);
      assert.equal(updated.id, note.id);
      assert.equal(updated.version, note.version + 1);
      assert.equal(
        (await service.captureWeb(a, first)).version,
        updated.version,
        "replaying the same operation settles on its receipt",
      );
      assert.equal(
        (
          await service.captureWeb(
            a,
            edit(updated.version, "A first note, edited"),
          )
        ).version,
        updated.version,
        "identical autosaves do not mint revisions",
      );
      assert.equal(
        (await service.pageCaptures(a, { url, projectId: null })).items.length,
        1,
        "updates rebind provenance instead of listing a second page note",
      );
      await assert.rejects(
        service.captureWeb(b, edit(updated.version, "Another account")),
        "other accounts cannot update this note",
      );
      await assert.rejects(
        service.captureWeb(a, edit(note.version, "Stale edit")),
        /changed/i,
        "a stale expectedVersion fences concurrent writers",
      );
      const external = await service.updateMemory(a, {
        operationId: randomUUID(),
        id: note.id,
        expectedVersion: updated.version,
        content: "Another writer's note",
        capture: "explicit",
      });
      await assert.rejects(
        service.captureWeb(a, first),
        /changed|current/i,
        "an old receipt never grants a newer version fence",
      );
      assert.equal(
        (await service.webCaptureStatus(a, first.operationId)).version,
        updated.version,
      );
      assert.equal(
        (await service.get(a, external.id)).content,
        "Another writer's note",
        "a conflicting autosave never rebases the saved note",
      );
    },
  );

  await t.test(
    "read/write grants, scope changes and revoked connections are rechecked",
    async () => {
      const { connection } = await service.grant(
        a,
        {
          name: "Browser test",
          capabilities: ["memory:read", "memory:write"],
          personal: true,
          allProjects: false,
          projectIds: [],
        },
        { clientId: randomUUID() },
      );
      const principal: Principal = {
        ...a,
        type: "oauth",
        sessionId: undefined,
        connectionId: connection.id,
        clientId: connection.clientId!,
        issuedAt: Date.now(),
      };
      const input = command();
      const note = await service.captureWeb(principal, input);
      await assert.rejects(
        service.captureWeb(principal, {
          ...command(),
          projectId: randomUUID(),
        }),
        { code: "forbidden" },
      );
      await tenant(db, a.accountId, (trx) =>
        trx("connections")
          .where({ id: connection.id })
          .update({ capabilities: ["memory:read"] }),
      );
      await assert.rejects(service.captureWeb(principal, command()), {
        code: "forbidden",
      });
      assert.equal(
        (await service.webCaptureStatus(principal, input.operationId)).noteId,
        note.id,
      );
      await service.revoke(a, connection.id);
      await assert.rejects(
        service.pageCaptures(principal, {
          url: input.provenance.url,
          projectId: null,
        }),
        { code: "forbidden" },
      );
    },
  );
});
