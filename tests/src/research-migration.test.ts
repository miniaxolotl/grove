import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, migrationSource, tenant } from "@lib/database";

test("Ask tools upgrade retains old conversation content and isolates settings and spending", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(url && new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url),
    name = `grove_research_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  await authority.raw("CREATE DATABASE ??", [name]);
  const connect = (uri: string) => {
    const target = new URL(uri);
    target.pathname = `/${name}`;
    return createDatabase(target.href);
  };
  const owner = connect(url),
    runtime = connect(process.env.TEST_DATABASE_URL!);
  try {
    const all = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () => all.filter((m) => m.name < "20261023_020"),
      },
    });
    const accountId = randomUUID(),
      id = randomUUID(),
      turn = randomUUID();
    await owner("accounts").insert({
      id: accountId,
      clerkSubject: `research_${accountId}`,
      askEnabled: false,
    });
    await owner("conversations").insert({ id, accountId, scope: "{}" });
    const result = {
      message: "A retained answer",
      statements: [],
      sources: [],
      proposal: null,
    };
    await owner("conversation_turns").insert({
      id: turn,
      accountId,
      conversationId: id,
      position: 1,
      question: "Hello",
      fingerprint: "legacy",
      status: "ready",
      result: JSON.stringify(result),
    });
    const [, applied] = await owner.migrate.latest();
    assert.deepEqual(applied, ["20261023_020_ask_tools"]);
    assert.deepEqual(
      (await owner("conversation_turns").first()).result,
      result,
    );
    assert.deepEqual((await owner("conversation_turns").first()).toolRuns, []);
    assert.equal((await owner("accounts").first()).askEnabled, false);
    assert.deepEqual((await owner("conversations").first()).tools, {
      exa: true,
      tavily: false,
      organize: true,
    });
    assert.deepEqual(
      await tenant(runtime, randomUUID(), (trx) => trx("conversations")),
      [],
    );
    assert.deepEqual(
      await tenant(runtime, randomUUID(), (trx) =>
        trx("research_account_usage"),
      ),
      [],
    );
    const denied = await tenant(runtime, accountId, (trx) =>
      trx.raw(
        "SELECT grove_research_reserve('exa','search',20,1000000) AS admitted",
      ),
    );
    assert.equal(
      denied.rows[0].admitted,
      false,
      "master Ask preference still blocks paid calls",
    );
    await assert.rejects(
      runtime("research_global_usage").select("*"),
      /permission denied/,
    );
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy()]);
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
