# Delivery evidence

Verified during 18–19 October 2026 on `feat/memory-consolidation`, based on
`development` at `b8c1b3d`. This is a breaking replacement of the legacy service.

## Delivered

- PostgreSQL-only storage with pgvector, full-text retrieval, explicit migrations,
  non-owner API/worker roles, transaction-local tenant context and ownership RLS.
- Authenticated REST and official-SDK HTTP/stdio MCP: `remember`, `recall`,
  `memories`, `forget`. Durable saves, revisions, retry IDs, optimistic versions,
  scoped retrieval, reversible archive, permanent deletion and bounded handoffs.
- Clerk signup/signin and a private dashboard: Memories, Projects, Archive,
  Connections and Settings. Scoped connection grants, one-time API keys, export
  and asynchronous account deletion.
- Prebuilt CLI and OpenCode V2, Claude Code and Codex packages. Shared credentials
  are partitioned by API origin, agent and account, written atomically with private
  permissions and serialized refresh. Optional context has a 1.5-second deadline
  and 6,000-character ceiling; hooks do not upload transcripts or tool logs.
- Separate API/worker image, private PostgreSQL Compose, Railway service configs,
  release wiring and source-read-only, ownership-mapped legacy import. Imports
  enter the archive atomically and repeated runs do not duplicate them.

## Verification

| Check                                           | Result                                                                                                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root typecheck, lint and prebuilt package build | Passed on Node 24.21.0 / pnpm 10.33.0                                                                                                                                             |
| PostgreSQL/auth/client/import suite             | 17 passed, real PostgreSQL 17 / pgvector 0.8.2 and separate runtime roles                                                                                                         |
| Packed artifact suite                           | 3 passed: executable completeness, real stdio MCP, authenticated saves/provenance, private automatic-save denial, repeatable setup, targeted uninstall and credential permissions |
| Website typecheck, lint and production build    | Passed, Next.js 16.4.2                                                                                                                                                            |
| Browser suite                                   | 11 passed: public pages plus isolated dashboard lifecycle, error handling, keyboard/mobile and accessibility checks                                                               |
| OpenCode 2.0.28 / 2.0.32                        | Installed tarball loads from its root entrypoint; plugin active, memory skill registered, MCP connected                                                                           |
| Claude Code 2.1.303 / Codex 0.163.0             | Isolated native marketplace install, inventory and removal of packed plugins passed                                                                                               |
| Docker                                          | Node 24 Debian image built; non-owner runtime reports ready with local semantic inference enabled                                                                                 |
| Embeddings                                      | Local `Xenova/all-MiniLM-L6-v2`, 384 mean-pooled normalized dimensions; no external embedding service                                                                             |

The database suite covers pooled tenant isolation, account/project grant denial,
revocation/reapproval, signed JWT rejection, webhook ordering, ban/deletion
tombstones, mutation races/replay, leased-worker fencing, archive/expiry and
provider-outage deletion. Client checks cover refresh/logout serialization,
account-switch invalidation, private-mode suppression and the recall deadline.

The first CI run caught missing PostgreSQL parameter casts on the fresh role-
creation path. Both bootstrap scripts were corrected and the full database suite
passed again on a newly initialized database. The rebuilt production image also
applied migrations and created roles against a second empty database, then passed
an idempotent repeat bootstrap. Website and image CI passed on the initial run.
The final website also verifies signed-out redirects for every
dashboard section and a 401 from the BFF, using resource-level auth checks rather
than Clerk's deprecated route-matcher gate.

### Live Clerk development checks

Used Grove's dedicated development instance and disposable `+clerk_test` accounts:

1. Browser signup with email verification and password signin succeeded. A website
   save appeared in the memory library; a second signed-in account received 404
   for that memory and an empty personal library.
2. Public-client DCR, authorization code with PKCE S256 and loopback callback
   succeeded. The pending connection had **zero memory capabilities** until
   approval in Grove Connections.
3. Refresh rotated the access token. Both HTTP MCP and the packed stdio bridge
   recalled the same saved ID through shared credentials. A wrong resource
   audience and agent attempts to create credentials were rejected.
4. Archive removed the saved memory from recall; restore created a new revision.
5. Grove logout denied subsequent access. Clerk access/refresh revocation and
   local credential removal succeeded.
6. Account deletion immediately denied access, then maintenance purged its
   application content and deleted the test identity from Clerk.

Provider findings incorporated into the implementation:

- Clerk accepts `openid offline_access`, not custom `memory:*` OAuth scopes.
  Memory capabilities and personal/project access are authorized by Grove grants.
- Enable resource audiences and require the exact `API_ORIGIN/mcp`. Opaque token
  verification is online so provider revocation is observable on the next request.
- Clerk's opaque-token response omits `type` despite its SDK declaration. Grove
  verifies through the OAuth-only endpoint and checks user subject, client,
  audience, scopes, expiry/revocation and issuance time.

Commands and opt-in live verification are in [testing](development/testing.md).
Local logs, temporary accounts, screenshots and credentials are excluded from Git
and package/image contents. Browser tests use fixtures for repeatable CI; the live
checks above were also exercised against Clerk and the local PostgreSQL-backed API.

## Release and production activation

Feature [PR #5](https://github.com/miniaxolotl/grove/pull/5) merged into
`development` at `6664f51`. Release
[PR #4](https://github.com/miniaxolotl/grove/pull/4) prepares CLI and OpenCode
**0.5.0** and the first server, Claude and Codex releases at **1.0.0**, including
matching native manifests and marketplace pins. Publication runs from `production`
after release checks. Publication evidence is recorded on the release PR and in
the canonical execution status. See [release sequencing](deploy.md#releases).

Production remains a separate activation step:

- No Grove Railway project was available in the connected workspace; only FITR
  projects were listed. Grove's production database, domains, TLS, secrets,
  volume/backup settings and Vercel environment still need configuration.
- Repeat the live identity/client checks against production origins and register
  real signed Clerk webhook delivery. Signed webhook behavior was tested locally;
  live external webhook delivery was not exercised against this loopback API.
- Complete a provider backup/restore exercise and deletion/revocation-tombstone
  reconciliation before exposing a restored database. Automated backup replay is
  not implemented by this branch.
- Host inventories and packaged transports were verified on Linux at the versions
  above. Native remote-MCP OAuth credential sharing is not assumed; the supplied
  hooks and stdio bridge use Grove's shared credential store.

Installation: [agent guide](client.md). Migration: [legacy import](migration.md).
Deployment and recovery: [runbook](deploy.md).
