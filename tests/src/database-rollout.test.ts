import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createDatabase,
  migrationSource,
  probeDatabase,
  tenant,
  type Knex,
} from "@lib/database";
import { migrations } from "../../lib/database/src/migrations.ts";
import {
  rolloutMigrations,
  type RolloutDependencies,
} from "../../scripts/release/database-rollout.mjs";

const baseline = migrations.slice(0, -4);
const pending = migrations.slice(-4).map((migration) => migration.name);

async function fixture(
  run: (f: {
    owner: Knex;
    runtime: Knex;
    worker: Knex;
    env: Record<string, string>;
    dependencies: RolloutDependencies;
  }) => Promise<void>,
) {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url);
  const name = `grove_rollout_${randomUUID().replaceAll("-", "")}_test`;
  const target = (input: string, tls = false) => {
    const value = new URL(input);
    value.pathname = `/${name}`;
    if (tls) value.searchParams.set("sslmode", "verify-full");
    return value.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const owner = createDatabase(target(url));
  const runtime = createDatabase(target(process.env.TEST_DATABASE_URL!));
  const worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  try {
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () => baseline,
      },
    });
    const env = {
      GITHUB_REPOSITORY: "miniaxolotl/grove",
      GITHUB_REF: "refs/heads/production",
      GITHUB_REF_PROTECTED: "true",
      GITHUB_SHA: "b".repeat(40),
      RELEASE_SOURCE_SHA: "a".repeat(40),
      RELEASE_TAG: "v1.11.39",
      GROVE_MIGRATION_DATABASE_URL: target(url, true),
      GROVE_API_DATABASE_URL: target(process.env.TEST_DATABASE_URL!, true),
      GROVE_WORKER_DATABASE_URL: target(
        process.env.TEST_WORKER_DATABASE_URL!,
        true,
      ),
    };
    const dependencies = {
      assertCurrent: () => {},
      assertSource: () => {},
      registry: migrations,
      connect: (
        value: string,
        options: Parameters<typeof createDatabase>[1],
      ) => {
        const local = new URL(value);
        assert.equal(local.hostname, new URL(url).hostname);
        assert.equal(local.pathname, `/${name}`);
        // This explicitly owned loopback fixture has no TLS. The production
        // connection is never given this adapter; its TLS checks remain mandatory.
        local.search = "";
        return createDatabase(local.href, { ...options, ssl: false });
      },
    };
    await run({ owner, runtime, worker, env, dependencies });
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy(), worker.destroy()]);
    await authority.raw("DROP DATABASE ??", [name]);
    await authority.destroy();
  }
}

test("automatic 048→052 preserves populated authored rows, history, counters and scoped runtime grants; replay is a no-op", async () => {
  await fixture(async ({ owner, runtime, worker, env, dependencies }) => {
    const accountId = randomUUID(),
      otherId = randomUUID(),
      noteId = randomUUID();
    await owner("accounts").insert([
      { id: accountId, clerkSubject: `rollout_${accountId}` },
      { id: otherId, clerkSubject: `rollout_${otherId}` },
    ]);
    await owner("memories").insert({
      id: noteId,
      accountId,
      content: "Retained private note",
      kind: "fact",
      source: { agent: "api" },
    });
    await owner("memory_revisions").insert({
      accountId,
      memoryId: noteId,
      version: 1,
      content: "Retained private note",
      source: { agent: "api" },
    });
    await owner("action_usage").insert({
      accountId,
      metric: "ask",
      operation: randomUUID(),
      period: "2026-11-27",
      status: "completed",
      worked: true,
      units: 5,
      leaseId: randomUUID(),
      leaseUntil: new Date("2026-11-27T00:00:00Z"),
    });
    const before = {
      notes: await owner("memories").select("*"),
      revisions: await owner("memory_revisions").select("*"),
      accounts: await owner("accounts").orderBy("id"),
      usage: await owner("action_usage").select("*"),
      history: await owner("knex_migrations").orderBy("id"),
    };
    await assert.rejects(probeDatabase(runtime), { code: "42P01" });
    const result = await rolloutMigrations(env, dependencies);
    assert.deepEqual(result.applied, pending);
    assert.deepEqual(await owner("memories"), before.notes);
    assert.deepEqual(await owner("memory_revisions"), before.revisions);
    assert.deepEqual(await owner("action_usage"), before.usage);
    const accounts = await owner("accounts").orderBy("id");
    for (let i = 0; i < accounts.length; i++) {
      const { noteOrderVersion, ...retained } = accounts[i];
      assert.equal(Number(noteOrderVersion), 0);
      assert.deepEqual(retained, before.accounts[i]);
    }
    assert.deepEqual(
      (await owner("knex_migrations").orderBy("id")).slice(0, baseline.length),
      before.history,
    );
    await probeDatabase(runtime);
    await probeDatabase(worker);
    assert.equal(
      (await tenant(runtime, otherId, (trx) => trx("memories"))).length,
      0,
    );
    assert.equal(
      (await tenant(runtime, accountId, (trx) => trx("memories"))).length,
      1,
    );
    await assert.rejects(
      runtime.raw("CREATE TABLE public.runtime_owner_denied(id integer)"),
      { code: "42501" },
    );
    const history = await owner("knex_migrations").orderBy("id");
    assert.equal(
      (await rolloutMigrations(env, dependencies)).status,
      "unchanged",
    );
    assert.deepEqual(await owner("knex_migrations").orderBy("id"), history);
  });
});

test("DDL failure rolls back the entire pending batch and durable history before a safe retry", async () => {
  await fixture(async ({ owner, env, dependencies }) => {
    const failed = migrations.map((migration) =>
      migration.name === pending[1]
        ? {
            ...migration,
            up: async (trx: Knex) => {
              await trx.raw("SELECT private_sensitive_column FROM accounts");
            },
          }
        : migration,
    );
    const connect: NonNullable<RolloutDependencies["connect"]> = (
      url,
      options,
    ) => {
      const db = dependencies.connect!(url, options);
      db.client.config.migrations = {
        migrationSource: {
          ...migrationSource,
          getMigrations: async () => failed,
        },
      };
      return db;
    };
    await assert.rejects(
      rolloutMigrations(env, { ...dependencies, connect, registry: failed }),
      (error: Error) => {
        assert.match(error.message, /42703/);
        assert.doesNotMatch(error.message, /private_sensitive_column|SELECT/);
        return true;
      },
    );
    assert.equal((await owner("knex_migrations")).length, baseline.length);
    assert.equal((await owner("knex_migrations_lock").first()).isLocked, 0);
    const constraint = await owner.raw(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='memories_content_check'",
    );
    assert.match(constraint.rows[0].definition, /6000/);
    assert.deepEqual(
      (await rolloutMigrations(env, dependencies)).applied,
      pending,
    );
  });
});

test("busy runtime and foreign-key parent tables yield before DDL, release partial locks and retry a fresh checked transaction", async () => {
  for (const table of [
    "accounts",
    "memories",
    "document_import_notes",
    "memory_revisions",
    "embedding_profiles",
  ]) {
    await fixture(async ({ owner, runtime, worker, env, dependencies }) => {
      const writer = await worker.transaction();
      let released = false;
      let waits = 0;
      try {
        await writer.raw("LOCK TABLE ?? IN ROW EXCLUSIVE MODE", [table]);
        const result = await rolloutMigrations(env, {
          ...dependencies,
          wait: async () => {
            waits++;
            assert.equal(
              (await owner("knex_migrations")).length,
              baseline.length,
            );
            // Backoff must be outside the rolled-back migration transaction:
            // the writer can now read memories even if admission locked it first.
            await writer.raw("SET LOCAL lock_timeout='500ms'");
            await writer.raw("SELECT id FROM public.memories LIMIT 0");
            await writer.rollback();
            released = true;
          },
        });
        assert.equal(waits, 1, table);
        assert.equal(result.attempts, 2);
        assert.deepEqual(result.applied, pending);
        await probeDatabase(runtime);
        await probeDatabase(worker);
        assert.equal((await owner("knex_migrations_lock").first()).isLocked, 0);
      } finally {
        if (!released) await writer.rollback();
      }
    });
  }
});

test("a real PostgreSQL deadlock rolls back the batch before a bounded fresh-transaction retry", async () => {
  await fixture(async ({ owner, runtime, env, dependencies }) => {
    await owner.raw(
      "CREATE TABLE rollout_deadlock_a(id integer); CREATE TABLE rollout_deadlock_b(id integer)",
    );
    const writer = await owner.transaction();
    await writer.raw("LOCK TABLE rollout_deadlock_a IN ACCESS EXCLUSIVE MODE");
    let writerQuery: Promise<unknown> | undefined;
    let attempts = 0;
    let released = false;
    const retries: string[] = [];
    const registry = migrations.map((migration) =>
      migration.name === pending[0]
        ? {
            ...migration,
            up: async (trx: Knex) => {
              if (++attempts === 1) {
                // Make this synthetic migration detect the cycle before the writer.
                await trx.raw("SET LOCAL deadlock_timeout='50ms'");
                await trx.raw(
                  "LOCK TABLE rollout_deadlock_b IN ACCESS EXCLUSIVE MODE",
                );
                writerQuery = writer
                  .raw("LOCK TABLE rollout_deadlock_b IN ACCESS EXCLUSIVE MODE")
                  .then(() => undefined);
                await trx.raw(
                  "LOCK TABLE rollout_deadlock_a IN ACCESS EXCLUSIVE MODE",
                );
              }
              await migration.up(trx);
            },
          }
        : migration,
    );
    const connect: NonNullable<RolloutDependencies["connect"]> = (
      url,
      options,
    ) => {
      const db = dependencies.connect!(url, options);
      db.client.config.migrations = {
        migrationSource: {
          ...migrationSource,
          getMigrations: async () => registry,
        },
      };
      return db;
    };
    try {
      const result = await rolloutMigrations(env, {
        ...dependencies,
        connect,
        registry,
        onRetry: ({ code }) => {
          retries.push(code);
        },
        wait: async () => {
          await writerQuery;
          assert.equal(
            (await owner("knex_migrations")).length,
            baseline.length,
          );
          await writer.rollback();
          released = true;
        },
      });
      assert.deepEqual(retries, ["40P01"]);
      assert.equal(result.attempts, 2);
      assert.equal(attempts, 2);
      assert.deepEqual(result.applied, pending);
      await probeDatabase(runtime);
      assert.equal(
        (await rolloutMigrations(env, dependencies)).status,
        "unchanged",
      );
    } finally {
      if (!released) await writer.rollback();
      await writerQuery?.catch(() => {});
    }
  });
});

test("persistent admission contention leaves no schema/history changes and an unchanged schema never takes DDL locks", async () => {
  await fixture(async ({ owner, env, dependencies }) => {
    const writer = await owner.transaction();
    let waits = 0;
    try {
      await writer.raw("LOCK TABLE accounts IN ROW EXCLUSIVE MODE");
      await assert.rejects(
        rolloutMigrations(env, {
          ...dependencies,
          wait: async () => {
            waits++;
            await writer.raw("SET LOCAL lock_timeout='500ms'");
            await writer.raw("SELECT id FROM memories LIMIT 0");
          },
        }),
        /migration table lock admission \(55P03\).*4 attempts/,
      );
      assert.equal(waits, 3);
      assert.equal((await owner("knex_migrations")).length, baseline.length);
      assert.equal((await owner("knex_migrations_lock").first()).isLocked, 0);
      const schema = await owner.raw(
        "SELECT to_regclass('public.memory_embedding_chunks') AS chunks, EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.accounts'::regclass AND attname='note_order_version') AS ordered",
      );
      assert.equal(schema.rows[0].chunks, null);
      assert.equal(schema.rows[0].ordered, false);
    } finally {
      await writer.rollback();
    }
    await rolloutMigrations(env, dependencies);
    await owner.transaction(async (busy) => {
      await busy.raw("LOCK TABLE accounts IN ROW EXCLUSIVE MODE");
      const result = await rolloutMigrations(env, dependencies);
      assert.equal(result.status, "unchanged");
      assert.equal(result.attempts, 1);
    });
  });
});

test("concurrent rollout and retained Knex locks reject execution without clearing another owner's lock", async () => {
  await fixture(async ({ owner, env, dependencies }) => {
    await owner.transaction(async (trx) => {
      await trx.raw(
        "SELECT pg_advisory_xact_lock(hashtextextended('grove-production-migrations', 0))",
      );
      await assert.rejects(
        rolloutMigrations(env, dependencies),
        /bounded migration lock/,
      );
    });
    await owner("knex_migrations_lock").update({ isLocked: 1 });
    await assert.rejects(rolloutMigrations(env, dependencies), /Knex lock/);
    assert.equal((await owner("knex_migrations_lock").first()).isLocked, 1);
    assert.equal((await owner("knex_migrations")).length, baseline.length);
  });
});

test("lost commit acknowledgement reconciles from retained history without replaying forward DDL", async () => {
  await fixture(async ({ env, dependencies }) => {
    const connect: NonNullable<RolloutDependencies["connect"]> = (
      url,
      options,
    ) => {
      const db = dependencies.connect!(url, options);
      const transaction = db.transaction.bind(db);
      const lostAcknowledgement = async (
        run: (trx: Knex.Transaction) => Promise<unknown>,
      ) => {
        await transaction(run);
        throw Object.assign(new Error("uncertain private connection"), {
          code: "ECONNRESET",
        });
      };
      return new Proxy(db, {
        get: (target, property, receiver) =>
          property === "transaction"
            ? lostAcknowledgement
            : Reflect.get(target, property, receiver),
      });
    };
    await assert.rejects(
      rolloutMigrations(env, { ...dependencies, connect }),
      /ECONNRESET/,
    );
    const reconciled = await rolloutMigrations(env, dependencies);
    assert.equal(reconciled.status, "unchanged");
    assert.deepEqual(reconciled.applied, []);
  });
});
