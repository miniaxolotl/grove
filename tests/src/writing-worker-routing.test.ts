import { test } from "node:test";
import assert from "node:assert/strict";

test("enrichment fairly routes both memory jobs and durable writing tasks", async () => {
  const path = new URL(
    "../../packages/api/src/worker-routing.ts",
    import.meta.url,
  ).href;
  const routing = await import(path).catch(() => ({}));
  assert.equal(
    typeof routing.createLaneExecutor,
    "function",
    "writing tasks in enrichment must be dispatched and executed, not stranded behind memory-only routing",
  );
  assert.deepEqual(routing.laneSources("enrichment"), ["memory", "task"]);
  const calls: string[] = [];
  const execute = routing.createLaneExecutor({
    memory: async () => {
      calls.push("memory");
      return true;
    },
    task: async () => {
      calls.push("task");
      return true;
    },
    email: async () => {
      calls.push("email");
      return true;
    },
  });
  await execute("enrichment");
  await execute("enrichment");
  assert.deepEqual(
    calls,
    ["memory", "task"],
    "a continuous memory backlog cannot starve writing work",
  );
  calls.length = 0;
  await execute("enrichment", "opaque-work-id", "task");
  assert.deepEqual(calls, ["task"]);
  assert.equal(
    await execute("indexing", "opaque-work-id", "task"),
    false,
    "an incompatible broker lane must not bypass its capacity gate",
  );
});
