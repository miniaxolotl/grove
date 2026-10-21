# Public read-only sharing

Owners can share saved notes and notebooks with anyone who has the link. Readers
see **live saved content** without signing in. Visitor permission is **Can view**.

## Owner controls and lifecycle

Open **Share note** in the note toolbar or Commands. Notebook sharing is available
in notebook options, sidebar actions and the notebook manager.

- Choose **Restricted** or **Anyone with the link**, then save the settings.
- Notebook scope defaults to **This notebook only**. **Include sub-notebooks** adds
  current and future descendants. New or moved-in saved notes become visible.
- Copy/Open reuse the same URL. Replace invalidates the previous URL immediately.
  Select Restricted and **Turn off direct link** to revoke. Re-enabling makes a new URL.
- The dialog lists covering notebook links and opens their settings. Turning off
  one direct link does not remove access through another covering notebook link.
- New notes must finish their first save. Pending saves/conflicts prevent enabling
  or replacing links; owners can still revoke during editing. Failed writes retain
  retry IDs; conflicts reload current settings. State reloads on every dialog open.

A direct note link exposes only that note and follows it when moved. Notebook
links follow current membership: moving a note/sub-notebook out removes that
link's access. Navigation never exposes outside ancestors or siblings.

Archived/expired notes are unavailable until restored. Deletion removes a direct
share. Disabled/deleting/deleted accounts expose no content; purging deletes share
records, operation receipts and per-link rate state. Backup recovery invalidates
**all** restored links, including links narrowed/revoked after the backup.
Already-read or copied content cannot be recalled from visitors.

Public responses contain saved text, content-derived title, update time and scoped
navigation IDs. They omit owner/repository identity, source/task metadata, history,
enrichment, relationships, conversations and credentials. Markdown excludes HTML
and active controls; remote images are click-to-open links. Internal note links
navigate only within this capability's scope.

## API contract

Management requires the owning **website session**; API keys and OAuth grants
cannot publish content, even with every memory capability.

| Route                                                     | Purpose / request                                                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/memories/:id/share`                              | Note's direct and covering links                                                                                                         |
| `GET /v1/projects/:id/share`                              | Notebook's direct and covering links                                                                                                     |
| `POST /v1/memories/:id/share` or `/v1/projects/:id/share` | Enable: `operationId`, `expectedVersion` (0 if no share), `expectedTargetVersion`, `includeDescendants` (default false; false for notes) |
| `PATCH /v1/shares/:id`                                    | Scope: `operationId`, `expectedVersion`, `includeDescendants`                                                                            |
| `POST /v1/shares/:id/rotate`                              | Replace: `operationId`, `expectedVersion`                                                                                                |
| `DELETE /v1/shares/:id`                                   | Revoke: `operationId`, `expectedVersion`                                                                                                 |

All return `ShareState`: availability, target eligibility/name/version, direct share
(URL only for the owner) and covering notebook IDs/names. Share versions are
independent of target versions. Non-secret receipts reauthorize and resolve the
current share on retries; stale replay cannot resurrect an older link.

Anonymous read endpoints:

- `GET /public/shares/:token`
- `GET /public/shares/:token/notes/:id`
- `GET /public/shares/:token/notebooks/:id`

Notebook reads accept `limit` (default 30, maximum 100) and signed `cursor`.
Cursors bind the token digest, share/version, route and page size. Scope changes
invalidate earlier cursors; membership remains live between pages. Missing,
revoked and out-of-scope resources share one 404 response. A 400 cursor error
requires restarting pagination; service errors return 503.

Public admission is separate from owner quotas: **1,200 requests/minute globally**
(including invalid tokens), then **240/minute per link**, coordinated in PostgreSQL
across replicas. Responses include 429 and `Retry-After: 60`. Forwarded IP headers
do not establish identity. Queries have a five-second statement deadline; scope is
bounded by the account's 100-notebook limit and cycle-safe recursion. Notes are
paginated in UUID order. Readers do not call Clerk/models, create sessions or
consume the owner's signed-in API quota.

## Storage and rollout

Apply forward migration **`20261021_011_public_sharing`** with the migration-owner
role before the matching API/worker. It adds RLS-protected shares/receipts,
same-account cascading constraints and narrow security-definer readers. Readers
project permitted content directly; they never return an owner grant. Only the
API runtime may execute them. Fixed search paths put temporary schemas last.
Account locks serialize public reads with revocation, moves and deletion.

Set **`SHARE_LINK_KEY`** on the API only: 32 random bytes encoded as 64 hexadecimal
characters (`openssl rand -hex 32`), distinct from cursor/model keys. All API
replicas must agree. Compose and initial DigitalOcean provisioning accept it;
existing image-only rollouts preserve operator settings, so add it explicitly.
Never send it to the website, worker, browser, repository or telemetry. Without
it, the rest of Grove is usable, sharing reports unavailable, and owners can revoke.

Capabilities use 256 bits of randomness, hashed for lookup. An owner-recoverable
AES-256-GCM copy is bound to account/share identity. Keep the key in the private
secret backup. Changing it does **not** revoke capabilities: replace/revoke links
separately. With a different key, recopy is unavailable but replace/revoke works.
Backup reconciliation clears encrypted copies/digests and increments versions.

Deploy API/worker after the owner migration, then the matching website. Rollback
retains the additive schema. Public routes use no-store fetches/responses, generic
preview metadata, no-index/no-follow/no-archive and no-referrer policy. They are
excluded from the sitemap. History restoration rechecks live access. Application
telemetry normalizes `/s/:token`, strips content/identifiers and blocks reader/dialog
replay. Configure edge/access logs to omit or redact capability segments in **both
`/s/*` and `/public/shares/*`**, and verify on the actual hosts during rollout.
See [deployment](deploy.md) and [testing](development/testing.md).
