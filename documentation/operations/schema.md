# Schema upgrades

The canonical ordered migration registry is
[`lib/database/src/migrations.ts`](../../lib/database/src/migrations.ts), not a
second numbered list in documentation. Never allocate a slot from an old plan.
Inspect the admitted source and retained database history before every upgrade.

To inspect source registration without connecting to a database:

```sh
pnpm exec tsx -e 'import { migrations } from "./lib/database/src/migrations.ts"; console.log(migrations.map(m => m.name).join("\n"))'
```

## Automatic production rollout

Deploy runs `migrate` after immutable-source admission and before publication.
It checks out the admitted release tag's commit, rejects a superseded production
operation, and uses the step-scoped `GROVE_MIGRATION_DATABASE_URL` production
environment secret. This must be the actual owner of `public.knex_migrations`
and `public.memories`, not either runtime login. It must target the same database
as `GROVE_API_DATABASE_URL` and `GROVE_WORKER_DATABASE_URL`, with
`sslmode=verify-full` (optionally `channel_binding=require` or `prefer`) and no
target/authentication query overrides. Owner credentials
are never passed to builds, images, runtime probes or application services.

The runner reuses the canonical registry and Knex migration ledger. Existing
history must be an exact registry prefix; it never bootstraps an empty database,
skips a migration, rewrites history or runs a down migration. The reviewed
online-compatible set in
[`migration-policy.mjs`](../../scripts/release/migration-policy.mjs) currently
covers migrations 049–052. These preserve old API/worker operation during rollout.
New pending migrations default to the manual procedure until their overlap and
populated-preservation behavior is reviewed and added to that policy. Nontransactional
or incompatible changes require the coordinated owner procedure below.

Execution takes a transaction-scoped advisory lock and the existing Knex lock;
it fails rather than clearing a retained lock. Before DDL, it admits the reviewed
existing-table lock set with `NOWAIT`, including foreign-key parents. If a writer
is busy, the entire attempt rolls back and releases any acquired locks instead
of holding one table while waiting for another. An unchanged schema takes no
DDL locks.

Only table-admission contention (`55P03`) and a confirmed deadlock during forward
migrations (`40P01`) are retried, in fresh transactions after rollback. There are
at most four attempts, with one-, two- and four-second backoff plus up to 250ms
jitter outside transactions. Every attempt rechecks production/source freshness,
ownership, retained history and locks. The complete pending batch and its history
commit together. The five-second lock and two-minute statement limits remain;
all attempts and backoff share one ten-minute migration budget. No provider/GitHub
I/O occurs inside the transaction. Both non-owner runtime schema probes must pass
after migrations, before publication, and again before backend rollout.

This automated path deliberately has **no backup/restore evidence gate**. It does
not create backups, verify restore readiness or operate on original media. Do not
interpret a passing migration job as disaster-recovery acceptance.

`migration-rollout.json` records only source/tag, applied migration names,
completed/unchanged status and attempt count; successful runs retain it as a
workflow artifact. Retry messages show the safe code, next attempt and delay.
Failures identify the stage, safe database error code and attempt count, never
raw SQL or connection values. A failed or canceled job prevents publication/deployment.
An unacknowledged commit is not proof of rollback: inspect retained history before
retrying. A rerun rechecks history under the lock and becomes a no-op if committed;
it never repeats completed migrations or automatically unlocks/reverses changes.
Already-applied incompatible migrations also need their rollout coordination;
an unchanged ledger alone does not qualify older runtimes.

After retry exhaustion, inspect the retained ledger, Knex lock and PostgreSQL's
deadlock/blocker report. Long-lived transactions or a consistently busy lock set
need a coordinated quiet window, not larger blanket timeouts or forced unlocks.
Permanent DDL/auth/history errors, retained locks, statement timeouts, and uncertain
connection/commit outcomes are not automatically retried. Fix the reported cause
before explicitly resuming the original eligible release. Changes to this runner
ship through a new ordinary release; do not edit a frozen release tag to install
a recovery fix.

Verification includes
[`database-rollout.test.ts`](../../tests/src/database-rollout.test.ts) against
disposable PostgreSQL 17 for populated 048→052 preservation, real non-owner RLS,
batch rollback, busy writers on every admitted relation, released partial locks,
real PostgreSQL deadlock recovery, bounded contention exhaustion, unchanged-schema
admission, concurrent/stale locks, lost commit acknowledgement and replay.
Release helper tests cover target/source guards, safe diagnostics and workflow
ordering/secret scope. Hosted production configuration and execution remain
separate acceptance checks.

## Manual owner procedure

1. Confirm the immutable release source, registered order, actual applied history
   (`knex_migrations`) and all pending feature prerequisites. Resequence only an
   **unapplied, unmerged** feature migration when integrating parallel work. Never
   rename/edit applied history, skip prerequisites or replay an old slot.
2. Verify an encrypted retained backup and isolated restore, including private
   original media. Keep the current authority and lifecycle-event backlog available.
   Follow [backup/recovery](../deploy.md#backups-and-deletion).
3. Pause incompatible traffic and drain old API/worker writers. Use the separate
   migration-owner connection to apply the admitted source's forward migrations;
   do not place it in runtime, browser or agent configuration. Review DDL locks,
   required extensions and the owning feature's rollout/rollback constraints first.
4. Compare retained source columns, grants, current roles and usage counters.
   Inspect real non-owner API/worker isolation and readiness. A fresh empty upgrade
   is not a substitute for a populated preservation test.
5. Roll out compatible API/worker together, then website/bundled consumers as their
   contracts require. Do not start old writers that bypass new accounting, lifecycle,
   preference, cache or protocol fences. Retain additive schema on code rollback.

Historical migration tests should stop their old-column comparison at the migration
they test, then upgrade fully before exercising today's runtime. Do not delete
retention assertions or reset an existing database to pass a newer readiness probe.

Restored targets need the **same migrations** as current authority before
reconciliation and must remain offline until current deletion/revocation/grant and
provider authority is reconciled. No reverse migration is a supported recovery shortcut.

## Feature-specific requirements

Each [topic guide](../README.md) owns its own schema/configuration and acceptance
requirements. The generic procedure here does not imply that any migration has
been applied in production. Inspect `knex_migrations` and current release evidence
rather than inferring deployment from merged source or dated documentation.
