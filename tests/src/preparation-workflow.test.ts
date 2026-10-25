import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant, type Knex } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import type { Providers } from "@lib/ai";
import { rememberSchema } from "@lib/shared/contracts";
import { assistanceRequestSchema } from "@lib/shared/assistance";
import { configureBillingQuotas } from "../../lib/memory/src/billing-quotas.ts";
import { toolWindow } from "../../lib/memory/src/notebook-tools.ts";
import { createApp } from "../../packages/api/src/app.ts";
import { Authentication } from "../../packages/api/src/auth.ts";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(url && new URL(url).pathname.endsWith("_test"));
const authority = createDatabase(url);
const name = `grove_preparation_${randomUUID().replaceAll("-", "")}_test`;
let owner: Knex, db: Knex, workerDb: Knex;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = (input: string) => {
    const parsed = new URL(input);
    parsed.pathname = `/${name}`;
    return parsed.href;
  };
  owner = createDatabase(target(url));
  await owner.migrate.latest();
  db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  workerDb = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
});
after(async () => {
  await Promise.all([owner?.destroy(), db?.destroy(), workerDb?.destroy()]);
  await authority.raw("DROP DATABASE IF EXISTS ?? WITH (FORCE)", [name]);
  await authority.destroy();
});

async function fixture() {
  const subject = `preparation_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  const supplied: string[][] = [];
  const providers: Providers = {
    generation: {
      profile: `prepare-${randomUUID()}`,
      async generate(schema, prompt, sources, options) {
        assert.match(prompt, /evidence/i);
        assert(options?.context?.question.includes("research"));
        supplied.push(sources.map((source) => source.id));
        return schema.parse({
          sections: [
            {
              heading: "Research context",
              items: sources.slice(0, 1).map((source) => ({
                text: "The notes record a migration rehearsal.",
                sources: [
                  {
                    id: source.id,
                    version: source.version,
                    quote: source.content,
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
    "preparation-test-secret-at-least-32-chars",
    undefined,
    providers,
  );
  const worker = new MemoryService(
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
    notebookSummariesEnabled: false,
    personalSummaryEnabled: false,
    progressSummariesEnabled: false,
  });
  const project = await service.project(principal, {
    name: "Research",
    identity: randomUUID(),
  });
  const save = (content: string, projectId: string | null = project.id) =>
    service.remember(
      principal,
      rememberSchema.parse({ operationId: randomUUID(), content, projectId }),
    );
  const input = (scope: unknown = { kind: "notebooks", ids: [project.id] }) =>
    assistanceRequestSchema.parse({
      id: randomUUID(),
      kind: "preparation",
      goal: "Prepare research context for a migration handoff",
      scope,
    });
  const enable = () =>
    service.settings(principal, { preparationEnabled: true });
  const drain = async () => {
    for (let i = 0; i < 25; i++) {
      await owner("jobs")
        .where({ accountId: principal.accountId })
        .whereNull("failedAt")
        .update({ dueAt: owner.fn.now() });
      if (!(await worker.runJob())) return;
    }
    assert.fail("Preparation did not finish");
  };
  return {
    service,
    worker,
    principal,
    providers,
    project,
    save,
    input,
    enable,
    drain,
    supplied,
  };
}

const toolInput = (kind: string, projectId: string, extra = {}) =>
  assistanceRequestSchema.parse({
    id: randomUUID(),
    kind,
    scope: { kind: "notebooks", ids: [projectId] },
    ...extra,
  });

test("preparation accepts a goal without meeting fields and binds one explicit source scope", () => {
  const common = {
    id: randomUUID(),
    kind: "preparation",
    goal: "Understand research findings",
  };
  for (const scope of [
    { kind: "notes", sources: [{ id: randomUUID(), version: 1 }] },
    {
      kind: "notebooks",
      ids: [randomUUID(), randomUUID()],
      includeDescendants: true,
    },
    { kind: "library" },
  ])
    assert(assistanceRequestSchema.safeParse({ ...common, scope }).success);
  for (const extra of [
    {},
    { scope: { kind: "notes", sources: [] } },
    { scope: { kind: "notebooks", ids: [] } },
    { scope: { kind: "library", includeOtherAccounts: true } },
    { scope: { kind: "library" }, projectId: randomUUID() },
    { scope: { kind: "library" }, goal: " " },
  ])
    assert(!assistanceRequestSchema.safeParse({ ...common, ...extra }).success);
});

test("general preparation is independently opted in, uses flexible sections, and Save/Undo preserve source notes", async () => {
  const f = await fixture();
  const source = await f.save("Research: the migration rehearsal is recorded.");
  const input = f.input();
  await assert.rejects(f.service.assistance.request(f.principal, input), {
    code: "feature_disabled",
  });
  await f.enable();
  await f.service.assistance.request(f.principal, input);
  await f.drain();
  const result = await f.service.assistance.get(f.principal, input.id);
  assert.equal(result.status, "ready");
  assert.equal(
    result.result?.preparation?.sections[0].heading,
    "Research context",
  );
  assert.equal(f.supplied.length, 1);
  const saved = await f.service.assistance.apply(f.principal, input.id, {
    expectedVersion: result.version,
    destinationProjectId: null,
  });
  const note = await f.service.get(f.principal, saved.applied[0].id);
  assert.match(note.content, /## Research context/);
  assert.match(note.content, /research context/);
  assert.equal(note.projectId, null);
  await f.service.assistance.apply(
    f.principal,
    input.id,
    { expectedVersion: saved.version },
    true,
  );
  assert.equal(
    (await f.service.get(f.principal, source.id)).version,
    source.version,
  );
});

test("scope can span notebooks or the active library without including another account or implicit descendants", async () => {
  const f = await fixture();
  await f.enable();
  const first = await f.save("Research: migration rehearsal.");
  const other = await f.service.project(f.principal, {
    name: "Planning",
    identity: randomUUID(),
  });
  const second = await f.save("Research: planning handoff.", other.id);
  const unfiled = await f.save("Research: personal context.", null);
  const child = await f.service.project(f.principal, {
    name: "Child",
    identity: randomUUID(),
    parentId: f.project.id,
  });
  const nested = await f.save("Research: child details.", child.id);
  const outsider = await fixture();
  const foreign = await outsider.save("FOREIGN_CANARY research");
  for (const [scope, expected] of [
    [
      { kind: "notebooks", ids: [f.project.id, other.id] },
      [first.id, second.id],
    ],
    [
      { kind: "notebooks", ids: [f.project.id], includeDescendants: true },
      [first.id, nested.id],
    ],
    [{ kind: "library" }, [first.id, second.id, unfiled.id, nested.id]],
  ] as const) {
    const input = f.input(scope);
    await f.service.assistance.request(f.principal, input);
    await f.drain();
    const result = await f.service.assistance.get(f.principal, input.id);
    assert.equal(result.status, "ready");
    assert.deepEqual(new Set(f.supplied.at(-1)), new Set(expected));
    assert(!f.supplied.at(-1)!.includes(foreign.id));
  }
});

test("a large explicit selection reports partial evidence and validates every pin before inference", async () => {
  const f = await fixture();
  await f.enable();
  const notes = [];
  for (let i = 0; i < 16; i++)
    notes.push(await f.save(`Research migration rehearsal ${i}`));
  const pins = notes.map(({ id, version }) => ({ id, version }));
  const invalid = f.input({
    kind: "notes",
    sources: pins.map((ref, index) =>
      index === 15 ? { ...ref, version: 99 } : ref,
    ),
  });
  await assert.rejects(f.service.assistance.request(f.principal, invalid), {
    code: "sources_changed",
  });
  assert.equal(f.supplied.length, 0);
  const input = f.input({ kind: "notes", sources: pins });
  await f.service.assistance.request(f.principal, input);
  await f.drain();
  const result = await f.service.assistance.get(f.principal, input.id);
  assert.equal(result.status, "ready");
  assert.equal(result.result?.coverage.total, 16);
  assert.equal(result.result?.coverage.supplied, 12);
  assert.equal(result.result?.coverage.partial, true);
});

test("study generates a supported answer/explanation set, honors format and saves only after review", async () => {
  const f = await fixture();
  const note = await f.save(
    "Photosynthesis converts light into chemical energy.",
  );
  await f.service.settings(f.principal, { studyModeEnabled: true });
  f.providers.generation!.generate = async (
    schema,
    _prompt,
    sources,
    options,
  ) => {
    assert(options?.context?.question.includes("flashcards"));
    return schema.parse({
      items: [
        {
          prompt: "What does photosynthesis convert?",
          answer: "Light into chemical energy.",
          explanation: "The note explicitly records this conversion.",
          sources: [
            {
              id: note.id,
              version: note.version,
              quote: sources.find((s) => s.id === note.id)!.content,
            },
          ],
        },
      ],
    });
  };
  const input = toolInput("study", f.project.id, {
    format: "flashcards",
    topic: "Photosynthesis",
    size: 6,
  });
  await f.service.assistance.request(f.principal, input);
  await f.drain();
  const result = await f.service.assistance.get(f.principal, input.id);
  assert.equal(result.status, "ready");
  assert.equal(
    result.result?.study?.items[0].answer,
    "Light into chemical energy.",
  );
  assert.equal(
    (
      await f.service.list(f.principal, {
        projectId: f.project.id,
        limit: 20,
      } as never)
    ).items.length,
    1,
  );
  const saved = await f.service.assistance.apply(f.principal, input.id, {
    expectedVersion: result.version,
  });
  assert.match(
    (await f.service.get(f.principal, saved.applied[0].id)).content,
    /What does photosynthesis convert/,
  );
});

test("gap review searches the selected scope for answers before publishing a missing-evidence finding", async () => {
  const f = await fixture();
  const question = await f.save("Open question: Who reviews rollback?");
  const answer = await f.save(
    "Morgan reviews rollback and signs off the rehearsal.",
  );
  await f.service.settings(f.principal, { knowledgeGapsEnabled: true });
  let calls = 0,
    verified = false;
  f.providers.generation!.generate = async (
    schema,
    _prompt,
    sources,
    options,
  ) => {
    calls++;
    if (options?.context?.question.includes("verify_gaps")) {
      verified = sources.some((source) => source.id === answer.id);
      return schema.parse({ findings: [] });
    }
    return schema.parse({
      findings: [
        {
          kind: "unanswered_question",
          text: "Who reviews rollback?",
          scope: "not_found_in_reviewed_evidence",
          sources: [
            {
              id: question.id,
              version: question.version,
              quote: "Who reviews rollback?",
            },
          ],
        },
      ],
    });
  };
  const input = toolInput("knowledge_gaps", f.project.id, {
    topic: "rollback",
  });
  await f.service.assistance.request(f.principal, input);
  await f.drain();
  const result = await f.service.assistance.get(f.principal, input.id);
  assert.equal(result.status, "ready");
  assert.equal(calls, 2);
  assert(verified);
  assert.deepEqual(result.result?.gaps?.findings, []);
});

test("past solutions preserve the distinction between a proposed approach and a recorded successful outcome", async () => {
  const f = await fixture();
  const note = await f.save(
    "The migration timed out. Proposed solution: use batches. Not tested yet.",
  );
  await f.service.settings(f.principal, { similarProblemsEnabled: true });
  const evidence = [
    { id: note.id, version: note.version, quote: note.content },
  ];
  f.providers.generation!.generate = async (
    schema,
    _prompt,
    _sources,
    options,
  ) => {
    assert(options?.context?.question.includes("migration"));
    return schema.parse({
      matches: [
        {
          problem: { text: "The migration timed out.", sources: evidence },
          solution: { text: "Use batches.", sources: evidence },
          outcome: { status: "proposed", evidence },
          similarities: [
            { text: "Both involve a migration timeout.", sources: evidence },
          ],
          differences: [],
        },
      ],
    });
  };
  const input = toolInput("similar_problems", f.project.id, {
    problem: "My migration times out on large tables",
  });
  await f.service.assistance.request(f.principal, input);
  await f.drain();
  const result = await f.service.assistance.get(f.principal, input.id);
  assert.equal(result.status, "ready");
  assert.equal(result.result?.problems?.matches[0].outcome.status, "proposed");
});

test("weekly review uses a fixed timezone window, cites both decision revisions and carries unchanged open actions", async () => {
  const f = await fixture();
  const decision = await f.save("Decision: use a full launch.");
  const revised = await f.service.remember(
    f.principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: decision.id,
      expectedVersion: decision.version,
      projectId: f.project.id,
      content: "Decision: use a staged launch.",
    }),
  );
  const idea = await f.save("New idea: rehearse rollback before the launch.");
  const action = await f.save("- [ ] Review the rollback rehearsal");
  await owner("notebook_changes")
    .where({ accountId: f.principal.accountId })
    .update({ at: new Date("2026-10-01T10:00:00Z") });
  await owner("notebook_changes")
    .where({ memoryId: decision.id, kind: "edited" })
    .update({ at: new Date("2026-10-15T10:00:00Z") });
  await owner("notebook_changes")
    .where({ memoryId: idea.id })
    .update({ at: new Date("2026-10-14T10:00:00Z") });
  await f.service.settings(f.principal, { weeklyReviewEnabled: true });
  f.providers.generation!.generate = async (
    schema,
    _prompt,
    sources,
    options,
  ) => {
    const cite = (id: string, version: number) => {
      const source = sources.find((s) => s.id === id && s.version === version);
      assert(source);
      return [{ id, version, quote: source.content }];
    };
    if (options?.context?.question.includes("verify_actions"))
      return schema.parse({
        items: [
          {
            text: "Review the rollback rehearsal.",
            sources: cite(action.id, action.version),
          },
        ],
      });
    return schema.parse({
      ideas: [
        {
          text: "Rehearse rollback before launch.",
          sources: cite(idea.id, idea.version),
        },
      ],
      decisions: [
        {
          text: "Changed from full to staged launch.",
          before: cite(decision.id, decision.version),
          after: cite(revised.id, revised.version),
        },
      ],
      openActions: [
        {
          text: "Review the rollback rehearsal.",
          sources: cite(action.id, action.version),
        },
      ],
    });
  };
  const input = toolInput("weekly_review", f.project.id, {
    weekStart: "2026-10-12",
    timeZone: "America/Toronto",
  });
  await f.service.assistance.request(f.principal, input);
  await f.drain();
  const result = await f.service.assistance.get(f.principal, input.id);
  assert.equal(result.status, "ready");
  assert.equal(result.result?.weekly?.decisions.length, 1);
  assert.equal(result.result?.weekly?.openActions.length, 1);
  assert.equal(result.result?.window?.start, "2026-10-12T04:00:00.000Z");
  assert.equal(result.result?.window?.end, "2026-10-19T04:00:00.000Z");
});

test("weekly actions are checked against completion evidence elsewhere in the selected scope", async () => {
  const f = await fixture();
  const action = await f.save("- [ ] Review migration rollback");
  const completed = await f.save(
    "Completed: Review migration rollback. The rehearsal passed.",
  );
  await f.service.settings(f.principal, { weeklyReviewEnabled: true });
  let verified = false;
  f.providers.generation!.generate = async (
    schema,
    _prompt,
    sources,
    options,
  ) => {
    if (options?.context?.question.includes("verify_actions")) {
      verified = sources.some((source) => source.id === completed.id);
      return schema.parse({ items: [] });
    }
    return schema.parse({
      ideas: [],
      decisions: [],
      openActions: [
        {
          text: "Review migration rollback",
          sources: [
            { id: action.id, version: action.version, quote: action.content },
          ],
        },
      ],
    });
  };
  const input = toolInput("weekly_review", f.project.id, {
    weekStart: "2026-10-12",
    timeZone: "UTC",
  });
  await f.service.assistance.request(f.principal, input);
  await f.drain();
  const result = await f.service.assistance.get(f.principal, input.id);
  assert.equal(result.status, "ready");
  assert(verified);
  assert.deepEqual(result.result?.weekly?.openActions, []);
});

test("all tool scopes fence uncited changes and continuation reuses the original operation", async () => {
  const f = await fixture();
  await f.enable();
  for (let i = 0; i < 17; i++)
    await f.save(`Research migration rehearsal ${i}`);
  const input = f.input({ kind: "library" });
  await f.service.assistance.request(f.principal, input);
  await f.drain();
  let result = await f.service.assistance.get(f.principal, input.id);
  assert(result.result?.nextCursor);
  const pending = await f.service.assistance.continue(
    f.principal,
    input.id,
    result.version,
  );
  await f.service.assistance.continue(f.principal, input.id, result.version);
  assert.equal(pending.status, "pending");
  await f.drain();
  result = await f.service.assistance.get(f.principal, input.id);
  assert.equal(result.status, "ready");
  assert.equal(result.result?.coverage.examined, 17);
  assert.equal(result.result?.nextCursor, null);
  await f.save("An uncited research answer appeared.");
  assert.equal(
    (await f.service.assistance.get(f.principal, input.id)).status,
    "stale",
  );
});

test("weekly continuation removes prior actions when later scoped lookup finds completion", async () => {
  const f = await fixture();
  let action = await f.save("- [ ] Review migration rollback");
  for (let i = 0; i < 15; i++) {
    const note = await f.save(`Research migration context ${i}`);
    if (note.id < action.id) action = note;
  }
  action = await f.service.remember(
    f.principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: action.id,
      expectedVersion: action.version,
      projectId: f.project.id,
      content: "- [ ] Review migration rollback",
    }),
  );
  const completed = await f.save(
    "Completed: Review migration rollback. Rehearsal passed.",
  );
  await f.service.settings(f.principal, { weeklyReviewEnabled: true });
  let verified = 0;
  f.providers.generation!.generate = async (
    schema,
    _prompt,
    sources,
    options,
  ) => {
    const item = {
      text: "Review migration rollback",
      sources: [
        { id: action.id, version: action.version, quote: action.content },
      ],
    };
    if (options?.context?.question.includes("verify_actions")) {
      assert(sources.some((source) => source.id === completed.id));
      return schema.parse({ items: ++verified === 1 ? [item] : [] });
    }
    return schema.parse({
      ideas: [],
      decisions: [],
      openActions: sources.some((source) => source.id === action.id)
        ? [item]
        : [],
    });
  };
  const input = toolInput("weekly_review", f.project.id, {
    weekStart: "2026-10-12",
    timeZone: "UTC",
  });
  await f.service.assistance.request(f.principal, input);
  await f.drain();
  let result = await f.service.assistance.get(f.principal, input.id);
  // The action may occur in either batch; continue until its candidate is revisited.
  while (result.result?.nextCursor) {
    await f.service.assistance.continue(f.principal, input.id, result.version);
    await f.drain();
    result = await f.service.assistance.get(f.principal, input.id);
  }
  assert.equal(verified, 2);
  assert.deepEqual(result.result?.weekly?.openActions, []);
});

test("tool publication fences uncited changes, preference generations and cancellation during inference", async () => {
  for (const transition of ["source", "preference", "cancel"] as const) {
    const f = await fixture();
    await f.enable();
    await f.save("Research migration rehearsal");
    const input = f.input({ kind: "library" });
    const generate = f.providers.generation!.generate;
    f.providers.generation!.generate = async (...args) => {
      const value = await generate(...args);
      if (transition === "source")
        await f.save("Uncited research answer appeared");
      if (transition === "preference") {
        await f.service.settings(f.principal, { preparationEnabled: false });
        await f.enable();
      }
      if (transition === "cancel") {
        const pending = await f.service.assistance.get(f.principal, input.id);
        await f.service.assistance.cancel(
          f.principal,
          input.id,
          pending.version,
        );
      }
      return value;
    };
    await f.service.assistance.request(f.principal, input);
    await f.drain();
    const result = await f.service.assistance.get(f.principal, input.id);
    assert.equal(
      result.status,
      transition === "cancel" ? "cancelled" : "stale",
    );
    assert.equal(result.result, null);
  }
});

test("foreign and inactive tool scopes fail before inference and forged citations never publish", async () => {
  const f = await fixture(),
    foreign = await fixture();
  await f.enable();
  const note = await f.save("Research migration rehearsal");
  const other = await foreign.save("Private other-account evidence");
  for (const scope of [
    { kind: "notebooks", ids: [foreign.project.id] },
    { kind: "notes", sources: [{ id: other.id, version: other.version }] },
  ])
    await assert.rejects(
      f.service.assistance.request(f.principal, f.input(scope)),
    );
  await owner("projects")
    .where({ id: foreign.project.id })
    .update({ status: "archived" });
  await assert.rejects(
    f.service.assistance.request(
      f.principal,
      f.input({ kind: "notebooks", ids: [foreign.project.id] }),
    ),
  );
  assert.equal(f.supplied.length, 0);
  f.providers.generation!.generate = async (schema) =>
    schema.parse({
      sections: [
        {
          heading: "Forged",
          items: [
            {
              text: "A claim",
              sources: [
                { id: note.id, version: note.version, quote: other.content },
              ],
            },
          ],
        },
      ],
    });
  const input = f.input();
  await f.service.assistance.request(f.principal, input);
  await f.drain();
  const result = await f.service.assistance.get(f.principal, input.id);
  assert.equal(result.status, "failed");
  assert.equal(result.result, null);
});

test("one frozen tool operation settles one action across batches and replay while recording each provider attempt", async () => {
  for (const database of [db, workerDb])
    configureBillingQuotas(database, {
      enabled: async () => true,
      priceIds: ["price_pro"],
    });
  try {
    const f = await fixture();
    await f.enable();
    for (let i = 0; i < 17; i++)
      await f.save(`Research migration rehearsal ${i}`);
    const input = f.input({ kind: "library" });
    await f.service.assistance.request(f.principal, input);
    await f.drain();
    let result = await f.service.assistance.get(f.principal, input.id);
    await f.service.assistance.continue(f.principal, input.id, result.version);
    await f.service.assistance.continue(f.principal, input.id, result.version);
    await f.drain();
    result = await f.service.assistance.get(f.principal, input.id);
    await f.service.assistance.request(f.principal, input);
    await f.drain();
    assert.equal(result.result?.coverage.examined, 17);
    const usage = await tenant(db, f.principal.accountId, (trx) =>
      trx("action_usage").where({ metric: "assistance" }),
    );
    assert.equal(usage.length, 1);
    assert.equal(usage[0].status, "completed");
    const attempts = await owner("inference_usage")
      .where({ accountId: f.principal.accountId, role: "generation" })
      .sum("requests as count")
      .first();
    assert.equal(Number(attempts!.count), 2);
  } finally {
    for (const database of [db, workerDb])
      configureBillingQuotas(database, {
        enabled: async () => false,
        priceIds: [],
      });
  }
});

test("uncited expiry fences the entire selected scope and saved long results undo together", async () => {
  const f = await fixture();
  await f.enable();
  const note = await f.save("Research migration rehearsal");
  const expiring = await f.save("Uncited research context");
  await owner("memories")
    .where({ id: expiring.id })
    .update({
      retentionDays: 1,
      expiresAt: new Date(Date.now() + 60000),
      purgeAt: new Date(Date.now() + 86400000),
    });
  const input = f.input({ kind: "library" });
  await f.service.assistance.request(f.principal, input);
  await f.drain();
  const deadline = await owner("assistance_requests")
    .where({ id: input.id })
    .first();
  assert(new Date(deadline.expiresAt).getTime() <= Date.now() + 61000);
  await owner("assistance_requests")
    .where({ id: input.id })
    .update({ expiresAt: new Date(Date.now() - 1000) });
  assert.equal(
    (await f.service.assistance.get(f.principal, input.id)).status,
    "stale",
  );
  await f.service.settings(f.principal, { studyModeEnabled: true });
  f.providers.generation!.generate = async (schema) =>
    schema.parse({
      items: Array.from({ length: 12 }, (_, index) => ({
        prompt: `Question ${index}`,
        answer: "Supported answer. ".repeat(20),
        explanation: "Supported explanation. ".repeat(20),
        sources: [{ id: note.id, version: note.version, quote: note.content }],
      })),
    });
  const next = toolInput("study", f.project.id, {
    size: 12,
    format: "explanations",
    scope: { kind: "notes", sources: [{ id: note.id, version: note.version }] },
  });
  await f.service.assistance.request(f.principal, next);
  await f.drain();
  const ready = await f.service.assistance.get(f.principal, next.id);
  assert.equal(ready.status, "ready");
  const saved = await f.service.assistance.apply(f.principal, next.id, {
    expectedVersion: ready.version,
  });
  assert(saved.applied.length > 1);
  for (const ref of saved.applied)
    assert((await f.service.get(f.principal, ref.id)).content.length <= 6000);
  await f.service.assistance.apply(
    f.principal,
    next.id,
    { expectedVersion: saved.version },
    true,
  );
  for (const ref of saved.applied)
    assert.equal(
      (await owner("memories").where({ id: ref.id }).first()).status,
      "archived",
    );
  assert.equal(
    (await f.service.get(f.principal, note.id)).content,
    note.content,
  );
});

test("weekly calendar windows honor DST instead of assuming seven times twenty-four hours", async () => {
  const f = await fixture();
  const window = await tenant(db, f.principal.accountId, (trx) =>
    toolWindow(trx, {
      id: randomUUID(),
      kind: "weekly_review",
      scope: { kind: "library" },
      detail: "standard",
      weekStart: "2026-03-02",
      timeZone: "America/Toronto",
    }),
  );
  assert.equal(window.start, "2026-03-02T05:00:00.000Z");
  assert.equal(window.end, "2026-03-09T04:00:00.000Z");
  await assert.rejects(
    tenant(db, f.principal.accountId, (trx) =>
      toolWindow(trx, {
        id: randomUUID(),
        kind: "weekly_review",
        scope: { kind: "library" },
        detail: "standard",
        weekStart: "2099-03-02",
        timeZone: "UTC",
      }),
    ),
  );
});

test("weekly verification bounds accumulated candidates to the weekly output limit", async () => {
  const f = await fixture();
  for (let i = 0; i < 24; i++)
    await f.save(`- [ ] Review migration rehearsal ${i}`);
  await f.service.settings(f.principal, { weeklyReviewEnabled: true });
  f.providers.generation!.generate = async (
    schema,
    _prompt,
    sources,
    options,
  ) => {
    const task = JSON.parse(options!.context!.question);
    if (task.phase === "verify_actions")
      return schema.parse({ items: task.candidates });
    return schema.parse({
      ideas: [],
      decisions: [],
      openActions: sources.slice(0, 4).map((source) => ({
        text: source.content,
        sources: [
          { id: source.id, version: source.version, quote: source.content },
        ],
      })),
    });
  };
  const input = toolInput("weekly_review", f.project.id, {
    weekStart: "2026-10-12",
    timeZone: "UTC",
  });
  await f.service.assistance.request(f.principal, input);
  await f.drain();
  let result = await f.service.assistance.get(f.principal, input.id);
  await f.service.assistance.continue(f.principal, input.id, result.version);
  await f.drain();
  result = await f.service.assistance.get(f.principal, input.id);
  assert.equal(result.status, "ready");
  assert.equal(result.result?.coverage.examined, 24);
  assert.equal(result.result?.weekly?.openActions.length, 4);
});

test("tool HTTP continuation is private, owner-only, strict and replay-safe", async () => {
  const f = await fixture();
  await f.enable();
  for (let i = 0; i < 13; i++) await f.save(`Research migration ${i}`);
  const auth = new Authentication(db, {
    verify: async (token) => ({
      subject:
        token === "owner"
          ? f.principal.subject!
          : `other_${f.principal.subject}`,
      type: "session",
      sessionId: `tool_${token}`,
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
  const input = f.input(),
    headers = {
      authorization: "Bearer owner",
      "content-type": "application/json",
    };
  const created = await app.request("/v1/assistance", {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  assert.equal(created.status, 200);
  await f.drain();
  const ready = await f.service.assistance.get(f.principal, input.id),
    path = `/v1/assistance/${input.id}/continue`;
  const body = JSON.stringify({ expectedVersion: ready.version });
  assert.equal((await app.request(path, { method: "POST", body })).status, 401);
  assert.equal(
    (
      await app.request(path, {
        method: "POST",
        headers: { ...headers, authorization: "Bearer other" },
        body,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await app.request(path, {
        method: "POST",
        headers,
        body: JSON.stringify({
          expectedVersion: ready.version,
          scope: { kind: "library" },
        }),
      })
    ).status,
    400,
  );
  const continued = await app.request(path, { method: "POST", headers, body });
  assert.equal(continued.status, 200);
  assert.match(continued.headers.get("cache-control")!, /no-store/);
  const replay = await app.request(path, { method: "POST", headers, body });
  assert.equal(
    (await replay.json()).data.version,
    (await continued.json()).data.version,
  );
  await f.drain();
  assert.equal(
    (await f.service.assistance.get(f.principal, input.id)).result?.coverage
      .examined,
    13,
  );
});

test("weekly missing historical evidence remains explicitly partial after final coverage aggregation", async () => {
  const f = await fixture();
  const note = await f.save("Decision: use a full launch.");
  await f.service.remember(
    f.principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: note.id,
      expectedVersion: note.version,
      projectId: f.project.id,
      content: "Decision: use a staged launch.",
    }),
  );
  await owner("notebook_changes")
    .where({ memoryId: note.id })
    .update({ at: new Date("2026-10-01T10:00:00Z") });
  await owner("notebook_changes")
    .where({ memoryId: note.id, kind: "edited" })
    .update({ at: new Date("2026-10-15T10:00:00Z") });
  await owner("memory_revisions")
    .where({ memoryId: note.id, version: note.version })
    .delete();
  await f.service.settings(f.principal, { weeklyReviewEnabled: true });
  f.providers.generation!.generate = async (schema) =>
    schema.parse({ ideas: [], decisions: [], openActions: [] });
  const input = toolInput("weekly_review", f.project.id, {
    weekStart: "2026-10-12",
    timeZone: "UTC",
  });
  await f.service.assistance.request(f.principal, input);
  await f.drain();
  const result = await f.service.assistance.get(f.principal, input.id);
  assert.equal(result.status, "ready");
  assert.equal(result.result?.coverage.examined, 1);
  assert.equal(result.result?.coverage.historyOmitted, true);
  assert.equal(result.result?.coverage.partial, true);
  assert.match(result.result?.coverage.reason ?? "", /historical evidence/);
});
