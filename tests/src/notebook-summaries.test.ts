import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Knex } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { rememberSchema } from "@lib/shared/contracts";
import { notebookSummarySchema } from "@lib/shared/summaries";
import type { Providers, Source } from "@lib/ai";

const authorityUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!authorityUrl || !new URL(authorityUrl).pathname.endsWith("_test"))
  throw new Error("Use a disposable test database");
const authority = createDatabase(authorityUrl);
const name = `grove_summaries_${randomUUID().replaceAll("-", "")}_test`;
let db: Knex, workerDb: Knex, admin: Knex;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = (url: string) => {
    const parsed = new URL(url);
    parsed.pathname = `/${name}`;
    return parsed.href;
  };
  admin = createDatabase(target(authorityUrl));
  await admin.migrate.latest();
  db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  workerDb = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
});
after(async () => {
  await Promise.all([db?.destroy(), workerDb?.destroy(), admin?.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
  await authority.destroy();
});

async function fixture() {
  const subject = `summaries_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  const calls: { instruction: string; sources: Source[] }[] = [];
  const providers: Providers = {
    generation: {
      profile: `summary-test-${randomUUID()}`,
      generate: async (schema, instruction, sources) => {
        assert.equal(schema, notebookSummarySchema);
        assert(sources.reduce((n, s) => n + s.content.length, 0) <= 24000);
        calls.push({ instruction, sources });
        return schema.parse({
          title: "Travel plans",
          sections: [
            {
              heading: "Bookings",
              statements: [...sources]
                .sort(
                  (a, b) =>
                    Number(b.content.includes("IMPORTANT")) -
                    Number(a.content.includes("IMPORTANT")),
                )
                .slice(0, 3)
                .map((s) => ({
                  text: s.content.slice(0, 300),
                  sources: [
                    {
                      id: s.id,
                      version: s.version,
                      quote: s.content.slice(0, 300),
                    },
                  ],
                })),
            },
          ],
        });
      },
    },
  };
  const service = new MemoryService(
    db,
    "summary-secret-32-characters-long",
    undefined,
    providers,
  );
  let worker = new MemoryService(
    workerDb,
    service.cursorSecret,
    undefined,
    providers,
  );
  await service.settings(principal, {
    titlesTagsEnabled: false,
    classificationEnabled: false,
    noteConnectionsEnabled: false,
    notebookConnectionsEnabled: false,
    personalSummaryEnabled: false,
    progressSummariesEnabled: false,
  });
  const project = await service.project(principal, {
    name: "Trip",
    identity: randomUUID(),
  });
  const save = (content: string, extra = {}) =>
    service.remember(
      principal,
      rememberSchema.parse({
        operationId: randomUUID(),
        projectId: project.id,
        content,
        ...extra,
      }),
    );
  const step = async () => {
    await admin("jobs")
      .where({ accountId: principal.accountId })
      .whereNull("failedAt")
      .update({ dueAt: admin.fn.now() });
    return worker.runJob();
  };
  const drain = async () => {
    for (let i = 0; i < 1000; i++) if (!(await step())) return;
    assert.fail("Summary did not converge");
  };
  const brief = () => service.brief(principal, { projectId: project.id });
  return {
    service,
    principal,
    project,
    save,
    step,
    drain,
    brief,
    calls,
    providers,
    restart: () => {
      worker = new MemoryService(
        workerDb,
        service.cursorSecret,
        undefined,
        providers,
      );
    },
  };
}

test("summaries examine older notes beyond the old cap, resume after restart, and reuse unchanged fragments", async () => {
  const f = await fixture();
  const important = await f.save("IMPORTANT: Book the night train to Kyoto.");
  for (let i = 0; i < 85; i++)
    await f.save(`Trip research ${i}: ${"Check local transport. ".repeat(20)}`);
  for (let i = 0; i < 12; i++) await f.step();
  f.restart();
  await f.drain();
  const result = await f.brief();
  assert.equal(result.status, "ready");
  assert.deepEqual(result.coverage, { total: 86, examined: 86, cited: 3 });
  assert(
    result.content?.sections.some((s) =>
      s.statements.some((s) => s.sources.some((r) => r.id === important.id)),
    ),
  );
  assert(f.calls.every((c) => c.instruction.includes("actual subject")));
  const firstCalls = f.calls.length;
  await f.service.brief(f.principal, { projectId: f.project.id }, true);
  await f.drain();
  assert.equal(f.calls.length, firstCalls);
  await f.save("IMPORTANT: Book the daytime train to Kyoto.", {
    id: important.id,
    expectedVersion: 1,
  });
  await f.drain();
  assert(f.calls.length > firstCalls);
  assert(
    f.calls.length - firstCalls < firstCalls / 2,
    "one edit should only rebuild its branch",
  );
  assert.equal((await f.brief()).status, "ready");
  assert(
    (await f.brief()).content?.sections.some((s) =>
      s.statements.some((s) => s.text.includes("daytime")),
    ),
  );
});

test("unrelated notebook changes preserve summaries; moves refresh both scopes and soft deletion scrubs fragments", async () => {
  const f = await fixture();
  const note = await f.save("Book the ferry to Victoria.");
  await f.drain();
  const ready = await f.brief();
  const other = await f.service.project(f.principal, {
    name: "Garden",
    identity: randomUUID(),
  });
  await f.save("Plant spring bulbs.", { projectId: other.id });
  assert.deepEqual(await f.brief(), ready);
  await f.save(note.content, {
    id: note.id,
    expectedVersion: 1,
    projectId: other.id,
  });
  assert.equal((await f.brief()).content, null);
  await f.drain();
  assert.equal((await f.brief()).sourceCount, 0);
  assert.equal(
    (await f.service.brief(f.principal, { projectId: other.id })).sourceCount,
    2,
  );
  await f.service.forget(f.principal, {
    operationId: randomUUID(),
    items: [{ id: note.id, expectedVersion: 2 }],
  });
  assert.equal(
    (
      await admin("notebook_summary_nodes").where({
        accountId: f.principal.accountId,
        projectId: other.id,
      })
    ).length,
    0,
  );
  assert.equal((await db("notebook_summary_nodes")).length, 0);
  const otherAccount = await fixture();
  await assert.rejects(
    otherAccount.service.brief(otherAccount.principal, {
      projectId: f.project.id,
    }),
    { code: "not_found" },
  );
});

test("disabled-and-reenabled preferences fence a held summary and malformed quotes cannot publish", async () => {
  const f = await fixture();
  await f.save("Reserve the garden tour.");
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const generate = f.providers.generation!.generate;
  f.providers.generation!.generate = async (...args) => {
    entered();
    await held;
    return generate(...args);
  };
  const running = f.step();
  await started;
  await f.service.settings(f.principal, { notebookSummariesEnabled: false });
  await f.service.settings(f.principal, { notebookSummariesEnabled: true });
  release();
  await running;
  assert.equal((await f.brief()).status, "pending");
  assert.equal(
    (
      await admin("notebook_summary_nodes").where({
        accountId: f.principal.accountId,
      })
    ).length,
    0,
  );
  f.providers.generation!.generate = async (schema, _instruction, sources) =>
    schema.parse({
      title: "Invalid",
      sections: [
        {
          heading: "Plans",
          statements: [
            {
              text: "Unsupported",
              sources: [
                {
                  id: sources[0].id,
                  version: sources[0].version,
                  quote: "Not in the original note.",
                },
              ],
            },
          ],
        },
      ],
    });
  await f.drain();
  assert.equal((await f.brief()).status, "failed");
  assert.equal((await f.brief()).content, null);
  f.providers.generation!.generate = generate;
  await f.service.brief(f.principal, { projectId: f.project.id }, true);
  await f.drain();
  assert.equal((await f.brief()).status, "ready");
});

test("uncited expiry invalidates a ready summary without waiting for maintenance", async () => {
  const f = await fixture();
  await f.save("Train booking.");
  await f.save("Hotel booking.");
  await f.save("Ferry booking.");
  const expiring = await f.save("Museum booking.", { retentionDays: 1 });
  const generate = f.providers.generation!.generate;
  f.providers.generation!.generate = (schema, prompt, sources, options) =>
    generate(
      schema,
      prompt,
      sources.filter((s) => s.id !== expiring.id),
      options,
    );
  const [row] = await admin("memories")
    .where({ id: expiring.id })
    .update({ expiresAt: admin.raw("now()+interval '3 seconds'") })
    .returning("expiresAt");
  await f.drain();
  const result = await f.brief();
  assert.equal(result.status, "ready");
  assert(
    !result.content!.sections.some((s) =>
      s.statements.some((s) => s.sources.some((s) => s.id === expiring.id)),
    ),
  );
  await admin.raw(
    "SELECT pg_sleep(greatest(0,extract(epoch from (?::timestamptz-now())))+0.05)",
    [row.expiresAt],
  );
  assert.equal((await f.brief()).status, "pending");
});

test("exact source reads reach old revisions and enforce current scope, expiry and deletion", async () => {
  const f = await fixture();
  const note = await f.save("Original itinerary.");
  await admin("memory_revisions").insert(
    Array.from({ length: 101 }, (_, i) => ({
      accountId: f.principal.accountId,
      memoryId: note.id,
      version: i + 2,
      content: `Updated itinerary ${i + 2}.`,
      source: JSON.stringify({ agent: "website" }),
    })),
  );
  await admin("memories")
    .where({ id: note.id })
    .update({ version: 102, content: "Updated itinerary 102." });
  assert.equal(
    (await f.service.revisions(f.principal, note.id)).some(
      (r) => r.version === 1,
    ),
    false,
  );
  assert.equal(
    (await f.service.sourceRevision(f.principal, note.id, 1)).content,
    "Original itinerary.",
  );
  assert.equal(
    (await f.service.sourceRevision(f.principal, note.id, 1)).currentVersion,
    102,
  );
  const grant = await f.service.grant(
    f.principal,
    {
      name: "Other notebooks",
      capabilities: ["memory:read"],
      personal: true,
      allProjects: false,
      projectIds: [],
    },
    { key: true },
  );
  await assert.rejects(
    f.service.sourceRevision(
      {
        ...f.principal,
        type: "key",
        connectionId: grant.connection.id,
        capabilities: ["memory:read"],
      },
      note.id,
      1,
    ),
    { code: "not_found" },
  );
  const other = await fixture();
  await assert.rejects(
    other.service.sourceRevision(other.principal, note.id, 1),
    { code: "not_found" },
  );
  await f.service.forget(f.principal, {
    operationId: randomUUID(),
    items: [{ id: note.id, expectedVersion: 102 }],
  });
  await assert.rejects(f.service.sourceRevision(f.principal, note.id, 1), {
    code: "not_found",
  });
  assert.equal(
    (await admin("memory_revisions").where({ memoryId: note.id })).length,
    102,
  );
  const expired = await f.save("Temporary booking.", { retentionDays: 1 });
  await admin("memories")
    .where({ id: expired.id })
    .update({ expiresAt: admin.raw("now()-interval '1 second'") });
  await assert.rejects(f.service.sourceRevision(f.principal, expired.id, 1), {
    code: "not_found",
  });
});
