# Workspace reads and mutations

The authenticated shell owns an in-memory TanStack Query client per Clerk user
**and session**. It is destroyed on sign-out, account/session replacement or
authentication loss. Queries, searches, drafts and note content are never persisted
to browser storage. The authenticated `dashboard-api.ts` transport and BFF continue
to send `private, no-store`; this cache belongs to the mounted workspace.

## Read ownership

Use `useWorkspaceCache()` and the query factories in
`packages/website/src/lib/workspace-cache.ts`:

- `notes(filters)` is an infinite query. All scope/filter/sort/limit fields are
  normalized into the key. Missing project means all notebooks; `null` means Unfiled.
  Cursor state belongs to that query. Refetch starts at the first page and rebuilds
  subsequent cursors; old-scope requests cannot append into a new scope.
- `note(id)` shares complete list and mutation snapshots with the reader/editor.
  Higher content versions win. Equal-version enrichment can refresh, but a read
  begun before a newer snapshot cannot overwrite it.
- `resource<T>(path, body)` handles projects, preferences, models, usage, connection
  metadata, briefs, revision history and conversations/search. POST search is a read.
- `fetch` / `fetchNote` support imperative consumers with a temporary observer.
  Consumers share a miss; leaving one consumer does not cancel another's request.
  Pass a consumer signal so its subscription is released on departure.

Fresh windows: notes 30s, text/search queries and conversations/usage 15s,
projects 120s, preferences/models/connections 60s. Inactive entries expire after
five minutes (one minute for searches), with at most 200 inactive snapshots.
Active pagination is retained. Focus/reconnect refresh stale observers; visible
workspaces refresh active reads every 60s for agent changes. Pending note processing
polls every five seconds for up to two minutes from observation, with background
polling disabled. Brief reads always revalidate so server expiry/job scheduling
remains authoritative. Expiry/purge deadlines also prune cached list membership.

## Durable changes

Use `useWorkspaceApi()` for workspace mutations. It publishes cache effects before
the caller's navigation or completion callback, including when an editor unmounts
while a save is pending. A successful operation patches authoritative records,
cancels affected reads and revalidates affected active queries. List order/filter
membership is server-owned. Note changes cover the old/new notebook, global lists,
search, briefs and history; conversation apply/undo refreshes note dependencies.
Notebook patches preserve the directory's previous freshness timestamp. A single
create response cannot become a supposedly complete project directory.

Cross-tab messages contain only resource names, note IDs and notebook scopes.
They carry no content, search text, credentials or drafts. Failed/uncertain note
writes revalidate snapshots while the editor retains its original operation ID.
New endpoint families must add their dependency reconciliation here and meaningful
race/request-count coverage; do not restore a shell-wide revision counter.

## Editing and loading

Fetched snapshots are separate from `NoteDraftsProvider`. A dirty draft keeps its
original version and uncertain save request; a newer fetched version becomes a
reviewable conflict. Later-version idempotent replay also requires explicit review.
Revalidation never silently gives that draft permission to overwrite another edit.

The Notes drawer/editor and secondary notebook panels load on demand, with an
in-place chunk retry. Note hover/focus can preload the reader. Linked titles load
only on expansion, reusing note snapshots and limiting misses to four concurrent
requests. Hidden mobile notebook previews stay idle. Keep these boundaries when
changing reader/toolbars/actions; an eager reader import in the Notes entry brings
the editor back into the initial bundle.

The installed Clerk SDK requires its UI entry for sign-in and account controls.
A `prefetchUI={false}` trial broke real sign-in and was reverted. Production-runtime
checks exercise sign-in and the account menu alongside the deferred note editor.
The two JetBrains Mono weights load on CSS demand, saving 79,396 preloaded font
bytes on Notes. Space Grotesk retains its preloads and adjusted fallback metrics.

## Checks

`tests/cache.spec.ts` covers ownership, cancellation, freshness/version/deletion,
expiry and retention. `tests/client-cache.spec.ts` uses actual workspace components
for navigation, retained drafts, cross-tab changes, linked titles and request counts.
The existing workspace suite covers mutations, conflicts, pagination, keyboard,
accessible dragging, focus, mobile geometry and telemetry privacy.

Production Next/Clerk measurements and the deterministic CI entry budget are
documented in [performance verification](../../scripts/performance/README.md).
