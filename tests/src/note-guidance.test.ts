import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMemoryMcp } from "@lib/integration-core/mcp";
import { memorySkill } from "@lib/integration-core";
import { memoryTools } from "@lib/shared/memory-tools";
import { profileId } from "@lib/ai";
import { relationshipPolicyVersion } from "@lib/shared/relationships";
import { assistanceProfile } from "../../lib/memory/src/assistance-data.ts";

test("MCP discovery teaches readable Markdown and full-body edits without executing tools", async () => {
  let calls = 0;
  const server = createMemoryMcp(async () => {
    calls++;
  });
  const client = new Client({ name: "note-guidance", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  await server.connect(remote);
  try {
    await client.connect(local);
    const instructions = client.getInstructions()!;
    assert.match(instructions, /human-readable/);
    assert.match(instructions, /GitHub-flavored Markdown/);
    assert.match(instructions, /one sentence/);
    assert.match(instructions, /complete.*body/);
    assert.match(instructions, /preserve.*(?:unrequested|unrelated)/i);
    assert.match(instructions, /user direction/);
    const { tools } = await client.listTools();
    for (const name of ["remember", "update_memory"]) {
      const properties = tools.find((tool) => tool.name === name)!.inputSchema
        .properties as Record<string, { description?: string }>;
      assert.match(properties.content.description ?? "", /Markdown/);
      assert.match(properties.content.description ?? "", /complete.*body/);
      assert.match(properties.content.description ?? "", /concise/);
      assert.match(properties.capture.description ?? "", /user-requested/);
      assert.match(properties.operationId.description ?? "", /retry/i);
      assert.match(properties.expectedVersion.description ?? "", /current/i);
      assert.match(properties.projectId.description ?? "", /Personal/);
    }
    const listing = tools.find((tool) => tool.name === "memories")!.inputSchema
      .properties as Record<string, { description?: string }>;
    assert.match(listing.projectId.description ?? "", /[Oo]mit.*all granted/);
    assert.equal(calls, 0);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});

test("packaged skill sources match runtime guidance and retain an automatic-context budget", async () => {
  for (const host of ["claude", "codex"]) {
    const text = await readFile(
      new URL(
        `../../packages/grove-${host}-plugin/skills/memory/SKILL.md`,
        import.meta.url,
      ),
      "utf8",
    );
    const body = text.replace(/^---\n[\s\S]*?\n---\n\n/, "").trim();
    assert.equal(body, memorySkill.trim(), `${host} skill must not drift`);
  }
  assert.match(memorySkill, /human-readable/);
  assert.match(memorySkill, /get_memory/);
  assert.match(memorySkill, /memory_history/);
  assert.doesNotMatch(
    memorySkill,
    /purge after 90|four Grove tools|dashboard for archive/i,
  );
  assert(
    memorySkill.length < 4500,
    "Leave room for references inside the 6000-character hook budget",
  );
});

test("writing guidance does not change accepted content, scope defaults or version guards", () => {
  const input = {
    operationId: randomUUID(),
    content: "  <literal>\n\n```json\n{}\n```  ",
  };
  const saved = memoryTools.remember.schema.parse(input);
  assert.equal(saved.content, input.content.trim());
  assert.equal(saved.capture, "explicit");
  assert.equal(saved.projectId, null);
  assert.equal(saved.kind, "fact");
  assert.equal(memoryTools.memories.schema.parse({}).projectId, undefined);
  assert.equal(memoryTools.recall.schema.parse({}).projectId, null);
  assert.throws(() =>
    memoryTools.remember.schema.parse({ ...input, content: "x".repeat(6001) }),
  );
  assert.throws(() =>
    memoryTools.remember.schema.parse({ ...input, category: "invented" }),
  );
  assert.throws(() =>
    memoryTools.remember.schema.parse({ ...input, id: randomUUID() }),
  );
  const edit = memoryTools.update_memory.schema.parse({
    operationId: randomUUID(),
    id: randomUUID(),
    expectedVersion: 1,
    content: "One sentence.",
  });
  assert.equal(edit.projectId, undefined);
  assert.equal(edit.kind, undefined);
  assert.equal(edit.capture, "explicit");
});

test("cleanup preview cache identity includes the writing policy without changing other assistance", () => {
  assert.equal(
    assistanceProfile("fixture", undefined, "cleanup"),
    profileId("assistance-cleanup-v3", {
      generation: "fixture",
      embedding: null,
      policy: relationshipPolicyVersion,
      writing: "note-writing-v1",
    }),
  );
  assert.equal(
    assistanceProfile("fixture", undefined, "actions"),
    profileId("assistance-v2", {
      generation: "fixture",
      embedding: null,
    }),
  );
});
