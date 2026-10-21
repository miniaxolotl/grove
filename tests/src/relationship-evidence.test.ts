import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groundRelationship,
  relationshipAssessmentSchema,
  type ConnectionSource,
} from "@lib/shared/relationships";

const left: ConnectionSource = {
  id: "00000000-0000-4000-8000-000000000001",
  version: 1,
  projectId: null,
  title: "Launch",
  content: "The launch is on June 10. It is a public release.",
};
const right: ConnectionSource = {
  ...left,
  id: "00000000-0000-4000-8000-000000000002",
  content: "The launch is on June 12. It is a public release.",
};
const assessment = relationshipAssessmentSchema.parse({
  relationship: "conflicting",
  reason:
    "The same public launch has two different dates: June 10 and June 12.",
  basis: "incompatible_claims",
  direction: "both",
  evidence: [left, right].map((s) => ({
    id: s.id,
    version: s.version,
    quote: s.content.split(". ")[0],
  })),
});

test("relationship explanations require verbatim current evidence from both endpoints", () => {
  const grounded = groundRelationship(assessment, "note", [left], [right]);
  assert.equal(
    grounded[0].quote,
    left.content.slice(grounded[0].start, grounded[0].end),
  );
  for (const invalid of [
    { ...assessment, evidence: assessment.evidence.slice(0, 1) },
    {
      ...assessment,
      evidence: assessment.evidence.map((e) => ({ ...e, version: 2 })),
    },
    {
      ...assessment,
      evidence: assessment.evidence.map((e) => ({
        ...e,
        quote: "An invented quotation",
      })),
    },
    {
      ...assessment,
      evidence: [...assessment.evidence, assessment.evidence[0]],
    },
    { ...assessment, relationship: "connected" as const },
  ])
    assert.throws(
      () => groundRelationship(invalid, "note", [left], [right]),
      /invalid_evidence/,
    );
  assert.throws(
    () =>
      groundRelationship(
        assessment,
        "note",
        [left],
        [{ ...right, projectId: "00000000-0000-4000-8000-000000000003" }],
      ),
    /invalid_evidence/,
  );
});

test("notebook connections require both groups and directional dependencies must be explicit", () => {
  const connected = {
    ...assessment,
    relationship: "connected" as const,
    basis: "shared_goal" as const,
  };
  assert.equal(
    groundRelationship(connected, "notebook", [left], [right]).length,
    2,
  );
  assert.throws(
    () =>
      groundRelationship(
        { ...connected, direction: "left_to_right" },
        "notebook",
        [left],
        [right],
      ),
    /invalid_evidence/,
  );
  assert.equal(
    groundRelationship(
      { ...connected, basis: "dependency", direction: "left_to_right" },
      "notebook",
      [left],
      [right],
    ).length,
    2,
  );
  assert.deepEqual(
    groundRelationship(
      {
        ...connected,
        relationship: "unrelated",
        basis: "none",
        reason: "",
        evidence: [],
      },
      "notebook",
      [left],
      [right],
    ),
    [],
  );
});
