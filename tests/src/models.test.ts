import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Knex } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { InferenceError, type Providers } from "@lib/ai";
import {
  answerSchema,
  askSchema,
  briefContentSchema,
  organizationSchema,
  type Annotation,
  type BriefContent,
} from "@lib/shared/models";
import {
  rememberSchema,
  recallSchema,
  listSchema,
  type Principal,
} from "@lib/shared/contracts";
import { readServerEnvironment } from "@lib/environment";
import {
  ModelRegistry,
  environmentModels,
} from "../../packages/api/src/models.ts";
import { resetModelData } from "../../scripts/database/models.ts";
import { formatContext } from "@lib/integration-core";
import { noteAssessmentSchema } from "@lib/shared/relationships";
import { preferencesFor } from "@lib/shared/preferences";
import { Authentication } from "../../packages/api/src/auth.ts";
import { createApp } from "../../packages/api/src/app.ts";

const authorityUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!authorityUrl || !new URL(authorityUrl).pathname.endsWith("_test"))
  throw new Error("Use a disposable test database");
const authority = createDatabase(authorityUrl);
const name = `grove_models_${randomUUID().replaceAll("-", "")}_test`;
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
const input = (content: string, rest = {}) =>
  rememberSchema.parse({ operationId: randomUUID(), content, ...rest });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(
  options: { generationOnly?: boolean; limit?: number } = {},
) {
  const subject = `model_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  const suffix = randomUUID();
  const providers: Providers = {
    embedding: {
      profile: `embedding-${suffix}`,
      model: "test-4096",
      dimensions: 4096,
      embed: async (_text, _purpose, opts) => {
        opts?.onUsage?.({ inputTokens: 7, outputTokens: 0 });
        return [1, ...Array(4095).fill(0)];
      },
    },
    decision: {
      profile: `decision-${suffix}`,
      classify: async (_source, candidates): Promise<Annotation> => ({
        kind: "preference",
        topics: ["testing"],
        salience: 1,
        relationships: candidates.map((s) => ({
          id: s.id,
          relationship: "duplicate",
        })),
      }),
    },
    generation: {
      profile: `generation-${suffix}`,
      generate: async (schema, _instructions, sources, opts) => {
        opts?.onUsage?.({ inputTokens: 10, outputTokens: 20 });
        if (Object.is(schema, answerSchema))
          return schema.parse({
            insufficient: false,
            statements: sources.slice(0, 1).map((s) => ({
              text: s.content,
              sources: [{ id: s.id, version: s.version }],
            })),
          });
        if (Object.is(schema, noteAssessmentSchema))
          return schema.parse({
            relationship: "duplicate",
            reason: "Both request short examples.",
            basis: "same_information",
            direction: "both",
            evidence: sources.map((s) => ({
              id: s.id,
              version: s.version,
              quote: s.content,
            })),
          });
        return schema.parse(
          Object.is(schema, organizationSchema)
            ? { title: "Organized memory", tags: ["testing"] }
            : {
                title: "Current context",
                sections: [
                  {
                    heading: "Recorded facts",
                    statements: sources.map((s) => ({
                      text: s.content,
                      sources: [{ id: s.id, version: s.version }],
                    })),
                  },
                ],
              },
        );
      },
    },
  };
  if (options.generationOnly) {
    delete providers.embedding;
    delete providers.decision;
  }
  const service = new MemoryService(
    db,
    "model-test-secret-32-characters-long",
    providers.embedding,
    providers,
    options.limit ?? 2000,
  );
  const worker = new MemoryService(
    workerDb,
    service.cursorSecret,
    providers.embedding,
    providers,
    options.limit ?? 2000,
  );
  const drain = async () => {
    for (let i = 0; i < 80; i++) {
      await admin("jobs")
        .where({ accountId: principal.accountId })
        .whereNull("failedAt")
        .update({ dueAt: admin.fn.now() });
      if (!(await worker.runJob())) return;
    }
    assert.fail("Background processing did not converge");
  };
  return { principal, providers, service, worker, drain };
}

test("settings HTTP updates are partial, legacy-compatible and restricted to the owning session", async () => {
  const f = await fixture();
  const other = await fixture();
  const auth = new Authentication(db, {
    verify: async () => ({
      subject: f.principal.subject,
      type: "session",
      sessionId: `settings_${randomUUID()}`,
    }),
  });
  const app = createApp({
    memories: f.service,
    auth,
    origin: "http://localhost",
    siteUrl: "http://localhost",
    issuer: "https://clerk.example.test",
    webhookSecret: "whsec_dGVzdA==",
    ready: async () => {},
  });
  const update = (body: unknown, token = "owner") =>
    app.request("/v1/account/settings", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  for (const body of [
    {},
    { askEnabled: "no" },
    { accountId: other.principal.accountId, askEnabled: false },
  ])
    assert.equal((await update(body)).status, 400);
  const legacy = await update({
    captureEnabled: false,
    recallEnabled: true,
    organizeEnabled: false,
    summariesEnabled: false,
  });
  assert.equal(legacy.status, 200);
  const partial = await update({
    organizeEnabled: false,
    summariesEnabled: false,
    askEnabled: true,
    noteConnectionsEnabled: true,
  });
  assert.equal(partial.status, 200);
  const result = (await partial.json()).data;
  assert.equal(result.askEnabled, true);
  assert.equal(result.noteConnectionsEnabled, true);
  assert.equal(result.classificationEnabled, false);
  assert.equal(result.notebookConnectionsEnabled, false);
  assert.equal(result.notebookSummariesEnabled, false);
  assert.equal(result.captureEnabled, false);
  assert.deepEqual(
    preferencesFor(await other.service.me(other.principal)),
    preferencesFor({}),
  );
  const key = await f.service.grant(
    f.principal,
    {
      name: "Connected agent",
      personal: true,
      allProjects: true,
      projectIds: [],
      capabilities: ["memory:read", "memory:write"],
    },
    { key: true },
  );
  assert.equal((await update({ askEnabled: false }, key.secret)).status, 403);
  assert.equal((await f.service.me(f.principal)).askEnabled, true);
  assert.deepEqual((await f.service.me(f.principal)).aiAvailability, {
    classification: true,
    generation: true,
  });
  delete f.service.providers.decision;
  assert.deepEqual((await f.service.me(f.principal)).aiAvailability, {
    classification: false,
    generation: true,
  });
});

test("turning Ask Grove off and back on fences a direct in-flight answer", async () => {
  const f = await fixture({ generationOnly: true });
  await f.service.remember(f.principal, input("Garden plans."));
  const original = f.providers.generation!.generate;
  const entered = deferred(),
    release = deferred();
  f.providers.generation!.generate = async (...args) => {
    entered.resolve();
    await release.promise;
    return original(...args);
  };
  const running = f.service.ask(
    f.principal,
    askSchema.parse({ query: "garden" }),
  );
  const rejected = assert.rejects(running, /changed/);
  await entered.promise;
  await f.service.settings(f.principal, { askEnabled: false });
  await f.service.settings(f.principal, { askEnabled: true });
  release.resolve();
  await rejected;
});

test("titles, classification and briefs can be switched independently without resetting other work", async () => {
  const f = await fixture();
  await f.service.settings(f.principal, { notebookConnectionsEnabled: false });
  const note = await f.service.remember(
    f.principal,
    input("Use concise examples.", { autoKind: true }),
  );
  await f.drain();
  const embeddings = await admin("memory_embeddings").where({
    memoryId: note.id,
  });
  const decisions = await admin("memory_enrichments").where({
    memoryId: note.id,
    kind: "decision",
  });
  const briefs = await admin("memory_briefs").where({
    accountId: f.principal.accountId,
  });
  await f.service.settings(f.principal, { titlesTagsEnabled: false });
  const withoutTitle = await f.service.get(f.principal, note.id);
  assert.equal(withoutTitle.enrichment?.title, undefined);
  assert.deepEqual(withoutTitle.enrichment?.tags, []);
  assert.equal(withoutTitle.enrichment?.suggestedKind, "preference");
  assert.deepEqual(
    await admin("memory_briefs").where({ accountId: f.principal.accountId }),
    briefs,
  );
  assert.deepEqual(
    (await f.service.list(f.principal, listSchema.parse({ tag: "testing" })))
      .items,
    [],
  );
  await f.service.settings(f.principal, { titlesTagsEnabled: true });
  assert.deepEqual(
    await admin("memory_embeddings").where({ memoryId: note.id }),
    embeddings,
  );
  assert.deepEqual(
    await admin("memory_enrichments").where({
      memoryId: note.id,
      kind: "decision",
    }),
    decisions,
  );
  assert.deepEqual(
    await admin("memory_briefs").where({ accountId: f.principal.accountId }),
    briefs,
  );
  await f.drain();
  await f.service.settings(f.principal, { classificationEnabled: false });
  const organized = await f.service.get(f.principal, note.id);
  assert.equal(organized.enrichment?.title, "Organized memory");
  assert.equal(organized.enrichment?.suggestedKind, undefined);
  assert.equal(organized.kind, "preference");
  const next = await f.service.remember(
    f.principal,
    input("Use separate examples.", { autoKind: true }),
  );
  await f.drain();
  assert.equal((await f.service.get(f.principal, next.id)).kind, "fact");
  await f.service.settings(f.principal, { classificationEnabled: true });
  await f.drain();
  assert.equal((await f.service.get(f.principal, next.id)).kind, "preference");
});

test("each summary scope and Ask Grove are independent across save, refresh and reindex", async () => {
  const f = await fixture();
  await f.service.settings(f.principal, { notebookConnectionsEnabled: false });
  const project = await f.service.project(f.principal, {
    name: "Garden",
    identity: randomUUID(),
  });
  await f.service.remember(f.principal, input("Personal garden preferences."));
  await f.service.remember(
    f.principal,
    input("Garden layout.", { projectId: project.id }),
  );
  await f.service.remember(
    f.principal,
    input("Garden work is ready.", {
      projectId: project.id,
      kind: "handoff",
      taskId: "garden",
    }),
  );
  const scopes = [
    { projectId: null },
    { projectId: project.id },
    { projectId: project.id, taskId: "garden" },
  ];
  await f.service.settings(f.principal, {
    notebookSummariesEnabled: false,
    classificationEnabled: false,
  });
  await f.drain();
  assert.equal((await f.service.brief(f.principal, scopes[0])).status, "ready");
  assert.equal(
    (await f.service.brief(f.principal, scopes[1], true)).status,
    "disabled",
  );
  assert.equal((await f.service.brief(f.principal, scopes[2])).status, "ready");
  await f.service.settings(f.principal, {
    personalSummaryEnabled: false,
    progressSummariesEnabled: false,
  });
  assert.equal(
    (await f.service.ask(f.principal, askSchema.parse({ query: "garden" })))
      .status,
    "ready",
  );
  await f.service.settings(f.principal, {
    askEnabled: false,
    notebookSummariesEnabled: true,
  });
  await f.drain();
  assert.equal((await f.service.brief(f.principal, scopes[1])).status, "ready");
  assert.equal(
    (await f.service.ask(f.principal, askSchema.parse({ query: "garden" })))
      .status,
    "generation_disabled",
  );
  await admin.raw("SELECT grove_reprocess(?, ?, ?)", [
    f.providers.embedding!.profile,
    f.providers.decision!.profile,
    f.providers.generation!.profile,
  ]);
  const jobs = await admin("jobs").where({ accountId: f.principal.accountId });
  assert(!jobs.some((j) => j.kind === "decision"));
  assert.deepEqual(
    jobs.filter((j) => j.kind === "brief").map((j) => j.scope),
    [scopes[1]],
  );
  await f.drain();
  await f.worker.scheduleOrganization(60);
  const repaired = await admin("jobs").where({
    accountId: f.principal.accountId,
  });
  assert(
    !repaired.some((j) => j.kind === "brief" && j.scope.projectId === null),
  );
  assert(
    !repaired.some((j) =>
      ["decision", "notebook_profile", "notebook_relationship"].includes(
        j.kind,
      ),
    ),
  );
});

test("disabling then re-enabling a feature fences its old leased output and preserves other queues", async () => {
  for (const [key, schema] of [
    ["titlesTagsEnabled", organizationSchema],
    ["personalSummaryEnabled", briefContentSchema],
  ] as const) {
    const f = await fixture({ generationOnly: true });
    await f.service.settings(f.principal, {
      notebookConnectionsEnabled: false,
      noteConnectionsEnabled: false,
    });
    const note = await f.service.remember(
      f.principal,
      input("Keep the garden notes concise."),
    );
    if (key === "personalSummaryEnabled") {
      const organization = await admin("jobs")
        .where({ memoryId: note.id, kind: "organization" })
        .first();
      await f.worker.runJob(organization.id);
    }
    const original = f.providers.generation!.generate;
    const entered = deferred(),
      release = deferred();
    f.providers.generation!.generate = async (
      s,
      instructions,
      sources,
      options,
    ) => {
      if (Object.is(s, schema)) {
        entered.resolve();
        await release.promise;
      }
      return original(s, instructions, sources, options);
    };
    const kind = key === "titlesTagsEnabled" ? "organization" : "brief";
    const job = await admin("jobs")
      .where({ accountId: f.principal.accountId, kind })
      .first();
    await admin("jobs").where({ id: job.id }).update({ dueAt: admin.fn.now() });
    const running = f.worker.runJob(job.id);
    await entered.promise;
    const otherJobs = await admin("jobs")
      .where({ accountId: f.principal.accountId })
      .whereNot("kind", kind);
    await f.service.settings(f.principal, { [key]: false });
    await f.service.settings(f.principal, { [key]: true });
    assert.deepEqual(
      await admin("jobs")
        .where({ accountId: f.principal.accountId })
        .whereNot("kind", kind),
      otherJobs,
    );
    const replacement = await admin("jobs")
      .where({ accountId: f.principal.accountId, kind })
      .first();
    assert.notEqual(replacement.id, job.id);
    release.resolve();
    await running;
    assert(await admin("jobs").where({ id: replacement.id }).first());
    assert.equal(
      (
        await admin(
          key === "titlesTagsEnabled" ? "memory_enrichments" : "memory_briefs",
        ).where({ accountId: f.principal.accountId })
      ).length,
      0,
    );
    f.providers.generation!.generate = original;
    await f.drain();
    assert.equal(
      key === "titlesTagsEnabled"
        ? (await f.service.get(f.principal, note.id)).enrichment?.status
        : (await f.service.brief(f.principal, { projectId: null })).status,
      "ready",
    );
  }
});

test("4096-dimensional exact search, auto-kind, enrichment, cited briefs and grant isolation work together", async () => {
  const { principal, providers, service, drain } = await fixture();
  const project = await service.project(principal, {
    name: "Scope A",
    identity: randomUUID(),
  });
  const first = await service.remember(
    principal,
    input("Use concise examples.", { projectId: project.id, autoKind: true }),
  );
  await drain();
  const second = await service.remember(
    principal,
    input("Favor short examples.", { projectId: project.id, kind: "decision" }),
  );
  const personal = await service.remember(
    principal,
    input("Personal private preferences."),
  );
  await drain();
  const row = await service.get(principal, first.id);
  assert.equal(row.kind, "preference");
  assert.equal(row.enrichment?.title, "Organized memory");
  assert.equal((await service.get(principal, second.id)).kind, "decision");
  assert.equal(
    (await service.get(principal, second.id)).enrichment?.relationships[0].id,
    first.id,
  );
  const stored = await admin.raw(
    "SELECT vector_dims(embedding) AS dimensions FROM memory_embeddings WHERE memory_id = ?",
    [first.id],
  );
  assert.equal(stored.rows[0].dimensions, 4096);
  // A legacy vector in the same table must never be compared with a 4096 query.
  await admin("embedding_profiles").insert({
    id: "legacy-fixture",
    model: "legacy",
    dimensions: 384,
  });
  await admin("memory_embeddings").insert({
    accountId: principal.accountId,
    memoryId: first.id,
    version: 1,
    profile: "legacy-fixture",
    dimensions: 384,
    embedding: JSON.stringify([1, ...Array(383).fill(0)]),
  });
  const recall = await service.recall(
    principal,
    recallSchema.parse({
      query: "brevity",
      projectId: project.id,
      includePersonal: false,
    }),
  );
  assert.equal(recall.mode, "hybrid");
  assert.deepEqual(
    new Set(recall.items.map((m) => m.id)),
    new Set([first.id, second.id]),
  );
  const library = await service.list(
    principal,
    listSchema.parse({
      query: "brevity",
      projectId: project.id,
      tag: "testing",
    }),
  );
  assert.equal(library.searchMode, "hybrid");
  assert.equal(library.items.length, 2);
  const brief = await service.brief(principal, { projectId: project.id });
  assert.equal(brief.status, "ready");
  assert.equal(brief.sourceCount, 2);
  const profile = await service.recall(
    principal,
    recallSchema.parse({ projectId: project.id, includePersonal: false }),
  );
  assert(profile.briefs?.length);
  assert.match(formatContext(profile), /"generated":true/);
  const grant = await service.grant(
    principal,
    {
      name: "scoped",
      capabilities: ["memory:read"],
      personal: false,
      allProjects: false,
      projectIds: [project.id],
    },
    { key: true },
  );
  const key: Principal = {
    ...principal,
    type: "key",
    connectionId: grant.connection.id,
    capabilities: ["memory:read"],
  };
  assert.equal(
    (await service.brief(key, { projectId: project.id })).status,
    "ready",
  );
  await assert.rejects(service.brief(key, { projectId: null }), {
    code: "forbidden",
  });
  assert(
    !(
      await service.recall(key, recallSchema.parse({ projectId: project.id }))
    ).items.some((m) => m.id === personal.id),
  );
  assert.equal((await db("memory_briefs")).length, 0);
  const another = await fixture();
  await assert.rejects(another.service.get(another.principal, first.id), {
    code: "not_found",
  });
  providers.embedding!.embed = async () => {
    throw new InferenceError("provider_unavailable");
  };
  assert.equal(
    (
      await service.recall(
        principal,
        recallSchema.parse({ query: "examples", projectId: project.id }),
      )
    ).mode,
    "lexical",
  );
});

test("corrections, scope moves, archive, deletion and expiry immediately hide dependent output", async () => {
  const { principal, service, drain } = await fixture();
  const first = await service.remember(principal, input("Old source fact."));
  await drain();
  const second = await service.remember(
    principal,
    input("Related source fact."),
  );
  await drain();
  assert.equal(
    (await service.brief(principal, { projectId: null })).status,
    "ready",
  );
  const corrected = await service.remember(
    principal,
    input("Corrected source fact.", { id: first.id, expectedVersion: 1 }),
  );
  assert.equal(
    (await service.brief(principal, { projectId: null })).content,
    null,
  );
  assert.equal(
    (await service.get(principal, second.id)).enrichment?.relationships.length,
    0,
  );
  await drain();
  const archived = await service.lifecycle(principal, first.id, "archive", {
    operationId: randomUUID(),
    expectedVersion: corrected.version,
  });
  assert.equal(
    (await service.brief(principal, { projectId: null })).content,
    null,
  );
  assert.equal(
    (await service.get(principal, archived.id)).enrichment?.status,
    "disabled",
  );
  await drain();
  const project = await service.project(principal, {
    name: "Moved",
    identity: randomUUID(),
  });
  await service.remember(
    principal,
    input(second.content, {
      id: second.id,
      expectedVersion: second.version,
      projectId: project.id,
    }),
  );
  await drain();
  assert.equal(
    (await service.brief(principal, { projectId: null })).sourceCount,
    0,
  );
  const handoff = await service.remember(
    principal,
    input("Next: verify deployment.", { kind: "handoff", taskId: "deploy" }),
  );
  await drain();
  assert.equal((await service.get(principal, handoff.id)).kind, "handoff");
  assert.equal(
    (await service.brief(principal, { projectId: null, taskId: "deploy" }))
      .status,
    "ready",
  );
  await admin("memories")
    .where({ id: handoff.id })
    .update({ expiresAt: admin.raw("now() - interval '1 second'") });
  assert.equal(
    (await service.brief(principal, { projectId: null, taskId: "deploy" }))
      .content,
    null,
  );
  await drain();
  assert.equal(
    (await service.brief(principal, { projectId: null, taskId: "deploy" }))
      .sourceCount,
    0,
  );
  await service.forget(principal, {
    operationId: randomUUID(),
    items: [{ id: second.id, expectedVersion: 2 }],
  });
  assert.equal(
    (await service.brief(principal, { projectId: project.id })).content,
    null,
  );
});

test(
  "generation outside transactions cannot publish stale revisions or resurrect deleted sources",
  { timeout: 20000 },
  async () => {
    const f = await fixture({ generationOnly: true });
    const started = deferred(),
      release = deferred();
    const generate = f.providers.generation!.generate;
    f.providers.generation!.generate = async (...args) => {
      started.resolve();
      await release.promise;
      return generate(...args);
    };
    const saved = await f.service.remember(
      f.principal,
      input("Before concurrent correction."),
    );
    const running = f.worker.runJob();
    await started.promise;
    await f.service.remember(
      f.principal,
      input("After concurrent correction.", {
        id: saved.id,
        expectedVersion: 1,
      }),
    );
    release.resolve();
    await running;
    assert.equal(
      (
        await admin("memory_enrichments").where({
          memoryId: saved.id,
          version: 1,
        })
      ).length,
      0,
    );
    f.providers.generation!.generate = generate;
    await f.drain();
    const briefStarted = deferred(),
      briefRelease = deferred();
    f.providers.generation!.generate = async (...args) => {
      briefStarted.resolve();
      await briefRelease.promise;
      return generate(...args);
    };
    await f.service.brief(f.principal, { projectId: null }, true);
    const pending = f.worker.runJob();
    await briefStarted.promise;
    await f.service.forget(f.principal, {
      operationId: randomUUID(),
      items: [{ id: saved.id, expectedVersion: 2 }],
    });
    briefRelease.resolve();
    await pending;
    assert.equal(
      (await admin("memory_briefs").where({ accountId: f.principal.accountId }))
        .length,
      0,
    );
  },
);

test("invalid citations fail closed; retries, daily budgets, settings and leased workers remain bounded", async () => {
  const f = await fixture({ generationOnly: true });
  const generate = f.providers.generation!.generate;
  f.providers.generation!.generate = async (schema, ...args) =>
    Object.is(schema, organizationSchema)
      ? generate(schema, ...args)
      : schema.parse({
          title: "Fabricated citation",
          sections: [
            {
              heading: "False source",
              statements: [
                {
                  text: "Not evidence",
                  sources: [{ id: randomUUID(), version: 1 }],
                },
              ],
            },
          ],
        } satisfies BriefContent);
  const saved = await f.service.remember(
    f.principal,
    input("Citation source."),
  );
  await f.drain();
  assert.equal(
    (await f.service.brief(f.principal, { projectId: null })).status,
    "failed",
  );
  const failed = await admin("jobs")
    .where({ accountId: f.principal.accountId, kind: "brief" })
    .first();
  assert.equal(failed.attempts, 5);
  assert.equal(failed.errorCode, "generation_invalid_citation");
  f.providers.generation!.generate = generate;
  await f.service.brief(f.principal, { projectId: null }, true);
  await f.drain();
  assert.equal(
    (await f.service.brief(f.principal, { projectId: null })).status,
    "ready",
  );
  await f.service.settings(f.principal, {
    captureEnabled: true,
    recallEnabled: true,
    organizeEnabled: false,
    summariesEnabled: false,
  });
  assert.equal(
    (await f.service.get(f.principal, saved.id)).enrichment?.status,
    "disabled",
  );
  assert.equal(
    (await f.service.brief(f.principal, { projectId: null })).status,
    "disabled",
  );
  await f.service.settings(f.principal, {
    captureEnabled: true,
    recallEnabled: true,
    organizeEnabled: true,
    summariesEnabled: true,
  });
  await Promise.all([f.worker.runJob(), f.worker.runJob(), f.worker.runJob()]);
  await f.drain();
  assert.equal(
    (await f.service.get(f.principal, saved.id)).enrichment?.status,
    "ready",
  );
  const limited = await fixture({ limit: 1 });
  await limited.service.remember(
    limited.principal,
    input("One request per day."),
  );
  assert(await limited.worker.runJob());
  assert(await limited.worker.runJob());
  const usage = await limited.service.usage(limited.principal);
  assert.equal(
    usage.today.reduce((n, row) => n + row.requests, 0),
    1,
  );
  assert.equal(
    (
      await admin("jobs").where({
        accountId: limited.principal.accountId,
        errorCode: "inference_budget",
      })
    ).length,
    1,
  );
});

test("encrypted installation settings mask keys, enforce administrators, switch profiles across replicas and reset cleanly", async () => {
  const f = await fixture();
  const env = readServerEnvironment({
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    API_ORIGIN: "http://localhost:26080",
    SITE_URL: "http://localhost:3000",
    CLERK_ISSUER: "https://clerk.example.test",
    CLERK_SECRET_KEY: "sk_test",
    CLERK_PUBLISHABLE_KEY: "pk_test",
    CLERK_WEBHOOK_SIGNING_SECRET: "fixture",
    CURSOR_SECRET: f.service.cursorSecret,
    EMBEDDING_MODE: "disabled",
    MODEL_ADMIN_SUBJECTS: f.principal.subject,
    MODEL_SETTINGS_KEY: "ab".repeat(32),
  });
  const registry = new ModelRegistry(db, env, f.service);
  await registry.refresh();
  const staleService = new MemoryService(db, f.service.cursorSecret);
  const staleReplica = new ModelRegistry(db, env, staleService);
  await staleReplica.refresh();
  const configuration = environmentModels(env);
  configuration.embedding = {
    ...configuration.embedding,
    provider: "openai-compatible",
    baseUrl: "https://provider.example/v1",
    model: "Qwen/Qwen3-Embedding-8B",
    dimensions: 4096,
    apiKey: "must-remain-encrypted",
  };
  const other = await fixture();
  await assert.rejects(
    registry.save(other.principal, {
      expectedVersion: 0,
      config: configuration,
      clearKeys: [],
    }),
    { code: "forbidden" },
  );
  await registry.save(f.principal, {
    expectedVersion: 0,
    config: configuration,
    clearKeys: [],
  });
  // This replica refreshed before the cutover and still has embedding disabled.
  // Its next write must nevertheless enqueue the newly committed embedding profile.
  const concurrent = await staleService.remember(
    f.principal,
    input("Saved across a configuration cutover."),
  );
  const replica = new ModelRegistry(workerDb, env, f.worker);
  await replica.refresh();
  await registry.refresh();
  assert.equal(
    (
      await admin("jobs")
        .where({ memoryId: concurrent.id, kind: "embedding" })
        .first()
    ).profile,
    registry.service.embedder!.profile,
  );
  assert.equal(replica.service.embedder!.dimensions, 4096);
  assert.equal(
    replica.service.embedder!.profile,
    registry.service.embedder!.profile,
  );
  assert(
    !JSON.stringify(registry.describe(f.principal)).includes(
      "must-remain-encrypted",
    ),
  );
  assert(
    !JSON.stringify(await admin("model_settings").first()).includes(
      "must-remain-encrypted",
    ),
  );
  const masked = registry.describe(f.principal).config;
  await registry.save(f.principal, {
    expectedVersion: 1,
    config: masked,
    clearKeys: [],
  });
  assert.equal(
    (await registry.load()).config.embedding.apiKey,
    "must-remain-encrypted",
  );
  masked.embedding.baseUrl = "https://different.example/v1";
  await assert.rejects(
    registry.save(f.principal, {
      expectedVersion: 2,
      config: masked,
      clearKeys: [],
    }),
    { code: "credential_required" },
  );
  await assert.rejects(
    registry.save(f.principal, {
      expectedVersion: 0,
      config: configuration,
      clearKeys: [],
    }),
    { code: "version_conflict" },
  );
  const key: Principal = { ...f.principal, type: "key" };
  assert.equal(registry.canEdit(key), false);
  const cloud = environmentModels({
    ...env,
    GROVE_EDITION: "cloud",
    DEEPINFRA_API_KEY: "deep",
    MINIMAX_API_KEY: "mini",
  });
  assert.equal(cloud.embedding.dimensions, 4096);
  assert.equal(cloud.decision.model, "Cloudflare/clef-flash");
  assert.equal(cloud.generation.model, "MiniMax-M3.1-Flash");
  const reset = await resetModelData(admin);
  assert(reset.before.memories > 0);
  assert(Object.values(reset.after).every((count) => count === 0));
  assert((await admin("accounts").count("id as count").first())?.count);
});
