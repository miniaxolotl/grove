# Seamless bulk actions

Synthetic notebooks and notes only. Captures use the production-built website
CSS with the isolated dashboard fixture over synthetic HTTP responses; no
production accounts, provider calls or private-note content appear. Desktop is
1440×1000px.

## Layout

- `notes-bulk-toolbar-1440.png`: two selected notes with the Move, Archive and
  new danger Delete actions in the shared selection toolbar.
- `notes-bulk-delete-1440.png`: the generalized delete dialog confirming two
  notes at once, with the hidden-history consent copy.
- `archived-bulk-toolbar-1440.png`: the Archived notebooks list with
  multi-select checkboxes and the Restore/Delete toolbar.
- `archived-bulk-restore-1440.png`: the bulk lifecycle dialog with parallel
  preview counts and the blocked-parent report.

## Verification context

Application source: `feat/seamless-bulk-actions` on development `5bdad30a`.
Bulk note deletion posts one `/memories/delete` call (≤50 items) with per-item
conflict rollback; archived bulk restore/delete previews per root in parallel,
dedupes covered descendants and commits each root on its own optimistic stage.
Note archive/restore/move, notebook organize and single lifecycle dialogs apply
instantly and roll back on failure. Covered by `client-cache.spec.ts`
(journal rollback, tombstone restore) and `workspace.spec.ts` (bulk happy and
conflict paths, held-request instant apply, organize snap-back, archived bulk).
