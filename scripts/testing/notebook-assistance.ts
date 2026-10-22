import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { createDatabase } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import {
  createGenerationProvider,
  type GenerationProvider,
} from "../../lib/ai/src/index.ts";
import { generationConfigSchema } from "../../lib/shared/src/models.ts";
import { notebookSummarySchema } from "../../lib/shared/src/summaries.ts";
import { rememberSchema, listSchema } from "../../lib/shared/src/contracts.ts";
import { assistanceCases } from "../../tests/fixtures/assistance-quality.ts";

const live = process.argv.includes("--live"),
  benchmark = process.argv.includes("--benchmark");
assert(live !== benchmark, "Choose --live or --benchmark");
assert(
  !live || process.env.GENERATION_API_KEY,
  "Live synthetic evaluation requires GENERATION_API_KEY",
);
const url = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(
  url && new URL(url).pathname.endsWith("_test"),
  "Use an owned disposable _test database",
);
const name = `grove_assistance_eval_${randomUUID().replaceAll("-", "")}_test`;
const authority = createDatabase(url);
const connect = (input: string) => {
  const u = new URL(input);
  u.pathname = `/${name}`;
  return createDatabase(u.href, { max: 2 });
};
const admin = connect(url),
  api = connect(process.env.TEST_DATABASE_URL!),
  jobs = connect(process.env.TEST_WORKER_DATABASE_URL!);
let calls = 0,
  characters = 0,
  maximumInput = 0,
  queries = 0,
  maximumRss = 0;
for (const db of [api, jobs])
  db.on("query", () => {
    queries++;
  });
const actual = live
  ? createGenerationProvider(
      generationConfigSchema.parse({
        provider: "minimax",
        baseUrl: process.env.GENERATION_URL ?? "https://api.minimax.io/v1",
        model: process.env.GENERATION_MODEL ?? "MiniMax-M3.1-Flash",
        apiKey: process.env.GENERATION_API_KEY,
        timeoutMs: 60000,
        maxOutputTokens: 4096,
      }),
    )
  : undefined;
const generation: GenerationProvider = {
  profile: actual?.profile ?? "synthetic-bounded-summary",
  async generate(schema, prompt, sources, options) {
    calls++;
    const size = sources.reduce((n, s) => n + s.content.length, 0);
    characters += size;
    maximumInput = Math.max(maximumInput, size);
    maximumRss = Math.max(maximumRss, process.memoryUsage().rss);
    if (actual) return actual.generate(schema, prompt, sources, options);
    assert.equal(schema, notebookSummarySchema);
    assert(size <= 24000);
    return schema.parse({
      title: "Synthetic research",
      sections: [
        {
          heading: "Findings",
          statements: sources.slice(0, 1).map((s) => ({
            text: s.content.slice(0, 200),
            sources: [
              { id: s.id, version: s.version, quote: s.content.slice(0, 200) },
            ],
          })),
        },
      ],
    });
  },
};
const service = new MemoryService(
  api,
  "synthetic-evaluation-secret",
  undefined,
  { generation },
  benchmark ? 100000 : 100,
);
const worker = new MemoryService(
  jobs,
  service.cursorSecret,
  undefined,
  { generation },
  benchmark ? 100000 : 100,
);
const results: unknown[] = [];
try {
  await authority.raw("CREATE DATABASE ??", [name]);
  await admin.migrate.latest();
  const cases = benchmark
    ? [100, 1000, 10000].map((size) => ({ name: `${size} notes`, size }))
    : assistanceCases.map((fixture) => ({ name: fixture.name, fixture }));
  for (const item of cases) {
    const subject = `eval-${randomUUID()}`,
      { rows } = await api.raw("SELECT * FROM grove_account(?)", [subject]);
    const principal = sessionPrincipal(rows[0].id, subject);
    await service.settings(principal, {
      titlesTagsEnabled: false,
      classificationEnabled: false,
      noteConnectionsEnabled: false,
      notebookConnectionsEnabled: false,
      personalSummaryEnabled: false,
      progressSummariesEnabled: false,
      notebookSummariesEnabled: false,
    });
    const project = await service.project(principal, {
      name: item.name,
      identity: randomUUID(),
    });
    const drain = async () => {
      const deadline = Date.now() + 20 * 60_000;
      for (let i = 0; i < 16000; i++) {
        if (await worker.runJob()) continue;
        const next = await admin("jobs")
          .where({ accountId: principal.accountId })
          .whereNull("failedAt")
          .orderBy("dueAt")
          .first();
        if (!next) return;
        assert(
          live &&
            Date.now() < deadline &&
            new Date(next.dueAt).getTime() < deadline,
          "Evaluation has unprocessed jobs outside its bounded time window",
        );
        await setTimeout(
          Math.max(50, new Date(next.dueAt).getTime() - Date.now()),
        );
      }
      throw new Error("Bounded evaluation exceeded its job limit");
    };
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
    if ("size" in item) {
      const notes = Array.from({ length: item.size }, (_, i) => ({
        id: randomUUID(),
        accountId: principal.accountId,
        projectId: project.id,
        kind: "fact",
        content: `Research finding ${i}: ${"Controlled measurements retain uncertainty and original evidence. ".repeat(8)}`,
        source: "{}",
      }));
      await admin.batchInsert("memories", notes, 100);
      await admin.raw(
        "INSERT INTO memory_revisions(account_id,memory_id,version,content,source) SELECT account_id,id,version,content,source FROM memories WHERE account_id=?",
        [principal.accountId],
      );
      await service.settings(principal, { notebookSummariesEnabled: true });
      const passes = [];
      for (const pass of ["initial", "unchanged", "one-edit"]) {
        if (pass === "one-edit")
          await save(`${notes[0].content} Corrected measurement.`, {
            id: notes[0].id,
            expectedVersion: 1,
          });
        calls = 0;
        characters = 0;
        queries = 0;
        maximumInput = 0;
        maximumRss = process.memoryUsage().rss;
        const start = performance.now();
        await service.brief(principal, { projectId: project.id }, true);
        await drain();
        const result = await service.brief(principal, {
          projectId: project.id,
        });
        assert.equal(result.status, "ready");
        assert.equal(result.coverage?.examined, item.size);
        if (pass === "unchanged") assert.equal(calls, 0);
        passes.push({
          pass,
          ms: Math.round(performance.now() - start),
          queries,
          calls,
          sourceCharacters: characters,
          maximumInput,
          maximumRss,
          coverage: result.coverage,
        });
      }
      const report = { name: item.name, passes };
      results.push(report);
      console.log(JSON.stringify(report));
    } else {
      const fixture = item.fixture,
        notes = [];
      calls = 0;
      characters = 0;
      for (const content of fixture.notes) notes.push(await save(content));
      await service.settings(principal, { notebookSummariesEnabled: true });
      await service.brief(principal, { projectId: project.id }, true);
      await drain();
      const summary = await service.brief(principal, { projectId: project.id });
      const request = async (
        input: Parameters<typeof service.assistance.request>[1],
      ) => {
        await service.assistance.request(principal, input);
        await drain();
        return service.assistance.get(principal, input.id);
      };
      const actions = await request({
        id: randomUUID(),
        kind: "actions",
        sources: notes.map(({ id, version }) => ({ id, version })),
        projectId: project.id,
      });
      const unfiled = await save(fixture.unfiled, { projectId: null });
      const filing = await request({
        id: randomUUID(),
        kind: "filing",
        sources: [{ id: unfiled.id, version: unfiled.version }],
      });
      const cleanup = await request({
        id: randomUUID(),
        kind: "cleanup",
        projectId: project.id,
      });
      const visit = async () => {
        const page = await service.list(
          principal,
          listSchema.parse({ projectId: project.id }),
        );
        return service.visits.acknowledge(principal, {
          id: randomUUID(),
          ...page.visit!,
        });
      };
      await visit();
      await save(fixture.updated, { id: notes[0].id, expectedVersion: 1 });
      const window = await visit();
      const digest = await request({
        id: randomUUID(),
        kind: "digest",
        visitId: window.id,
      });
      const report = {
        name: item.name,
        expected: {
          actions: fixture.actions,
          filing: fixture.filing,
          cleanup: fixture.cleanup,
        },
        summary,
        actions,
        filing,
        cleanup,
        digest,
        calls,
        sourceCharacters: characters,
        usage: await admin("inference_usage")
          .where({ accountId: principal.accountId })
          .select("role", "requests", "inputTokens", "outputTokens"),
      };
      results.push(report);
      console.log(JSON.stringify(report));
      if (
        [summary, actions, filing, cleanup, digest].some(
          (result) => result.status !== "ready",
        )
      )
        process.exitCode = 1;
    }
  }
  console.log(
    JSON.stringify({
      mode: live ? "live-human-review-required" : "synthetic-orchestration",
      profile: generation.profile,
      cases: results.length,
    }),
  );
} finally {
  await Promise.all([admin.destroy(), api.destroy(), jobs.destroy()]);
  await authority.raw("DROP DATABASE IF EXISTS ?? WITH (FORCE)", [name]);
  await authority.destroy();
}
