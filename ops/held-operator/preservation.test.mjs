import assert from "node:assert/strict";
import test from "node:test";
import {
  preservationBlueprint,
  validatePreservation,
} from "./window-postgres.mjs";
test("same-cluster preservation does not normalize away changes to existing internal column attributes", () => {
  const column = {
    relname: "memories",
    attname: "content",
    attoptions: ["pg_attver=1"],
  };
  const before = {
    metadata: { history: [] },
    extras: { semanticColumns: [column] },
    rowsets: {},
    mediaHash: "originals",
    tables: [],
  };
  const after = globalThis.structuredClone(before);
  const blueprint = preservationBlueprint("a".repeat(40), [], before, after);
  after.extras.semanticColumns[0].attoptions = ["pg_attver=2"];
  assert.throws(
    () => validatePreservation(before, after, blueprint),
    /PRESERVATION/,
  );
});
