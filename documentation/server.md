# Memory tools and API

The Node 24 Hono service exposes `/v1` REST and stateless Streamable HTTP `/mcp`.
Both call the same transactional memory service and Zod contracts. The published
CLI is an API-only stdio bridge; it has no database credentials or local database.

## Authentication

Private `/v1` data endpoints and `/mcp` require `Authorization: Bearer …`:

- Website: Clerk session JWT, fixed issuer/JWKS, RS256, expiry, session ID and exact
  authorized website origin. No cookies are accepted directly by the API.
- Agent OAuth: Clerk Backend API verifies active access tokens, **exact resource
  audience `API_ORIGIN/mcp`**, user subject, OAuth client identity and token scopes.
  Clerk requires `openid`; its scopes establish identity, not memory permissions.
  Grove checks the database connection's `memory:*` capabilities and project grant
  on every call. An identity token alone grants no content access.
- Headless: named random API keys, stored hashed, with the same grant enforcement.

An unapproved OAuth client gets no memory access. Keys never grant account-admin
access. Connections may include personal memories, selected projects, or all current
and future projects. Revocation is checked for each request. Revoked keys cannot be
reactivated. OAuth reapproval requires a token issued after the new authorization
cutoff. Client-supplied owner IDs are rejected.

Protected-resource discovery: `/.well-known/oauth-protected-resource/mcp`.
Anonymous requests receive 401 and `WWW-Authenticate`. Provider outages return 503,
not a fabricated connected state. Development and production OAuth verification
are recorded in [delivery evidence](delivery.md#hosted-production-verification);
this is not acceptance of either hosted-chat client. See [hosted-chat setup](hosted-chat.md).

An authenticated, unapproved OAuth client can initialize MCP and list tool schemas,
but cannot read or write notes. Remote tool calls return `connection_required` with
an exact connection link and authenticated client ID for owner approval. This is
a Grove permission failure, not a 401 challenge that should restart OAuth. Tool
listing and the connection's last-contact timestamp do not prove host tool use.

Owner `GET /v1/connections` includes a `state` fingerprint. The website sends it as
`expectedState` on `PATCH /v1/connections/:id`; an atomic mismatch returns 409
`connection_conflict` without editing/reactivating the grant. Contact timestamps
are excluded. Existing API callers may omit it for backward compatibility; it
does not authorize anything and never replaces an owner session.

Public read-only sharing uses separate capability-checked `/public/shares/*`
routes. Link management requires the owning website session; OAuth/API keys cannot
publish content. See [sharing](sharing.md) for routes, permissions, live membership,
pagination, independent public limits and revocation.

## Directory domain verification

Set optional API-only `OPENAI_APPS_CHALLENGE` to the exact public token issued by
OpenAI. `GET /.well-known/openai-apps-challenge` returns only that plain text, with
`no-store` and `nosniff`; it returns 404 when unset. HEAD returns no body. There is
no proof-upload endpoint, redirect, database lookup, authentication grant or access
to notes. The token is a public ownership proof, not an access credential. Whitespace
and values over 512 characters are rejected rather than silently changed.

All memory tools publish human-readable titles and explicit safety annotations
for directory discovery. Names, arguments and per-call permissions remain unchanged.

## Memory and notebook tools

| Tool                               | Purpose                                            | Main fields                                                                                  |
| ---------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `remember`                         | Durable save or versioned correction               | `operationId`, `content`, `kind`, `projectId`, `source`; correction: `id`, `expectedVersion` |
| `recall`                           | Bounded active context                             | `query`, `projectId`, `includePersonal`, optional `taskId`                                   |
| `memories`                         | Inspect IDs, versions, provenance and statuses     | `query`, `projectId`, `kind`, `status`, `cursor`, `limit`                                    |
| `forget`                           | Exact-ID soft deletion; retained history is hidden | `operationId`, `items: [{id, expectedVersion}]`                                              |
| `get_memory`                       | Exact current or historical note                   | `id`, optional `revision`                                                                    |
| `memory_history`                   | Latest 100 revisions                               | `id`                                                                                         |
| `update_memory`                    | Partial edit; omitted fields preserved             | `operationId`, `id`, `expectedVersion`, changed fields                                       |
| `move_memories`                    | Atomic batch filing (up to 50)                     | `operationId`, `items`, destination `projectId` or null                                      |
| `archive_memory`, `restore_memory` | Archive or restore an exact note                   | `operationId`, `id`, `expectedVersion`; restore: optional `revision`, `durable`              |
| `notebooks`                        | Paginated directory/tree discovery                 | `status`, `query`, `parentId`, `cursor`, `limit`                                             |
| `create_notebook`                  | Retry-safe notebook creation                       | `operationId`, `name`, optional `parentId`                                                   |
| `update_notebook`                  | Partial rename/move                                | `operationId`, `id`, `expectedVersion`, `name` and/or `parentId`                             |
| `notebook_lifecycle`               | Owner-only subtree preview/archive/restore/delete  | `id`, `action`; changes also require `operationId`, `expectedVersion`, preview `fingerprint` |

All 14 tools share schemas and execution between remote MCP and the packaged stdio
bridge. `POST /v1/tools/:tool` accepts the same arguments and normal REST envelopes.
Existing REST routes and the original four tools remain compatible. Ship the matching
API before the upgraded bundled clients; an older server cannot execute new tools.

Use `update_memory` for corrections: omitted content, notebook, kind, provenance,
task ID and lifetime stay unchanged. Legacy `remember` corrections still replace
metadata, so callers must supply it. To convert a handoff, set `kind: "fact"` and
`taskId: null`; set `retentionDays: null` too if it should become permanent. Optional
`capture: "automatic"` obeys both server and packaged-host privacy controls.

Notebooks are folders, represented internally by project IDs. Follow `notebooks`
cursors to discover the full granted tree; hidden parents remain hidden. Moving
notes/notebooks checks both source and destination grants. Notebook creation requires
all-project write access or an owner session. Notebook subtree lifecycle and archived
notebook listing remain **website-owner session only**, including through the tool
endpoint; OAuth and API keys cannot use these operations. Hierarchy never inherits
permissions. `parentId: null` moves a notebook to the root.

Deletion is retained soft deletion, not physical erasure. Deleted notes/notebooks
cannot be restored through these tools; use archive when later restoration is needed.
Batch moves are all-or-nothing; `forget` retains its per-item outcome contract.

Kinds: `preference`, `fact`, `decision`, `solution`, `handoff`. Personal scope is
`projectId: null`. Project IDs are account-owned UUIDs. A handoff requires a stable
`taskId`; update its existing ID/version instead of creating duplicate handoffs.
Content is trimmed, 1–6,000 characters. `capture: "automatic"` is rejected when
automatic capture is paused; explicit user-requested saves use `"explicit"`.

`retentionDays` is nullable and independent of kind: `null` keeps the note until
removed; 1–365 selects a temporary lifetime. New handoffs default to 30 days and
other kinds to permanent. Omission on correction preserves retention and expiry.
Changing retention restarts it; restore renews it. Expired notes are hidden from
recall and retained for a 60-day restoration window before soft deletion. Hidden
source records and their revisions remain retained.

Use a new UUID operation ID per mutation and keep it across retries. Reusing an ID
with different arguments returns 409. Replaying a deleted save returns 410 and
does not resurrect content. A correction race yields one success and one conflict.
Deletion reports `deleted`, `not_found`, or `version_conflict` **per item**.

`remember` returns the actual current memory and `indexing: pending|ready|failed`.
Storage success does not claim the embedding has finished. Revisions and embedding
jobs are committed with the save. MCP failures set `isError: true`.

Recall defaults: 8 items, 6,000 total content/metadata characters (approximately
1,500 tokens), no unrelated filler. Full-text and semantic ranks are fused; semantic
distance is thresholded. Query-free recall selects a compact preference/fact/decision
profile, with a specific handoff only when `taskId` is supplied. Archived and expired
records never enter normal recall. Other projects are never searched automatically.
No server content cache can outlive deletion or revocation.

## REST routes

Owner-only notebook catalog and atomic parent/order endpoints are documented in
[notebook organization](notebook-organization.md). This foundation does not change
the legacy notebook-list or MCP contracts or yet add the Organize interface.

Responses use `{success: true, data}` or
`{success: false, error: {code, message, requestId}}`. Export is NDJSON.

| Routes                                                                 | Access                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /v1/me`                                                           | Authenticated identity/effective grant and settings                                             |
| `POST /v1/connect`                                                     | Agent starts/resumes its own connection request; API keys require existing scope                |
| `GET /v1/connect/:id`                                                  | Request's agent connection or owning website session                                            |
| `POST /v1/connect/:id/approve`                                         | Owning website session; transactional project link and grant                                    |
| `POST /v1/connect/:id/cancel`                                          | Request's agent connection or owning website session                                            |
| `GET, POST /v1/projects`; `PATCH /v1/projects/:id`                     | Approved scope; create needs all-project access or website session                              |
| `GET /v1/projects?status=archived`; `GET /v1/projects/:id/lifecycle`   | Archived listing and full-subtree preview; owner website session only                           |
| `POST /v1/projects/:id/archive`, `/restore`, `/delete`                 | Owner-only, version/snapshot-checked subtree lifecycle; deletion is soft only                   |
| `POST /v1/memories`; `PATCH /v1/memories/:id`                          | `memory:write`                                                                                  |
| `GET /v1/memories`; `POST /v1/memories/search`; `GET /v1/memories/:id` | `memory:read`                                                                                   |
| `GET /v1/memories/:id/revisions`                                       | `memory:read`, current scope                                                                    |
| `GET /v1/memories/:id/revisions/:version`                              | Exact historical revision; current scope, deletion and expiry checks                            |
| `/v1/assistance`, `/v1/notebook-visits`                                | Owning website session; [notebook assistance](notebook-assistance.md)                           |
| `POST /v1/memories/:id/archive`; `…/restore`                           | `memory:write`, operation ID and current version                                                |
| `POST /v1/memories/delete`                                             | `memory:delete`                                                                                 |
| `POST /v1/recall`                                                      | `memory:read`                                                                                   |
| `POST /v1/tools/:tool`                                                 | Same tool schemas and scoped capabilities as MCP; notebook lifecycle remains owner-only         |
| `POST /v1/ask`                                                         | Scoped `memory:read`; cited answer or source search                                             |
| `GET, POST /v1/conversations`; `GET, DELETE /v1/conversations/:id`     | Owning website session only; saved chat history                                                 |
| `POST /v1/conversations/search`                                        | Owner-only history search: `{ query?, after? }`; titles/questions, 30 results and signed cursor |
| `POST /v1/conversations/:id/turns`; `…/turns/:turnId/apply`; `…/undo`  | Owning website session only; contextual replies and previewed note changes                      |
| `POST /v1/briefs`; `POST /v1/briefs/refresh`                           | Scoped `memory:read` / `memory:write`; body `{projectId, taskId?}`                              |
| `POST /v1/memories/:id/reprocess`                                      | Scoped `memory:write`; body `{expectedVersion}`                                                 |
| `GET /v1/models`; `GET /v1/account/usage`                              | Website session; masked settings / account usage                                                |
| `PATCH /v1/models`; `POST /v1/models/test`                             | Configured self-hosted installation administrator only                                          |
| `GET, POST /v1/connections`; `PATCH, DELETE /v1/connections/:id`       | Website session only                                                                            |
| `POST /v1/keys`                                                        | Website session only; secret returned once                                                      |
| `POST /v1/logout`                                                      | Revoke calling agent's connection                                                               |
| `PATCH /v1/account/settings`; `POST /v1/account/delete`                | Website session only                                                                            |
| `/v1/exports`, `/v1/imports`, `/v1/tasks`                              | Session-owner durable work; see [jobs](jobs.md)                                                 |
| `POST /v1/webhooks/clerk`                                              | Svix signature, replay receipt and event ordering                                               |
| `GET /health/live`, `/health/ready`                                    | Public, content-free                                                                            |

Use POST search so query text stays out of URLs. Cursors are signed and bound to
account, connection, filters, and creation-time ceiling. Pagination is bounded,
not a database snapshot of concurrent edits. `Idempotency-Key` may supply the body
operation ID; conflicting identifiers are rejected. Restore can select an older
revision and creates a new revision; `durable: true` promotes a handoff to a fact.

Library filters also accept `sourceAgent`, `updatedAfter`, `lifetime`
(`permanent`/`ephemeral`), and `sort` (`updated_desc`/`updated_asc`/`created_desc`).
`POST /v1/ask` accepts `query`, optional `projectId`, `includePersonal`,
`previousQuestions` (up to four), and `mode` (`answer`/`search`). Omitted project
scope searches all authorized notebooks; null selects Personal. Replies include
sources and a structured, exactly cited answer, or an explicit no-evidence/disabled
status. Aborted requests cancel inference. No question or answer is stored as a note.

The website's **Ask** mode uses durable conversations. Create with a client UUID,
optional `projectId` and `includePersonal`. Submit turns with a client UUID, `query`
(up to 6,000 characters), `format` (`plain`/`markdown`), and `expectedVersion` from
the conversation. Retries reuse the same body/UUID; changed payloads conflict.
`GET /v1/conversations?after=<last-id>` returns 30 recent conversations per page.
The history browser uses `POST /v1/conversations/search` with optional `query`
(up to 200 characters) and `after` (opaque signed cursor). It searches titles and
user questions with literal case-insensitive matching, returning summary fields,
a bounded question `preview`, `turnCount` and `nextCursor`. Search text stays in
the body. Cursors bind account and query and retain the exact PostgreSQL timestamp,
so deleting the previous page's final row does not break pagination. Results are
most-recent-first; deleted/foreign chats and assistant payloads are excluded.
The cursor identifies an account-owned row; it contains no query text. History
pagination reflects concurrent activity rather than a frozen snapshot.

Reference resolution uses the latest eight completed turns, then retrieves current
scoped evidence. Replies cite exact revisions and can propose explicit note edits,
creation/merge, notebook organization, or archive/restore/delete. Lifecycle previews
name exact notes and count full notebook subtrees. `apply` and `undo` take `{}` and
atomically fence affected versions and subtree fingerprints. Deletion has no Undo;
merges archive other originals. See [Ask tools](ask-tools.md). Generation runs outside transactions,
with final account/session, provider/settings and source checks. A conversation is
limited to100 turns with five-minute attempt leases. Deleted conversations retain
hidden history; account deletion revokes access and soft deletes content, and account
exports include saved history. Migration 009 and restore rules are in [deploy](deploy.md).

## Persistence and jobs

Connection setup keeps one bounded JSON request on the existing RLS-protected
connection row. Requests expire after ten minutes while pending. Request IDs alone
authorize nothing; the account and OAuth/key connection are rechecked on every call.
Approval defaults and protocol details are in [Cloud onboarding](cloud-onboarding.md).
Manual grant edits and revocation invalidate outstanding requests; repeated approval
returns its existing result without reapplying permissions.

`lib/database` uses Knex/Objection/pg with explicit open/close and transaction-local
tenant context. Ownership-aware foreign keys cover projects, memories, revisions,
embeddings and jobs. Runtime startup rejects superuser, BYPASSRLS and table-owner
credentials. Migration credentials are separate. Security-definer entrypoints are
narrow, fixed-search-path functions with public execution revoked.

The worker claims jobs with `FOR UPDATE SKIP LOCKED`, a 120-second lease, revision
identity, bounded retries and terminal failure. Completion rechecks the lease,
account and current revision in one transaction. Tombstones and generation fences prevent stale
worker completion from restoring content. Embedding profiles carry checked dimensions;
Cloud uses full 4,096-dimensional Qwen vectors with scoped exact search. Self-hosted
defaults to local MiniLM and can configure each inference role. `disabled` embedding
mode is explicitly lexical. Classification and generation use revision-fenced jobs;
source-linked artifacts obey the same scope and lifecycle. See [models](models.md)
for provider settings, enrichment/brief contracts, quotas, reset and reindex operations.

Account deletion first revokes access, then hides retained application content even during
an identity-provider outage. Clerk deletion retries separately. Minimal subject and
operation tombstones prevent delayed webhook/retry reprovisioning. Backups require
the retention and deletion procedures in the deployment guide.
