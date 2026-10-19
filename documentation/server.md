# Memory tools and API

The Node 24 Hono service exposes `/v1` REST and stateless Streamable HTTP `/mcp`.
Both call the same transactional memory service and Zod contracts. The published
CLI is an API-only stdio bridge; it has no database credentials or local database.

## Authentication

Every data endpoint requires `Authorization: Bearer …`:

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
not a fabricated connected state. Live Clerk development OAuth passed; production
configuration remains a deployment gate. See [delivery evidence](delivery.md).

## Four everyday tools

| Tool       | Purpose                                        | Main fields                                                                                  |
| ---------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `remember` | Durable save or versioned correction           | `operationId`, `content`, `kind`, `projectId`, `source`; correction: `id`, `expectedVersion` |
| `recall`   | Bounded active context                         | `query`, `projectId`, `includePersonal`, optional `taskId`                                   |
| `memories` | Inspect IDs, versions, provenance and statuses | `query`, `projectId`, `kind`, `status`, `cursor`, `limit`                                    |
| `forget`   | Permanent exact-ID deletion                    | `operationId`, `items: [{id, expectedVersion}]`                                              |

Kinds: `preference`, `fact`, `decision`, `solution`, `handoff`. Personal scope is
`projectId: null`. Project IDs are account-owned UUIDs. A handoff requires a stable
`taskId`; update its existing ID/version instead of creating duplicate handoffs.
Content is trimmed, 1–6,000 characters. `capture: "automatic"` is rejected when
automatic capture is paused; explicit user-requested saves use `"explicit"`.

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

Responses use `{success: true, data}` or
`{success: false, error: {code, message, requestId}}`. Export is NDJSON.

| Routes                                                                            | Access                                                                           |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /v1/me`                                                                      | Authenticated identity/effective grant and settings                              |
| `POST /v1/connect`                                                                | Agent starts/resumes its own connection request; API keys require existing scope |
| `GET /v1/connect/:id`                                                             | Request's agent connection or owning website session                             |
| `POST /v1/connect/:id/approve`                                                    | Owning website session; transactional project link and grant                     |
| `POST /v1/connect/:id/cancel`                                                     | Request's agent connection or owning website session                             |
| `GET, POST /v1/projects`; `PATCH /v1/projects/:id`                                | Approved scope; create needs all-project access or website session               |
| `POST /v1/memories`; `PATCH /v1/memories/:id`                                     | `memory:write`                                                                   |
| `GET /v1/memories`; `POST /v1/memories/search`; `GET /v1/memories/:id`            | `memory:read`                                                                    |
| `GET /v1/memories/:id/revisions`                                                  | `memory:read`, current scope                                                     |
| `POST /v1/memories/:id/archive`; `…/restore`                                      | `memory:write`, operation ID and current version                                 |
| `POST /v1/memories/delete`                                                        | `memory:delete`                                                                  |
| `POST /v1/recall`                                                                 | `memory:read`                                                                    |
| `POST /v1/briefs`; `POST /v1/briefs/refresh`                                      | Scoped `memory:read` / `memory:write`; body `{projectId, taskId?}`               |
| `POST /v1/memories/:id/reprocess`                                                 | Scoped `memory:write`; body `{expectedVersion}`                                  |
| `GET /v1/models`; `GET /v1/account/usage`                                         | Website session; masked settings / account usage                                 |
| `PATCH /v1/models`; `POST /v1/models/test`                                        | Configured self-hosted installation administrator only                           |
| `GET, POST /v1/connections`; `PATCH, DELETE /v1/connections/:id`                  | Website session only                                                             |
| `POST /v1/keys`                                                                   | Website session only; secret returned once                                       |
| `POST /v1/logout`                                                                 | Revoke calling agent's connection                                                |
| `PATCH /v1/account/settings`; `GET /v1/account/export`; `POST /v1/account/delete` | Website session only                                                             |
| `POST /v1/webhooks/clerk`                                                         | Svix signature, replay receipt and event ordering                                |
| `GET /health/live`, `/health/ready`                                               | Public, content-free                                                             |

Use POST search so query text stays out of URLs. Cursors are signed and bound to
account, connection, filters, and creation-time ceiling. Pagination is bounded,
not a database snapshot of concurrent edits. `Idempotency-Key` may supply the body
operation ID; conflicting identifiers are rejected. Restore can select an older
revision and creates a new revision; `durable: true` promotes a handoff to a fact.

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
account and current revision in one transaction. Deletion cascades prevent stale
worker completion from restoring content. Embedding profiles carry checked dimensions;
Cloud uses full 4,096-dimensional Qwen vectors with scoped exact search. Self-hosted
defaults to local MiniLM and can configure each inference role. `disabled` embedding
mode is explicitly lexical. Classification and generation use revision-fenced jobs;
source-linked artifacts obey the same scope and lifecycle. See [models](models.md)
for provider settings, enrichment/brief contracts, quotas, reset and reindex operations.

Account deletion first revokes access, then purges application content even during
an identity-provider outage. Clerk deletion retries separately. Minimal subject and
operation tombstones prevent delayed webhook/retry reprovisioning. Backups require
the retention and deletion procedures in the deployment guide.
