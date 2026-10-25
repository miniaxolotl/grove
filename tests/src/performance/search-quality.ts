import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createDatabase, tenant, MemoryModel } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { listSchema } from "@lib/shared/contracts";
import { lexicalQuery } from "../../../lib/memory/src/lexical.ts";

const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
const apiUrl = process.env.TEST_DATABASE_URL!;
if (
  ![ownerUrl, apiUrl].every(
    (url) => url && new URL(url).pathname.endsWith("_test"),
  )
)
  throw new Error("Use disposable owner and non-owner _test URLs");
const authority = createDatabase(ownerUrl);
const name = `grove_search_scale_${randomUUID().replaceAll("-", "")}_test`;
const target = (url: string) => {
  const value = new URL(url);
  value.pathname = `/${name}`;
  return value.href;
};
await authority.raw("CREATE DATABASE ??", [name]);
const admin = createDatabase(target(ownerUrl));
const db = createDatabase(target(apiUrl));
const service = new MemoryService(db, "synthetic-search-scale-secret");
try {
  await admin.migrate.latest();
  const subject = `search_scale_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  const foreign = randomUUID();
  await admin("accounts").insert({
    id: foreign,
    clerkSubject: `noise_${foreign}`,
  });
  const output: unknown[] = [];
  for (const count of [1000, 10000]) {
    const current = Number(
      (await admin("memories")
        .where({ accountId: principal.accountId })
        .count("* as n")
        .first())!.n,
    );
    for (const accountId of [principal.accountId, foreign])
      for (let offset = current; offset < count; offset += 100) {
        const records = Array.from(
          { length: Math.min(100, count - offset) },
          (_, i) => ({
            id: randomUUID(),
            accountId,
            kind: "fact",
            version: 1,
            content: `${i === 0 ? "# Garden design" : `# Field record ${offset + i}`}\n${"Record planting schedules, soil conditions and seedling observations. ".repeat(6)}`,
            source: JSON.stringify({ agent: "api" }),
          }),
        );
        await admin("memories").insert(records);
      }
    await admin.raw("ANALYZE memories");
    for (const query of [
      "garden",
      "garden des",
      "gardn design",
      "zzzxylophonequokka",
      '"garden design"',
      "the",
    ]) {
      const times: number[] = [];
      let result;
      for (let i = 0; i < 6; i++) {
        const start = performance.now();
        result = await service.list(
          principal,
          listSchema.parse({ query, searchMode: "lexical", limit: 10 }),
        );
        if (i) times.push(performance.now() - start);
      }
      const baseline: number[] = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await tenant(db, principal.accountId, async (trx) =>
          MemoryModel.query(trx)
            .where({ status: "active" })
            .whereRaw("search @@ websearch_to_tsquery('english',?)", [query])
            .orderBy("id")
            .limit(10),
        );
        baseline.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      output.push({
        count,
        noise: count,
        query,
        results: result?.items.length,
        serviceMedianMs: times[2],
        serviceP95OfFiveMs: times[4],
        baselineSqlMedianMs: baseline.sort((a, b) => a - b)[2],
        note: "Baseline SQL excludes auth/presentation and cannot find typo/prefix-only matches",
      });
    }
    const plan = await tenant(db, principal.accountId, async (trx) => {
      await trx.raw(
        "SELECT set_config('pg_trgm.word_similarity_threshold','0.6',true)",
      );
      const account = await trx("accounts")
        .where({ id: principal.accountId })
        .first();
      return trx.raw("EXPLAIN (ANALYZE,BUFFERS) ?", [
        lexicalQuery(
          trx,
          MemoryModel.query(trx).where({ status: "active" }),
          "gardn design",
          {},
          account,
        )
          .orderBy("search_tier")
          .limit(10),
      ]);
    });
    await writeFile(
      `${process.env.SEARCH_EVIDENCE_DIR ?? "/tmp/opencode"}/grove-search-plan-${count}.txt`,
      plan.rows
        .map((row: Record<string, string>) => row["QUERY PLAN"])
        .join("\n"),
    );
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        profile:
          "Local synthetic non-owner/RLS; five warm samples, no paid inference; not production capacity",
        measurements: output,
      },
      null,
      2,
    ),
  );
} finally {
  await Promise.all([db.destroy(), admin.destroy()]);
  await authority.raw("DROP DATABASE ??", [name]);
  await authority.destroy();
}
