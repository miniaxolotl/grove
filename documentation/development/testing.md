# Verification

Notebook assistance adds a populated 014→015 upgrade, exact historical-source reads,
resumable summary/reuse and on-demand preview/Apply/Undo regressions. See
[notebook assistance](../notebook-assistance.md#verification) for the bounded scale
and synthetic live-provider runners. The shared AI preferences now have 14 controls;
Chromium and focused WebKit cover assistance dialogs at 1440/390/320px.

Queue coverage (`queue.test.ts`, `queue-migration.test.ts`) uses fresh PostgreSQL
databases and non-owner roles for claims, tenant/provider limits, lease fences,
dispatch reservations, retained history, checkpointed imports/backfills, and
bounded exports. The populated 013→014 test verifies unchanged authored records.
Set `TEST_AMQP_URL` for `broker.test.ts`; CI supplies an isolated RabbitMQ service.
It checks lane isolation, shared fallback capacity, draining and reconnect.
`worker.test.ts` starts two real worker processes against a fresh database and an
unreachable broker, verifies import/export completion, then checks SIGTERM draining.
`artifacts.test.ts` always tests private atomic local files; optional S3 checks use
`TEST_STORAGE_ENDPOINT`, `TEST_STORAGE_BUCKET`, `TEST_STORAGE_KEY` and
`TEST_STORAGE_SECRET` against an owned private Garage bucket (region `garage`).
These verify 12 MiB multipart streaming, byte identity, anonymous denial and deletion.
Browser `exports.spec.ts` covers retry identity, notebook scope, cancel/retry,
actual downloads and accessible 1440/390/320px layouts. It is included in the
focused WebKit configuration. Cloud provisioning is separate from local tests.

Public sharing coverage uses real non-owner database roles for capability scope,
concurrent revocation, archive/moves/expiry, account purging, token encryption,
temporary-schema shadowing, separate public quotas and backup invalidation.
`tests/src/sharing.test.ts` requires all three disposable database URLs below.
Timed-link checks cover all six durations, exact expiry, retry/rotation deadlines,
stale settings, expired inheritance/navigation/pagination and renewal with a new
secret. `share-expiration-migration.test.ts` upgrades a populated 011 database to
012 and verifies preserved capabilities and non-owner isolation. Run focused
iPhone/WebKit checks with `playwright.sharing-webkit.config.ts`; its server setup
retains both the synthetic public upstream and the production Next server.

Website orchestration starts a synthetic sharing upstream on port 4378
(`SHARING_TEST_PORT` overrides it) alongside the real production-built Next server.
`sharing.spec.ts` verifies signed-out reads, scoped links, live edits, revoked-link
reload/history, metadata/headers and safe Markdown. Workspace tests cover owner
scope controls, retry/conflict handling, inherited access and revocation during
pending saves. Telemetry tests inspect actual SDK payloads for capability/content
canaries and disabled replay. Synthetic fixture routes exist only in the test
upstream, never in the application. Rebuild the website before browser checks.

Use Node 24 and pnpm 10.33. All database tests require an explicitly named disposable
database ending in `_test`. No test drops a configured application database.

AI preferences coverage includes a populated 012→013 upgrade with all four legacy
organization/summary combinations, separate summary scopes and connections, partial
HTTP writes, owner-only permissions, reindex/restore preservation and disabling then
re-enabling features during inference. Browser cases exercise the five categories,
ten controls, provider availability, failed/overlapping saves, keyboard operation,
cross-tab summary invalidation and 1440/390/320px accessibility. Settings cases also
cover draft retention across tabs, discard, clean-form server updates, session
replacement and provider credential save/retry. The focused WebKit configuration
includes categorized preferences, held saves and provider configuration.

```sh
pnpm install --frozen-lockfile
docker run -d --name grove-memory-test -p 127.0.0.1:26432:5432 \
  -e POSTGRES_DB=grove_test -e POSTGRES_PASSWORD=grove_disposable_test pgvector/pgvector:0.8.2-pg17
export TEST_MIGRATION_DATABASE_URL=postgresql://postgres:grove_disposable_test@127.0.0.1:26432/grove_test
export TEST_DATABASE_URL=postgresql://grove_api:grove_disposable_api@127.0.0.1:26432/grove_test
export TEST_WORKER_DATABASE_URL=postgresql://grove_jobs:grove_disposable_worker@127.0.0.1:26432/grove_test
pnpm test:db:setup
pnpm check-types
pnpm lint
pnpm build
pnpm test
node --test tests/digitalocean.test.mjs
pnpm test:artifacts
pnpm lint:website
pnpm check-types:website
VERCEL_ENV=production NEXT_PUBLIC_POSTHOG_ENABLED=true \
  NEXT_PUBLIC_POSTHOG_KEY=phc_playwright_only NEXT_PUBLIC_SENTRY_ENABLED=true \
  NEXT_PUBLIC_SENTRY_DSN=https://00000000000000000000000000000000@o0.ingest.us.sentry.io/1 \
  pnpm build:website
pnpm --filter website exec playwright install chromium
pnpm test:website
docker build -t grove-memory:test .
```

The recovery test creates two uniquely named disposable `_test` databases using
the test migration role, then removes them. That role needs `CREATEDB`. It verifies
post-snapshot deletions/revocations, restored credential invalidation and RLS.
Conversation recovery also replays deleted-chat tombstones and invalidates
restored in-flight replies, note-change previews and undo records.
The DigitalOcean tests verify runtime-secret isolation and image-only rollouts;
`--propose` additionally validates a real spec with the provider without deploying.

The contract suite uses real pgvector, migrations, **non-owner API/worker roles**,
real HTTP requests and the official MCP transport. It covers cross-account access,
scoped keys/OAuth grants, signed JWT validation, replay/version conflicts,
archive/restore/deletion, worker races, handoff retention and account tombstones.
Conversation cases cover contextual references, tenant/session-only history,
version-fenced atomic merge/apply/undo, retry identities, cancellation and
authorization/settings changes during inference, pagination and export.
The actual HTTP generation adapter also exercises no-action greetings, malformed
actions/targets, retry/replay, and create-preview normalization before applying.
Identity fixtures do not replace required live Clerk sign-in/OAuth tests.

Artifact tests pack all distributables and execute them in isolated directories,
with no workspace source, lifecycle build or database. They initialize stdio MCP,
invoke tools through an authenticated HTTP fixture, check truthful status and
preserve unrelated configuration on repeated setup/uninstall. Native-host smoke
tests supplement these, as recorded in [delivery evidence](../delivery.md).

Website browser tests cover public routes, accessibility, keyboard navigation,
installation copy and metadata. Dashboard fixture tests use the real components
with a test-only HTTP fixture, separate from production routes. Live account tests
must verify sign-up → save → dashboard → MCP → second-account denial and logout.
Workspace cases exercise autosave with newer typing and uncertain first responses,
keyboard notebook nesting, global search, outside dismissal, durable conversation
reopening and edit previews, and the auto-growing plain/Markdown composer.
Daily writing uses the same editor/library, with date grouping and scoped creation;
mobile notebook browsing keeps nested organization accessible. The browser build
above uses synthetic telemetry identifiers: Playwright intercepts their traffic
and verifies the real SDKs without sending events to production projects.

Unified-workspace checks also cover persistent edit/preview history and scroll,
drawer bounds, note-list/drawer keyboard navigation, confirmed deletion, command
menu and shortcut-help focus, clipboard toast geometry, and settings header/tab
persistence. Geometry tests scroll off-screen controls into view before comparing
positions, so browser actionability scrolling is not mistaken for layout reflow.
Held-save cases also verify command availability, preview mode and modal return
focus when a new note's first save changes the route while a menu remains open.

Palette and editor checks compare visible bounds at 1440/768/390/320px, including
Chromium's reserved scrollbar gutter. Mode changes and properties/outline overlays
must preserve the document viewport; focus/expanded return restores reading position.
Viewer task checks cover exact nested/repeated/quoted/ordered Markdown items, CRLF
source positions, fenced examples, touch/keyboard, undo/redo and reload. Held saves,
failure/retry and version conflicts use the regular fixture API; history and comparison
renderers must remain read-only. The mobile subset also runs in the focused WebKit set.

Sidebar checks cover 320–1440px, long notebook names, expanded trees, short heights,
enlarged labels, inset keyboard focus, sticky explorer controls and notebook-scoped
creation. Row dropdowns must leave list rectangles unchanged, dismiss independently,
restore focus after export/move dialogs and preserve swipe cancellation. Browser
checks switch overlapping row menus by keyboard and test touch light-dismiss separately.

Client-cache checks cover shared misses/cancellation, account and session teardown,
fresh revisits, held reads and saves, draft/version conflicts, cross-tab metadata,
expiry and bounded retention. See [cache ownership](client-cache.md) and
[production performance measurements](../../scripts/performance/README.md) for the
real Next/Clerk runner, deferred-chunk retry and CI bundle budget.
Held initial reads also check that loading never shows a false zero count; interrupted
background reads preserve row geometry, selection and keyboard retry focus. The
production runner checks stable drawer bounds across pending, failed and ready views
at desktop and narrow mobile widths.
Canonical connection checks also cover collapsed-panel idleness, batched title-page
reuse, normalized graph keys, family-only review invalidation and deletion fencing
of a held evidence read. Row-delete replay must retain conflict review across reopen.

Relationship checks use non-owner API/worker roles for pair uniqueness, symmetric
reads, review replay, scoped grants, stale publication, budgets/retries, notebook
batch resumption, uncited-source invalidation and deletion scrubbing. Recovery
replays authoritative review state while invalidating explanations. Browser checks
cover shared graph/context inspectors, exact excerpts, comparison focus return,
dismissal/Undo and partial notebook coverage at 320px. The bounded synthetic
live-provider runner is documented in [relationships](../relationships.md#quality-evaluation).

Run the focused iPhone/WebKit checks after the website production build:

```sh
pnpm --filter website exec playwright test --config playwright.relationships-webkit.config.ts
```

On Linux hosts missing WebKit system libraries, run the same committed config in
the Playwright image (from the worktree root):

```sh
docker run --rm --ipc=host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:$PWD" -w "$PWD/packages/website" \
  mcr.microsoft.com/playwright:v1.64.1-noble \
  node node_modules/@playwright/test/cli.js test --config playwright.relationships-webkit.config.ts
```

Gesture checks use trusted Chromium touch/pen events alongside mouse and keyboard:
one-row swipe ownership, second-contact cancellation, handle activation, destination
autoscroll, delayed notebook expansion, route interruption, pinch and modifier-wheel
zoom, and selection/read/edit viewport retention. Menu bounds are checked at narrow,
short and 2× pinch-zoom viewports. Mobile formatting retains selected text; held
chat replies preserve older reading positions. Move Undo stays actionable alongside
copy feedback in the active dialog's shared notification stack.
Graph guidance is checked with keyboard/touch disclosure and expanded focus
wrapping; opening and closing it retains the graph's focal point. The touch move
case covers the integrated destination/cancel panel and edge autoscroll.
Expanded graph checks also open connection evidence from a focused edge, restore
that edge on dismissal and include the connection-list disclosure in focus wrapping.

After building production CSS, run the focused iPhone/WebKit set with:

```sh
pnpm --filter website exec playwright install webkit
pnpm test:website --config playwright.webkit.config.ts
```

WebKit requires its system libraries; verification can also run in
`mcr.microsoft.com/playwright:v1.64.1-noble` with Node 24 and the worktree mounted.
`DASHBOARD_TEST_PORT` selects an isolated fixture port for concurrent work. The
fixture serves production CSS and bundles current components, so rebuild the site
after CSS changes. Browser emulation does not qualify physical software keyboards,
OS text-selection handles, back-edge gestures or trackpad/pen feel.

Note-action checks cover direct toolbar/row deletion, Cancel focus, stale versions,
dirty/oversized drafts, held saves and same-identity retries after a lost response.
Export checks inspect actual UTF-8 downloads and clipboard results, first-save
snapshot retention, row freshness, denied clipboard fallback, deferred PDF failure
and cancellation. PDFs are parsed with pdfjs: searchable text, links, every table
cell, page counts and text bounds are checked. Visual review uses the generated
multi-page PDF plus desktop/390px/320px captures. The iPhone/WebKit set includes
download and focus checks; physical iOS/Android file delivery remains a separate
device qualification.
Download assertions save a local test artifact with Playwright `saveAs`, so they
also work when the browser runs in a remote Playwright container.

PDF refinement checks inspect the actual embedded JetBrains Mono face and section
bookmarks, single-page folio omission, landscape table/prose transitions and heading
placement. Local code-font loading is deferred until export; a failed font request
keeps Markdown available and a fresh attempt retries successfully. Ordinary table
cells must remain complete/searchable across page boundaries. Reviewed ordinary-note
and stress-case renders live with the note-actions captures.

For a disposable Clerk development account, complete `grove login --client cli`
and approve a grant in Connections. Save a personal memory containing `concise`.
With an isolated `GROVE_CONFIG_HOME`, the API environment and Clerk development
keys loaded, run `GROVE_LIVE_TEST=1 pnpm exec tsx scripts/testing/live-connection.ts`.
This exercises real refresh rotation, exact audience rejection, account-admin
denial, HTTP/stdio MCP recall and private-context suppression. It changes the
test credential's expiry to force refresh. Never point it at a customer account.
Add `GROVE_LIVE_REVOKE=1` to finish by revoking the Grove connection and Clerk
access/refresh tokens and removing the local credential. Sign in and explicitly
reapprove the connection before repeating that check.
