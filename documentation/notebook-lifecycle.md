# Archive and delete notebooks

Notebook lifecycle actions require the owning website session. They apply to the
selected notebook, **all sub-notebooks**, and all their non-deleted notes, including
notes already archived or expired. The confirmation names the notebook and shows
the complete notebook/note counts; nothing changes until confirmation.

## Archive and restore

Archive removes the subtree from active navigation and archives its active notes.
Use **Manage notebooks → Archived** to restore it. Restore the parent first when
attempting to restore a child of an archived notebook. Notes and child notebooks
archived separately before the operation remain archived. Expired notes retain
their expiry and purge dates; notebook restoration never extends retention.

Archived notebooks cannot be renamed, moved, populated, or used to edit/restore
individual notes until restored. Read-only note/history access and ordinary
retention/soft-deletion cleanup remain available. IDs, agent/repository references,
source text, task references and authored revisions stay intact. Archive/restore
adds a revision for each note whose state changes; restored eligible notes reenter
the existing processing lanes under current profiles/preferences.

## Soft deletion only

Delete hides the entire subtree and its note history from normal owner, agent,
worker, search and public reads. **It does not permanently erase source records or
revisions.** It uses migration 014's existing before-delete tombstone triggers,
which intercept deletion before row removal. No cloud/provider data is deleted.
There is no in-app Undo or restore for deleted notebooks. Recovery replays both
note and notebook tombstones into an isolated restore, retaining hidden history.

Direct share links on affected notebooks and notes are revoked. Restore does not
reactivate those links. A still-active ancestor link with sub-notebook scope hides
archived/deleted descendants; restoring an archived descendant includes it again
under that ancestor's existing permission. Sharing remains explicit and owner-only.

## API and concurrency

| Route | Contract |
| --- | --- |
| `GET /v1/projects` | Active notebooks within the existing grant scope |
| `GET /v1/projects?status=archived` | Archived directory; website session only |
| `GET /v1/projects/:id/lifecycle` | Owner-only preview: `project`, `projectIds`, `notebooks`, `notes`, `fingerprint`, `canRestore` |
| `POST /v1/projects/:id/archive` | Archive the reviewed subtree |
| `POST /v1/projects/:id/restore` | Restore only that archive operation's contents |
| `POST /v1/projects/:id/delete` | Soft-delete the reviewed subtree |

All mutations require `operationId` (UUID), `expectedVersion` (notebook version)
and the preview's `fingerprint`. They return `{ action, projectIds }`. API keys and
OAuth grants cannot administer a subtree, even if they can write/delete individual
notes; parent scope never implies child authorization.

The ordinary account write lock makes each subtree mutation atomic. The fingerprint
checks the content/change/catalogue counters: note edits, additions, moves, and
hierarchy changes require **Review current contents** and a fresh confirmation.
Conservatively, unrelated account edits can also require review. A retry retains
the exact original payload and operation ID; replay cannot repeat the mutation or
reactivate a deleted record. Interrupted transactions roll back as a unit.

The browser freezes the reviewed preview, disables confirmation for local drafts,
and preserves pending/uncertain save identities rather than discarding writing.
Successful mutations cancel held reads, remove affected cached sources and refresh
directories, lists and derived evidence. Cross-tab messages contain only action/
scope metadata. Other-tab saves still meet server version and inactive-notebook
guards; they cannot write into or resurrect an inactive subtree.

## Rollout and verification

Requires forward migration **016** after **015**. Apply it with the owner connection
in the maintenance window, then deploy matching API/worker before website. Runtime
readiness checks the new columns. No migration or deployment is run automatically
by this feature. See [rollout](deploy.md#notebook-lifecycle-rollout-016).

Tests in `tests/src/notebook-lifecycle*.test.ts` exercise real non-owner API/worker
roles, subtree scope, provenance, retention, stale previews, retry receipts,
cross-account denial, public links, populated upgrade and recovery. Browser tests
cover all three entry points, cancellation, stale scope, committed-but-lost replies,
draft preservation, cache cancellation and desktop/390/320px accessibility/overflow.
See [verification](development/testing.md) and [delivery evidence](delivery.md).
