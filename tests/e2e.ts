/**
 * E2E test for qdrant-memory MCP server.
 * Tests all 10 tools against the live Qdrant instance.
 */
import { memoryRepository } from "../src/repositories/memory.repository.js";
import { entityRepository } from "../src/repositories/entity.repository.js";
import { relationRepository } from "../src/repositories/relation.repository.js";

async function runTests() {
  console.log("=== qdrant-memory E2E Tests ===\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ ${msg}`);
      failed++;
    }
  }

  // ── Memory Tests ─────────────────────────────────────────────────────────────
  console.log("--- Memory ---");

  const mem1 = await memoryRepository.save("The capital of France is Paris.", {
    source: "test",
    tags: ["geography"],
  });
  assert(mem1.id.length > 0, "memory_save returns id");

  const mem2 = await memoryRepository.save(
    "TypeScript is a typed superset of JavaScript.",
    { source: "test", tags: ["programming"] },
  );
  assert(mem2.id.length > 0, "memory_save second call returns id");

  const searchResults = await memoryRepository.search(
    "What is the capital of France?",
    { limit: 5 },
  );
  assert(searchResults.length > 0, "memory_search returns results");
  assert(
    searchResults[0].text.includes("France"),
    "memory_search finds relevant result",
  );

  await memoryRepository.delete([mem1.id]);
  const afterDelete = await memoryRepository.search("France", { limit: 5 });
  assert(
    !afterDelete.find((r) => r.id === mem1.id),
    "memory_delete removes memory by id",
  );

  // ── Entity Tests ────────────────────────────────────────────────────────────
  console.log("\n--- Entities ---");

  const entity1 = await entityRepository.create(
    "TypeScript",
    "programming_language",
    ["Created by Anders Hejlsberg", "Typed superset of JavaScript"],
    { year: 2012 },
  );
  assert(entity1.id.length > 0, "entity_create returns id");
  assert(entity1.name === "TypeScript", "entity_create stores name");

  const entity2 = await entityRepository.create("Anders Hejlsberg", "person", [
    "Created TypeScript",
    "Created C#",
  ]);
  assert(entity2.id.length > 0, "entity_create second entity returns id");

  const found = await entityRepository.search(
    undefined,
    "programming_language",
  );
  assert(
    found.some((e) => e.name === "TypeScript"),
    "entity_search by type works",
  );

  const retrieved = await entityRepository.get("TypeScript");
  assert(retrieved !== null, "entity_get returns entity");
  assert(retrieved!.observations.length === 2, "entity observations preserved");

  const updated = await entityRepository.addObservations("TypeScript", [
    "Open source",
  ]);
  assert(updated!.observations.length === 3, "entity_add_observations appends");

  // ── Relation Tests ──────────────────────────────────────────────────────────
  console.log("\n--- Relations ---");

  const rel1 = await relationRepository.create(
    "TypeScript",
    "created_by",
    "Anders Hejlsberg",
    { year: 2012 },
  );
  assert(rel1.id.length > 0, "relation_create returns id");

  const rel2 = await relationRepository.create(
    "TypeScript",
    "has_syntax",
    "static_typing",
  );
  assert(rel2.id.length > 0, "relation_create second relation returns id");

  const relSearch = await relationRepository.search({ from: "TypeScript" });
  assert(relSearch.length >= 2, "relation_search by from returns relations");

  const relSearchType = await relationRepository.search({
    relationType: "created_by",
  });
  assert(
    relSearchType.some((r) => r.from === "TypeScript"),
    "relation_search by type works",
  );

  await relationRepository.delete({
    from: "TypeScript",
    relationType: "has_syntax",
  });
  const afterRelDelete = await relationRepository.search({
    from: "TypeScript",
  });
  assert(
    afterRelDelete.every((r) => r.relationType !== "has_syntax"),
    "relation_delete removes relation",
  );

  // ── Cleanup ────────────────────────────────────────────────────────────────
  console.log("\n--- Cleanup ---");
  await memoryRepository.deleteByFilter({});
  await entityRepository.delete({});
  await relationRepository.delete({});

  // Re-initialize empty collections
  await memoryRepository.init();
  await entityRepository.init();
  await relationRepository.init();

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
