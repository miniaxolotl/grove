import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { createDatabase, probeDatabase, type Knex } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import type { Providers } from "@lib/ai";
import { organizationSchema } from "@lib/shared/models";
import {
  conversationGenerationSchema,
  conversationPlanSchema,
} from "@lib/shared/conversations";
import { Authentication } from "../../../packages/api/src/auth.ts";
import { createApp } from "../../../packages/api/src/app.ts";

/** Dense, deterministic vectors: zero-filled vectors unrealistically compress. */
export function fixtureVector(seed = 1, dimensions = 4096) {
  let state = seed;
  const vector = Array.from({ length: dimensions }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff - 0.5;
  });
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
}

export async function capacityFixture(
  options: {
    accounts?: number;
    notes?: number;
    pool?: number;
    embeddingDelayMs?: number;
    generationDelayMs?: number;
  } = {},
) {
  const urls = [
    process.env.TEST_MIGRATION_DATABASE_URL,
    process.env.TEST_DATABASE_URL,
    process.env.TEST_WORKER_DATABASE_URL,
  ];
  if (urls.some((url) => !url || !new URL(url).pathname.endsWith("_test")))
    throw new Error(
      "Capacity fixtures require three disposable _test database URLs",
    );
  const parsed = urls.map((url) => new URL(url!));
  if (
    parsed.some(
      (url) =>
        url.host !== parsed[0].host || url.pathname !== parsed[0].pathname,
    )
  )
    throw new Error("Use roles on the same disposable database server");
  const name = `grove_capacity_${randomUUID().replaceAll("-", "")}_test`;
  const authority = createDatabase(urls[0]!);
  let admin: Knex | undefined, db: Knex | undefined, workerDb: Knex | undefined;
  let created = false;
  const close = async () => {
    await Promise.all([admin?.destroy(), db?.destroy(), workerDb?.destroy()]);
    try {
      if (created) await authority.raw("DROP DATABASE ??", [name]);
    } finally {
      await authority.destroy();
    }
  };
  try {
    await authority.raw("CREATE DATABASE ??", [name]);
    created = true;
    const target = (url: URL) => {
      const copy = new URL(url);
      copy.pathname = `/${name}`;
      return copy.href;
    };
    admin = createDatabase(target(parsed[0]));
    await admin.migrate.latest();
    db = createDatabase(target(parsed[1]), { max: options.pool ?? 8 });
    workerDb = createDatabase(target(parsed[2]));
    await probeDatabase(db);
    const vector = fixtureVector();
    const providers: Providers = {
      embedding: {
        profile: "capacity-4096-v1",
        model: "synthetic-dense",
        dimensions: 4096,
        async embed(_text, _purpose, settings) {
          await setTimeout(options.embeddingDelayMs ?? 0, undefined, {
            signal: settings?.signal,
          });
          return vector;
        },
      },
      decision: {
        profile: "capacity-decision-v1",
        async classify() {
          return {
            kind: "fact",
            topics: ["other"],
            salience: 0.5,
            relationships: [],
          };
        },
      },
      generation: {
        profile: "capacity-generation-v1",
        async generate(schema, _instructions, _sources, settings) {
          await setTimeout(options.generationDelayMs ?? 0, undefined, {
            signal: settings?.signal,
          });
          if (Object.is(schema, conversationPlanSchema))
            return schema.parse({
              query: "garden",
              intent: "find",
              references: [],
            });
          if (Object.is(schema, conversationGenerationSchema))
            return schema.parse({
              message: "Synthetic capacity reply.",
              statements: [],
              proposals: [],
            });
          if (Object.is(schema, organizationSchema))
            return schema.parse({ title: "Garden notes", tags: ["garden"] });
          throw new Error("This workload needs an explicit provider fixture");
        },
      },
    };
    const service = new MemoryService(
      db,
      "capacity-fixture-cursor-secret-at-least-32",
      providers.embedding,
      providers,
      1000000,
    );
    const worker = new MemoryService(
      workerDb,
      service.cursorSecret,
      providers.embedding,
      providers,
      1000000,
    );
    const subjects = Array.from(
      { length: options.accounts ?? 2 },
      () => `user_capacity_${randomUUID()}`,
    );
    const principals = [];
    await admin("embedding_profiles").insert({
      id: providers.embedding!.profile,
      model: "synthetic-dense",
      dimensions: 4096,
    });
    const vectors = Array.from({ length: 8 }, (_, index) =>
      JSON.stringify(fixtureVector(index + 1)),
    );
    for (const subject of subjects) {
      const { rows } = await db.raw("SELECT * FROM grove_account(?)", [
        subject,
      ]);
      const principal = sessionPrincipal(rows[0].id, subject);
      principals.push(principal);
      for (let offset = 0; offset < (options.notes ?? 100); offset += 100) {
        const memories = Array.from(
          { length: Math.min(100, (options.notes ?? 100) - offset) },
          (_, index) => ({
            id: randomUUID(),
            accountId: principal.accountId,
            content: `# Garden note ${offset + index + 1}\n\nRecord the planting schedule, soil conditions and watering observations. Compare the spring seedlings with the previous season. Keep project decisions and useful context together. ${"A clear plan helps the garden grow. ".repeat(8)}`,
            kind: "fact",
            status: "active",
            version: 1,
            source: JSON.stringify({ agent: "api" }),
          }),
        );
        await admin.transaction(async (trx) => {
          await trx("memories").insert(memories);
          await trx("memory_revisions").insert(
            memories.map(({ id, accountId, content, version, source }) => ({
              accountId,
              memoryId: id,
              content,
              version,
              source,
            })),
          );
          await trx("memory_embeddings").insert(
            memories.map(({ id, accountId, version }, index) => ({
              accountId,
              memoryId: id,
              version,
              profile: providers.embedding!.profile,
              dimensions: 4096,
              embedding: vectors[index % vectors.length],
            })),
          );
          await trx("memory_enrichments").insert(
            memories.flatMap(({ id, accountId, version }) => [
              {
                accountId,
                memoryId: id,
                version,
                kind: "decision",
                profile: providers.decision!.profile,
                data: JSON.stringify({
                  kind: "fact",
                  topics: ["other"],
                  salience: 0.5,
                  relationships: [],
                }),
              },
              {
                accountId,
                memoryId: id,
                version,
                kind: "organization",
                profile: providers.generation!.profile,
                data: JSON.stringify({
                  title: "Garden notes",
                  tags: ["garden"],
                }),
              },
            ]),
          );
        });
      }
    }
    await admin.raw("ANALYZE");
    const auth = new Authentication(db, {
      async verify(token) {
        const index = Number(token);
        if (!/^\d+$/.test(token) || !subjects[index])
          throw new Error("Unknown fixture identity");
        return {
          subject: subjects[index],
          type: "session",
          sessionId: `capacity-${index}`,
        };
      },
    });
    const app = createApp({
      memories: service,
      auth,
      origin: "http://127.0.0.1:26080",
      siteUrl: "http://127.0.0.1:3000",
      issuer: "https://clerk.example.test",
      webhookSecret: "whsec_dGVzdA==",
      ready: () => probeDatabase(db!),
    });
    return {
      admin,
      db,
      workerDb,
      service,
      worker,
      principals,
      providers,
      app,
      auth,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
