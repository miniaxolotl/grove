# Notebook organization foundation

This first implementation slice provides the owner-only catalog and atomic
parent/order API for the approved [organization plan](https://github.com/miniaxolotl/grove/pull/138).
The shared Organize interface, searchable picker and mobile gesture work are
follow-up slices. Existing website controls are unchanged; this is not a mobile
gesture-fix or physical-device acceptance claim.

## Complete owner catalog

`GET /v1/projects/catalog` requires the owning website session. It accepts:

- `status`: `active` (default) or `archived`.
- `limit`: 1–200, default 200.
- `cursor`: the exact `nextCursor` from the preceding response.

It returns `{ items, state, nextCursor }`. Each notebook includes `position` along
with its existing ID, name, identity, parent, version and status. Positions are
relative to a parent; top-level notebooks form their own sibling group. Pages
order by parent (top level first), position and ID, not a flattened depth-first tree.
The owner UI must combine pages before rendering a complete tree. Parent IDs are
not cleared because a parent falls on another page.

`state` is an opaque account-bound HMAC over the monotonically increasing catalog
epoch. Cursors bind account, status and that state. A changed catalog returns 409
`notebook_order_conflict`; discard the partial scan and restart. Do not display a
partial scan as complete or accept ordering operations from a partially loaded
catalog. Page reads use the account's shared lock; writes hold its exclusive lock.

Legacy `GET /v1/projects` remains the original name-sorted, at-most-100 array with
grant-aware hidden-parent normalization. Existing paged `notebooks` MCP tools keep
their grant-scoped contract. They do not receive owner position metadata or new
organization authority. API keys/OAuth cannot call the new catalog or arrange an
account's notebook order, even with all-project access.

## Atomic organization

`POST /v1/projects/:id/organize` requires:

| Field                   | Meaning                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `operationId`           | Fresh UUID for a new intent; retain it for uncertain-response retries |
| `expectedVersion`       | Current source notebook version                                       |
| `expectedState`         | Exact `state` from the complete current catalog                       |
| `parentId`              | Destination notebook UUID, or `null` for top level                    |
| `beforeId` or `afterId` | Optional sibling anchor; mutually exclusive; omit to append           |

The response is `{ project, state, undo }`. `undo` contains the original parent
and adjacent sibling anchor. To undo, submit a **new** operation ID with `undo`,
the response's `state` and `project.version`. This is not deletion Undo. If another
catalog change happened, return 409 and require review; do not fetch a fresh state
and silently replay the old Undo against it.

All source/parent/anchor notebooks must be active, visible in the same account and
current. Anchors must belong to the destination group and cannot be the source.
A notebook cannot move into itself or a descendant. Source parent changes and
sibling positions commit together under the existing account write lock. Notes,
subtrees and their IDs are not rewritten. Parent access still grants no child
access; ordinary sibling ordering never changes sharing permissions.

One valid request either applies once or makes no change. Reusing its operation ID
with another payload returns 409 `operation_conflict`. Exact replay returns the
stored result before state validation, even after the first result was lost. A
replayed result can be older than the current catalog; consumers must reconcile
from a fresh catalog rather than overwrite newer rows with it.

Positions are integer ranks; only the destination group is compacted. Existing
groups backfill in stable name/ID order. New notebooks and legacy reparent writes
append without supplying new fields. Renaming preserves position. Same-parent
ordering does not bump the notebook content/source version, account content
version, AI job queue or usage. The separate catalog epoch changes even when
later operations return to identical positions, preventing ABA/stale Undo. No-op
placement leaves ranks, versions and state unchanged.

## Archive, export and recovery

Archive retains position. Archived notebooks cannot be arranged until restored.
If an archived rank collides with a later active position, restore retains it and
ID is the deterministic tie-breaker. A later explicit organization compacts the
affected group; no retained record is erased.

Private notebook/account NDJSON exports include position. Existing export-version
invalidation fences an export when ordering changes; it cannot mix old/new ranks.
This does not add a general notebook backup-import UI: existing source imports
keep their current contract and newly created notebooks append. A full database
backup retains positions. Restore reconciliation preserves the backup's authored
layout, clears operation receipts as before, and raises the catalog epoch above
both backup and current authority. Pre-restore cursors/Undo cannot become valid
again, even if restored positions match an old layout.

## Rollout and verification

Forward migration `20261025_032_notebook_order` adds positions, the catalog epoch,
an order index and tenant-scoped compatibility/invalidation triggers. It creates
no new tenant table or permission. Migration numbering avoids parallel provisional
029/030/031; refresh actual source/history before operator rollout. Runtime readiness
requires both new columns. See [rollout](deploy.md#notebook-order-foundation-rollout-032).

`notebook-organization.test.ts` exercises complete paged discovery beyond100,
parent preservation, atomic nesting and reordering, source-version stability,
retry/replay, concurrent changes, stale Undo/ABA, strict HTTP validation,
archive/delete handling, export and owner/tenant denial. The populated migration
test preserves all earlier project/account columns except the existing derived
export invalidation counter. Recovery tests require a fresh catalog epoch.
All fixtures use disposable PostgreSQL and non-owner API/worker roles.
