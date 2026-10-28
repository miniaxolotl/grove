# Schema upgrades

The canonical ordered migration registry is
[`lib/database/src/migrations.ts`](../../lib/database/src/migrations.ts), not a
second numbered list in documentation. Never allocate a slot from an old plan.
Inspect the admitted source and retained database history before every upgrade.

To inspect source registration without connecting to a database:

```sh
pnpm exec tsx -e 'import { migrations } from "./lib/database/src/migrations.ts"; console.log(migrations.map(m => m.name).join("\n"))'
```

## Procedure

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
