import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant } from "@lib/database";
import { MemoryService } from "@lib/memory";
import { Authentication } from "../../packages/api/src/auth.ts";
import { type Principal } from "@lib/shared/contracts";

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
