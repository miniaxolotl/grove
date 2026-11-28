import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import console from "node:console";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { assertCurrentRef } from "../ci/current-ref.mjs";
import {
  databaseTarget,
  runtimeTargets,
  targetFingerprint,
  safeDatabaseCode,
} from "./database-target.mjs";
import { migrationLocks, migrationPlan } from "./migration-policy.mjs";

function assertSource(env) {
  const git = (...args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  assert.equal(git("rev-parse", "HEAD"), env.RELEASE_SOURCE_SHA);
  assert.equal(
    git("rev-parse", `${env.RELEASE_TAG}^{commit}`),
    env.RELEASE_SOURCE_SHA,
  );
  assert.equal(git("status", "--porcelain", "--untracked-files=no"), "");
}

export async function rolloutMigrations(env, dependencies = {}) {
  let phase = "protected release identity";
  let db;
  let result;
  let failure;
  let attempts = 0;
  try {
    assert.equal(env.GITHUB_REPOSITORY, "miniaxolotl/grove");
    assert.equal(env.GITHUB_REF, "refs/heads/production");
    assert.equal(env.GITHUB_REF_PROTECTED, "true");
    assert.match(env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/);
    assert.match(env.RELEASE_SOURCE_SHA ?? "", /^[a-f0-9]{40}$/);
    assert.match(env.RELEASE_TAG ?? "", /^v\d+\.\d+\.\d+$/);
    const fence =
      dependencies.assertCurrent ??
      (() =>
        assertCurrentRef({
          repository: env.GITHUB_REPOSITORY,
          ref: env.GITHUB_REF,
          sha: env.GITHUB_SHA,
          protected: env.GITHUB_REF_PROTECTED,
        }));
    await fence();
    await (dependencies.assertSource ?? assertSource)(env);

    phase = "owner/runtime target configuration";
    const { api } = runtimeTargets(env);
    const owner = databaseTarget(env.GROVE_MIGRATION_DATABASE_URL);
    assert(
      !["grove_api", "grove_jobs", "grove_runtime", "grove_worker"].includes(
        decodeURIComponent(owner.username),
      ),
    );
    assert.equal(targetFingerprint(owner), targetFingerprint(api));
    const defaults = dependencies.connect
      ? dependencies
      : await import("@lib/database");
    const connect = dependencies.connect ?? defaults.createDatabase;
    const registry =
      dependencies.registry ?? (await defaults.migrationSource.getMigrations());

    const now = dependencies.now ?? (() => performance.now());
    const deadline = now() + 600_000;
    const wait = dependencies.wait ?? setTimeout;
    const quiet = () => {};
    for (let nextAttempt = 1; nextAttempt <= 4; nextAttempt++) {
      phase = "migration retry deadline";
      assert(now() < deadline);
      // Source/network freshness is checked outside SQL transactions on every try.
      if (nextAttempt > 1) {
        phase = "protected release identity";
        await (dependencies.assertSource ?? assertSource)(env);
      }
      phase = "current production fence";
      await fence();
      phase = "database connection";
      db ??= connect(owner.href, {
        ssl: true,
        max: 1,
        acquireTimeoutMs: 10000,
        statementTimeoutMs: 120000,
        // Knex's migration warnings otherwise include SQL, bound data and raw errors.
        log: { warn: quiet, error: quiet, debug: quiet, deprecate: quiet },
      });
      attempts = nextAttempt;
      try {
        result = await db.transaction(async (trx) => {
          phase = "migration retry deadline";
          const remaining = Math.floor(deadline - now());
          assert(remaining > 0);
          phase = "bounded migration lock";
          await trx.raw(
            `SET LOCAL lock_timeout = '${Math.min(5000, remaining)}ms'`,
          );
          await trx.raw(
            `SET LOCAL statement_timeout = '${Math.min(120000, remaining)}ms'`,
          );
          await trx.raw(
            "SET LOCAL idle_in_transaction_session_timeout = '30s'",
          );
          await trx.raw(`SET LOCAL transaction_timeout = '${remaining}ms'`);
          await trx.raw("SET LOCAL search_path TO public, pg_catalog");
          const lock = await trx.raw(
            "SELECT pg_try_advisory_xact_lock(hashtextextended('grove-production-migrations', 0)) AS acquired",
          );
          assert.equal(lock.rows[0]?.acquired, true);

          phase = "migration owner authorization";
          const identity =
            await trx.raw(`SELECT current_user AS username, current_database() AS database,
        pg_get_userbyid(c.relowner) AS owner,
        EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='memories' AND tableowner=current_user) AS owns_memories
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='knex_migrations' AND c.relkind='r'`);
          assert.equal(
            identity.rows[0]?.username,
            decodeURIComponent(owner.username),
          );
          assert.equal(identity.rows[0]?.owner, identity.rows[0]?.username);
          assert.equal(
            identity.rows[0]?.database,
            decodeURIComponent(owner.pathname.slice(1)),
          );
          assert.equal(identity.rows[0]?.owns_memories, true);

          phase = "retained migration history and Knex lock";
          // Coordinate with ordinary owner migrations too; never force-clear a lock.
          const knexLock = await trx.raw(
            "SELECT is_locked FROM public.knex_migrations_lock FOR UPDATE",
          );
          assert.equal(knexLock.rows.length, 1);
          assert.equal(knexLock.rows[0].is_locked, 0);
          const history = await trx.raw(
            "SELECT name FROM public.knex_migrations ORDER BY id",
          );
          const plan = migrationPlan(
            registry,
            history.rows.map((row) => row.name),
          );
          const receipt = {
            sourceSha: env.RELEASE_SOURCE_SHA,
            tag: env.RELEASE_TAG,
            status: "unchanged",
            applied: [],
            attempts,
          };
          if (!plan.pending.length) return receipt;

          phase = "migration table lock admission";
          for (const { table, mode } of migrationLocks(plan.pending)) {
            // Never hold one DDL lock while waiting for another live writer's table.
            // All names/modes come from the reviewed policy, never environment input.
            await trx.raw(`LOCK TABLE public.${table} IN ${mode} MODE NOWAIT`);
          }
          phase = "transactional forward migrations";
          const [, applied] = await trx.migrate.latest();
          assert.deepEqual(applied, plan.pending);
          const after = await trx.raw(
            "SELECT name FROM public.knex_migrations ORDER BY id",
          );
          assert.deepEqual(
            after.rows.map((row) => row.name),
            registry.map((migration) => migration.name),
          );
          return { ...receipt, status: "completed", applied };
        });
        break;
      } catch (error) {
        const code = safeDatabaseCode(error);
        const retryable =
          (phase === "migration table lock admission" && code === "55P03") ||
          (phase === "transactional forward migrations" && code === "40P01");
        if (!retryable || attempts === 4) throw error;
        // Knex has finished rolling back before its transaction promise rejects.
        // Do not retry connection errors or unacknowledged commits.
        const delayMs =
          1000 * 2 ** (attempts - 1) + Math.floor(Math.random() * 251);
        if (now() + delayMs >= deadline) {
          phase = "migration retry deadline";
          throw error;
        }
        dependencies.onRetry?.({
          attempt: attempts,
          nextAttempt: attempts + 1,
          code,
          stage: phase,
          delayMs,
        });
        phase = "migration retry backoff";
        await wait(delayMs);
      }
    }
    phase = "owner connection cleanup";
  } catch (error) {
    // Do not retain the raw cause: driver/Knex errors can contain private SQL.
    failure = new Error(
      `Production migration rollout stopped at ${phase} (${safeDatabaseCode(error)}) after ${attempts} attempts. Review the schema rollout procedure before retrying; do not unlock or reverse migrations automatically.`,
    );
  } finally {
    if (db) {
      try {
        await db.destroy();
      } catch {
        failure ??= new Error(
          "Production migration owner connection cleanup failed; inspect committed history before retrying",
        );
      }
    }
  }
  if (failure) throw failure;
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  rolloutMigrations(process.env, {
    onRetry: ({ nextAttempt, code, delayMs }) => {
      console.warn(
        `Database busy (${code}); locks released. Retrying migrations (${nextAttempt}/4) in ${delayMs}ms.`,
      );
    },
  })
    .then((receipt) => {
      writeFileSync(
        "migration-rollout.json",
        `${JSON.stringify(receipt, null, 2)}\n`,
        { mode: 0o600 },
      );
      console.log(JSON.stringify(receipt));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
