# Workspace reads and mutations

The authenticated shell owns an in-memory TanStack Query client per Clerk user
**and session**. It is destroyed on sign-out, account/session replacement or
terminal authentication loss after the recovery attempt below. Queries, searches,
drafts and note content are never persisted to browser storage. Requests use
`cache: "no-store"` and the BFF sends `Cache-Control: private, no-store`; this cache
belongs to the mounted workspace.

`WorkspaceNavigationState` separately owns optional browser UI metadata, keyed by
Clerk account under `grove:navigation:v1:<account>`. Its bounded schema includes at
most 500 UUID/boolean expansion overrides, separate desktop/mobile scroll offsets
and one outline-pin boolean. It contains no names, note content, query text, drafts,
permissions or capability URLs. It survives same-account sign-out/session changes;
the shell's keyed owner prevents cross-account callbacks or reads. Browser storage
clearing removes it. Malformed, oversized, unavailable or quota-full storage falls
back to in-memory choices. This is not a persisted query cache.

Restoration reads before writes are allowed, waits for a successful notebook load,
and follows late nested-page layout for up to five seconds. User wheel/touch/pointer/
keyboard input ends restoration. Removed expansion IDs are pruned only after a
successful directory read; transient tree filtering and drag expansion are not saved.
Other notebook pickers keep their own state. No storage-event synchronization of
these preferences is promised between already-open tabs.

## Session readiness and recovery

The shell waits for Clerk's user and session to load before mounting the workspace.
`WorkspaceCacheProvider` creates a `dashboard-session.ts` transport for that exact
user/session pair. Each cache-owned JSON request waits for `session.getToken()` and
sets its Bearer header explicitly. Clerk owns token caching and expiry; Grove does
not store a second token or assume that a short-lived JWT expiry ends the login.

An explicit HTTP 401 triggers `getToken({ skipCache: true })` and one replay.
Concurrent failures share the pending refresh; requests starting during it wait,
and late 401s from the previous generation reuse the SDK's refreshed token. The
original method, serialized body, expected version, operation ID and abort signal
are retained. Network failures, permission 403s, conflicts and server errors do not
trigger this replay. Telemetry records one logical operation. Each dispatch rechecks
the browser's telemetry preference and sends opt-out if either the original request
or the current choice disallows collection. Re-enabling cannot weaken the original
request's opt-out.

Token waits are bounded to ten seconds. A thrown or timed-out SDK refresh becomes
`SessionRefreshError`, with ordinary load/save retry feedback and no automatic query
retry. Existing snapshots and drafts remain mounted; a later retry, stale-read
focus/reconnect or normal revalidation can recover. A failed save keeps its original
retry identity and newer typing. A missing token or a 401 after replay for the current
credential generation still clears private state and shows the sign-in recovery link.
A denial from an older generation, or while a newer refresh is pending, is recoverable
without another automatic replay. Malformed/empty error bodies retain their HTTP
status so they cannot bypass this policy through automatic query retries. Permission failures stay scoped
to the requested resource instead of ending the whole workspace.

Live Clerk identity and cancellation are checked around token waits and dispatch,
including before replay. Cancelling one waiter does not cancel a refresh needed by
another request. Account/session replacement disposes the old cache and fences
late replies; its draft store is not transferred to the new owner. This transport
is owned by `WorkspaceCache`; standalone dialog and binary-fetch transports have
their own request lifecycles.

## Read ownership

Ask Grove tool updates invalidate the conversation and `/ask-tools` defaults across
tabs. Pending conversation reads poll actual progress every two seconds and retain
the optimistic turn until the server acknowledges it. Organization Apply/Undo
invalidates active/archived notebook directories as well as note dependencies;
generic note invalidation alone does not refresh the sidebar's notebook list.

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
  Conversation history uses `/conversations/search` with a separate infinite-query
  key per query; POST remains a read and sends cancellation through the transport.
  Deletion immediately removes the conversation from every cached history page,
  including inactive searches, before background revalidation.
- `relationships(filters)` owns canonical connection pages, normalized graph
  endpoint sets and cursor retries. Closed Linked notes fetches nothing; expansion
  reads batched titles/evidence rather than making per-note title requests. Fresh
  reopenings reuse those pages. Pending processing polls every 15s for up to two
  minutes while visible; ordinary freshness is 15s.
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

Public sharing readers never use the authenticated workspace cache. Owner sharing
dialogs also read their permission/link state afresh on each open or conflict;
capability URLs stay out of workspace snapshots and cross-tab messages. Share
mutations retain their dialog-owned operation identities and version checks, while
note/notebook edits continue through the workspace reconciliation path.

## Durable changes

Use `useWorkspaceApi()` for workspace mutations. It publishes cache effects before
the caller's navigation or completion callback, including when an editor unmounts
while a save is pending. A successful operation patches authoritative records,
cancels affected reads and revalidates affected active queries. List order/filter
membership is server-owned. Note changes cover the old/new notebook, global lists,
search, briefs and history; conversation apply/undo refreshes note dependencies.
Notebook patches preserve the directory's previous freshness timestamp. A single
create response cannot become a supposedly complete project directory.
Notebook lifecycle responses contain affected notebook IDs rather than note bodies.
Archive/Delete cancels held workspace reads, prunes cached note/search/connection
sources across those scopes and refreshes active/archived directories. Cross-tab
lifecycle messages carry only action and notebook IDs. Failed/uncertain lifecycle
writes revalidate without changing the dialog's original retry identity; the reviewed
preview stays frozen until explicit conflict review. Local drafts block confirmation.
Source changes invalidate the relationship family and remove affected evidence
before late reads can restore it. Notebook edits and review/retry actions also
invalidate that family; review does not refresh unrelated note lists.

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
Row deletion holds autosave and settles uncertain saves through the same scoped
transport. A replay returning a later version keeps the original draft base and
reviewable latest version, including after cancelling and reopening deletion.
Ask Grove keeps unsent messages and uncertain-turn identities per conversation in
the authenticated session's in-memory store. History switching restores the matching
draft; the new-conversation scratch draft is separate. History opens are cancellable
and only replace the current reader after success. History search itself is transient
dialog state and does not appear in URLs or browser storage.
Exports are session-owned and retain their local snapshot through first-save routing.
Preference forms similarly freeze their loaded base on first edit. Background
`/me` updates cannot acknowledge local changes, and a completed save acknowledges
only the submitted snapshot, preserving edits made while it was pending.

The Notes drawer/editor and secondary notebook panels load on demand, with an
in-place chunk retry. Note hover/focus can preload the reader. Canonical connections
load only on expansion; notebook connection panels are deferred too. This supersedes
the original four-worker legacy title loader. Hidden mobile notebook previews stay
idle. Keep these boundaries when
changing reader/toolbars/actions; an eager reader import in the Notes entry brings
the editor back into the initial bundle.

The installed Clerk SDK requires its UI entry for sign-in and account controls.
A `prefetchUI={false}` trial broke real sign-in and was reverted. Production-runtime
checks exercise sign-in and the account menu alongside the deferred note editor.
The two JetBrains Mono weights load on CSS demand, saving 79,396 preloaded font
bytes on Notes. Space Grotesk retains its preloads and adjusted fallback metrics.

Deferred views share a quiet `LoadingState`. Drawer loading, recovery and ready
content use the same width. Retry returns focus to the dialog's close control before
replacing its button; the ready compact toolbar receives that focus as the temporary
header retires. Placeholders are static and decorative;
their short status labels remain available to assistive technology.

The library presents a count only after receiving a snapshot. A sustained background
refresh appears in a reserved status slot beside that count. If it fails, the same
slot offers Retry while existing content and selection remain in place. Initial-read
and mutation failures retain their full error feedback. Keyboard retry keeps focus
on the summary while the status changes.
An interrupted next-page read retries its cursor rather than restarting the list.
When composing other library-chrome changes, preserve the `.library-sync` reserved
slot and `.library-summary` focus target; they prevent refresh feedback from moving
existing notes or losing keyboard position.

## Checks

`tests/cache.spec.ts` covers ownership, cancellation, freshness/version/deletion,
expiry and retention. `tests/client-cache.spec.ts` uses actual workspace components
for navigation, retained drafts, cross-tab changes, linked titles and request counts.
The existing workspace suite covers mutations, conflicts, pagination, keyboard,
accessible dragging, focus, mobile geometry and telemetry privacy.

Production Next/Clerk measurements and the deterministic CI entry budget are
documented in [performance verification](../../scripts/performance/README.md).
