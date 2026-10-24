import assert from "node:assert/strict";
import { test } from "node:test";
import { words } from "../../lib/memory/src/notebook-relationships.ts";
import {
  relationshipTerms,
  lexicalCandidates,
} from "../../lib/memory/src/relationship-discovery.ts";

test("notebook discovery retains short attributes and samples the end of long notes", () => {
  const content = `${Array.from({ length: 180 }, (_, i) => `header${i}`).join(" ")} Gin Rum 京都`;
  const hints = words(content);
  assert(hints.includes("京都"));
  assert(words("Gin and rum").includes("gin"));
  assert(words("Gin and rum").includes("rum"));
  assert(relationshipTerms(content).length <= 64);
});

test("bounded lexical reranking favors distinguishing overlap over repeated templates", () => {
  const source = "Film review rating Rewatch director Céline Sciamma";
  const pool = [
    ...Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      content: "Film review rating Rewatch",
    })),
    {
      id: "target",
      content: "Director Céline Sciamma: Portrait of a Lady on Fire",
    },
  ];
  assert.equal(lexicalCandidates(source, pool, 1)[0].id, "target");
});
