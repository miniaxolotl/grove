import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  notebookWorkflows,
  notebookWorkflowRequestSchema,
  studySetSchema,
  weeklyReviewSchema,
  knowledgeGapsSchema,
  pastProblemsSchema,
  workflowQuery,
} from "../../lib/shared/src/notebook-workflows.ts";

test("the workflow catalog represents all five distinct jobs, not meeting aliases", () => {
  assert.deepEqual(
    Object.values(notebookWorkflows).map((workflow) => workflow.title),
    [
      "Weekly review",
      "Meeting preparation",
      "Study mode",
      "Knowledge gaps",
      "Similar past problems",
    ],
  );
  assert.equal(
    new Set(
      Object.values(notebookWorkflows).map((workflow) => workflow.preference),
    ).size,
    5,
  );
});

test("generalized requests retain workflow-specific required inputs and forbid meeting fields elsewhere", () => {
  const base = { id: randomUUID(), projectId: randomUUID() };
  const requests = [
    {
      ...base,
      kind: "weekly_review",
      weekStart: "2026-10-19",
      timeZone: "America/Toronto",
    },
    { ...base, kind: "meeting", title: "Launch", agenda: "Review rollback" },
    { ...base, kind: "study", format: "flashcards", topic: "Migrations" },
    { ...base, kind: "knowledge_gaps", topic: "Rollback evidence" },
    {
      ...base,
      kind: "similar_problems",
      problem: "The migration times out on large tenants",
    },
  ];
  for (const input of requests) {
    assert(notebookWorkflowRequestSchema.safeParse(input).success, input.kind);
    if (input.kind !== "meeting")
      assert(
        !notebookWorkflowRequestSchema.safeParse({
          ...input,
          meetingDate: "2026-10-30",
        }).success,
      );
  }
  assert(
    !notebookWorkflowRequestSchema.safeParse({ ...base, kind: "meeting" })
      .success,
  );
  assert(
    !notebookWorkflowRequestSchema.safeParse({
      ...base,
      kind: "similar_problems",
      problem: " ",
    }).success,
  );
});

test("selected sources are explicit version pins without silent notebook or descendant scope", () => {
  const base = {
    id: randomUUID(),
    kind: "study",
    format: "quiz",
    projectId: null,
  };
  const source = { id: randomUUID(), version: 2 };
  assert(
    notebookWorkflowRequestSchema.safeParse({ ...base, sources: [source] })
      .success,
  );
  for (const extra of [
    {},
    { sources: [] },
    { sources: [source, source] },
    { sources: [source], projectId: randomUUID() },
    { sources: [source], includeDescendants: true },
    {
      sources: Array.from({ length: 13 }, () => ({
        ...source,
        id: randomUUID(),
      })),
    },
  ])
    assert(
      !notebookWorkflowRequestSchema.safeParse({ ...base, ...extra }).success,
    );
  for (const kind of ["weekly_review", "knowledge_gaps", "similar_problems"])
    assert(
      !notebookWorkflowRequestSchema.safeParse({
        ...base,
        kind,
        sources: [source],
      }).success,
    );
});

test("weekly review binds a Monday calendar week and an actual IANA timezone, not a visit checkpoint", () => {
  const base = {
    id: randomUUID(),
    projectId: randomUUID(),
    kind: "weekly_review",
    weekStart: "2026-10-19",
    timeZone: "Europe/London",
  };
  assert(notebookWorkflowRequestSchema.safeParse(base).success);
  for (const extra of [
    { weekStart: "2026-10-20" },
    { weekStart: "2026-02-31" },
    { timeZone: "Mars/Olympus" },
    { visitId: randomUUID() },
    { recurring: true },
  ])
    assert(
      !notebookWorkflowRequestSchema.safeParse({ ...base, ...extra }).success,
    );
});

test("study formats have source-linked prompts, supported answers and explanations", () => {
  const source = {
    id: randomUUID(),
    version: 1,
    quote: "The rehearsal runs before launch.",
  };
  const item = {
    prompt: "When does the rehearsal run?",
    answer: "Before launch.",
    explanation: "The note explicitly places it before launch.",
    sources: [source],
  };
  assert(studySetSchema.safeParse({ items: [item] }).success);
  for (const extra of [{ sources: [] }, { answer: "" }, { explanation: "" }])
    assert(
      !studySetSchema.safeParse({ items: [{ ...item, ...extra }] }).success,
    );
});

test("weekly changed decisions require both before and after evidence", () => {
  const source = {
    id: randomUUID(),
    version: 1,
    quote: "Use a staged launch.",
  };
  const change = {
    text: "The rollout changed from a full to a staged launch.",
    before: [{ ...source, quote: "Use a full launch." }],
    after: [{ ...source, version: 2 }],
  };
  assert(
    weeklyReviewSchema.safeParse({
      ideas: [],
      decisions: [change],
      openActions: [],
    }).success,
  );
  for (const extra of [{ before: [] }, { after: [] }])
    assert(
      !weeklyReviewSchema.safeParse({
        ideas: [],
        decisions: [{ ...change, ...extra }],
        openActions: [],
      }).success,
    );
});

test("each workflow supplies its own retrieval intent without requiring an agenda", () => {
  const base = { id: randomUUID(), projectId: randomUUID() };
  assert.equal(
    workflowQuery(
      notebookWorkflowRequestSchema.parse({
        ...base,
        kind: "meeting",
        title: "Launch",
        agenda: "Rollback",
      }),
    ),
    "Launch Rollback",
  );
  assert.equal(
    workflowQuery(
      notebookWorkflowRequestSchema.parse({
        ...base,
        kind: "study",
        format: "quiz",
        topic: "Migrations",
      }),
    ),
    "Migrations",
  );
  assert.equal(
    workflowQuery(
      notebookWorkflowRequestSchema.parse({
        ...base,
        kind: "knowledge_gaps",
        topic: "Rollback",
      }),
    ),
    "Rollback",
  );
  assert.equal(
    workflowQuery(
      notebookWorkflowRequestSchema.parse({
        ...base,
        kind: "similar_problems",
        problem: "Migration timeout",
      }),
    ),
    "Migration timeout",
  );
  assert.equal(
    workflowQuery(
      notebookWorkflowRequestSchema.parse({
        ...base,
        kind: "weekly_review",
        weekStart: "2026-10-19",
        timeZone: "UTC",
      }),
    ),
    "",
  );
});

test("gap findings qualify missing evidence and require a source for the recorded question or claim", () => {
  const sources = [
    { id: randomUUID(), version: 1, quote: "Who reviews rollback?" },
  ];
  const finding = {
    kind: "unanswered_question",
    text: "Who reviews rollback?",
    scope: "not_found_in_reviewed_evidence",
    sources,
  };
  assert(knowledgeGapsSchema.safeParse({ findings: [finding] }).success);
  for (const extra of [
    { sources: [] },
    { scope: "no_answer_exists" },
    { kind: "unknown_fact" },
  ])
    assert(
      !knowledgeGapsSchema.safeParse({ findings: [{ ...finding, ...extra }] })
        .success,
    );
});

test("past problems distinguish recorded solutions and outcomes from superficial matches", () => {
  const cited = {
    text: "The rehearsal timed out.",
    sources: [
      { id: randomUUID(), version: 1, quote: "The rehearsal timed out." },
    ],
  };
  const match = {
    problem: cited,
    solution: { ...cited, text: "Split the migration into batches." },
    outcome: { status: "unknown", evidence: [] },
    similarities: [cited],
    differences: [],
  };
  assert(pastProblemsSchema.safeParse({ matches: [match] }).success);
  assert(
    !pastProblemsSchema.safeParse({
      matches: [{ ...match, outcome: { status: "tested", evidence: [] } }],
    }).success,
  );
  assert(
    !pastProblemsSchema.safeParse({ matches: [{ ...match, similarities: [] }] })
      .success,
  );
});
