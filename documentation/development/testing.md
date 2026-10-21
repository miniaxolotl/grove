# Verification

Use Node 24 and pnpm 10.33. All database tests require an explicitly named disposable
database ending in `_test`. No test drops a configured application database.

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
