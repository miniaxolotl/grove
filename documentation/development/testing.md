# Verification

Note-context verification combines the unchanged full Chromium suite and focused
navigation WebKit suite with real-component manual journeys against synthetic note,
PNG and WAV data. In each engine check right-click and Shift+F10, retained selection,
format/Undo, copy/cut/paste, denied clipboard and a delayed paste after cursor movement.
Target the second duplicate image in a CRLF note, remove/Undo, select its source and
reopen the source menu at the reference's end. Verify original-download byte identity
through a loopback upstream (native downloads bypass Playwright page routing), lazy
recording playback, mute and transcript access without overriding transcript fields.
Hold an image upload and confirm disabled menus cannot edit/remove but can still copy.
Review 1440/390/320px bounds, outside dismissal and the Shift+right-click native escape.
No personal media, new frontend coverage files or production API fixtures are involved.
See [context action guide](../note-context-actions.md) and
[captures](../design/screenshots/note-context-actions/README.md).

Review regressions also compare source/Preview URLs containing named/numeric entities,
angle destinations and escaped parentheses, and reject decoded unsafe protocols.
Hold cut/paste across a Preview round trip; hold paste across Write/Markdown, disabled
state and same-component note-identity changes. Verify ordinary action dismissal
still permits the pending paste and Undo. Paste CRLF/CR text at document end and
check the LF caret; shorten an oversized draft through cut/reference removal while
rejecting growth. Removing the only Preview attachment must focus the persistent
note surface so its keyboard Undo restores the reference. These thirteen actual-
component journeys pass in Chromium and WebKit; all five original findings were
reproduced before correction. No new frontend coverage files are added.

Ask review regressions in `conversations.test.ts` and `notebook-assistance.test.ts`
exercise the real account note limit through ordinary saves, conversation Apply,
organization batches and action-list saves. They cover whole-batch rollback,
concurrent final-slot claims, replay, edits/Undo at capacity and retained previews.
Organization follow-ups cover mixed move/create batches, note-to-ID mapping, fresh
edit versions and exclusion of undone or out-of-scope notes. Run them with the same
disposable PostgreSQL/non-owner roles as the backend suite below.

Speech adds `speech-provider.test.ts`, `speech-jobs.test.ts`, `speech-text.test.ts`,
`speech-storage.test.ts` and `speech-migration.test.ts`. They exercise bounded real
HTTP adapter responses, independent default-off preferences, non-owner source/RLS
checks, retained machine-versus-authored transcripts, retry/lease races, global
provider slots, conservative budgets, source/profile/session/restore fences,
private Range/HEAD playback, exact cache expiry and derived-only maintenance.
The populated 018→019 upgrade preserves authored notes, WAV metadata and transcript
history. Narration uses real CommonMark parsing; regression cases exclude code,
images/media and link definitions while retaining labels and escaped prose. Its
profile cutover prevents reusing audio from the prior extractor. Restore
verification also seeds completed speech and checks that results
and artifact access expire rather than being revived.

The actual-component/disposable-API browser journeys cover both opt-ins, explicit
candidate use/save/normal note insertion, generated playback, exact cache reuse,
failure/retry, cancellation and desktop/390/320px accessibility in Chromium and
touch/mobile WebKit. Both engines also verify in-app navigation during a held retry
response and cancellation via either close control after enqueue succeeds but its
response is lost. A separate small real-provider check sends only synthetic
text/audio to tts-1/whisper-1; never use personal content or expose the key in output.
[Reviewed captures and live-check scope](../design/screenshots/speech/README.md).

Custom recording playback is verified with real retained WAV bytes through a
disposable API/database and the actual website components. Chromium and touch/mobile
WebKit cover delayed source loading, play/pause, range seeking, speed, mute,
end/replay, HTTP503 retry, unmount cleanup, 1440/390/320px bounds and WCAG A/AA.
The production Next public reader is also checked in both engines with and without
JavaScript; native controls remain available without hydration. Keyboard Space,
Home/End/arrows, forced colours and reduced motion receive focused checks.
These manual journeys complement, not replace, the existing browser suite.
See [reviewed captures](../design/screenshots/recordings/README.md).

Image-storage primitives have a bounded raster/filesystem suite and two optional
owned-loopback S3 checks, including rejection of providers that ignore conditional
writes. See [media foundation verification](media-foundation.md#verification).
This does not yet qualify image upload/rendering or revision authorization.

Workspace navigation uses the existing full Chromium suite and focused WebKit
checks for sidebar bounds, mode/outline geometry, first autosave, held-save retry,
command availability, nested shortcut scope and note-search recovery. Frontend
coverage files are unchanged. Navigation-specific real-component verification also
checks this manual matrix in each engine against synthetic fixture API data:

- A query found only late in a note produces a highlighted passage in global search,
  Ask/Search and filtered rows; a semantic-only result has no fabricated highlight.
- Expand notebooks, scroll the list, reload with delayed directory/nested-page reads;
  verify restoration yields to user input. Switch accounts/sessions and confirm UI
  metadata ownership, no stored names/content/queries, and safe blocked/malformed
  storage. Removed notebook IDs must not survive a successful directory refresh.
- Open an authenticated note with a duplicate-heading fragment, reload, change the
  same-note hash and use Back/Forward. Try missing/malformed fragments and new notes.
  Source navigation must not save; an intentional edit at the target must Undo
  through normal history. Check ATX/Setext, formatting, nesting, CRLF and fenced code.
  Include a shared `# Title` followed by duplicate `## Title` sections: the header
  retains `section-title`, and subsections keep `section-title-2` / `section-title-3`.
- Open Commands → Jump to heading and `Ctrl`/`Cmd` + `Alt` + `O` from writing/reading.
  Search, Enter, Escape/focus return and clipboard success/manual fallback must work.
- Pin/unpin, scroll/current-section tracking, focus mode and resizing at
  1440/768/390/320px must retain the document instance, fit controls and keep narrow
  screens on the inspector. Review reduced motion, enlarged text and forced colours.
  In writing mode, type under a later visible heading while the top visible block
  belongs to an earlier one; edits must retain the caret's section. Search a late
  `İstanbul` and `DATABASE_URL` occurrence and verify passage selection/highlights.

Run production builds **before**, not during, browser suites: rebuilding removes
old CSS chunks used by the fixture servers. Use separate ports/output directories
for concurrent engines. [Navigation captures](../design/screenshots/workspace-navigation/README.md)
record exact verification and the scope of these manual journeys. Existing compact-
note scenarios use the shared New note shortcut and action helper rather than
hidden sidebar/desktop controls; leaving focus mode retains Back to notes while
the compact full-page note keeps its sidebar hidden.
Conversation-composer scenarios wait for the history dialog's dismissal and focus
handoff before typing; filling the background textbox during a held history open
can otherwise race the loaded conversation's draft replacement.

The committed focused configuration includes the existing history-focus scenarios
as well as note tools, saves, sidebar, commands and search:

```sh
pnpm --filter website exec playwright test --config playwright.navigation-webkit.config.ts
```

Use the supported Playwright container below when local WebKit libraries are absent.

Ask Grove tools add deterministic hosted-MCP protocol fixtures in `research.test.ts`,
a populated 016→020 upgrade, conversation settings/cancellation/budget and atomic
organization regressions, and export/recovery checks. Paid provider calls are kept
out of normal CI; bounded synthetic search/extract runs qualify actual Exa/Tavily
schemas separately. Browser verification covers the composer menu, remembered
choices/defaults, citations, activity, organization previews and Apply/Undo at
1440/768/390/320px. Capture a small PR preview row (at most four images), with the
complete gallery under `documentation/design/screenshots/ask-tools/`.

Conversation history coverage (`conversation-history.test.ts`) uses real non-owner
PostgreSQL access for title/older-question search, literal wildcard handling,
bounded previews, owner-only/tenant isolation, retained-but-hidden deletion and
account/query-bound microsecond cursors that survive deletion of the cursor row.
No model or migration is needed. Browser history scenarios exercise date groups,
search/empty states, current markers, reading from the beginning, Latest reply,
draft switching, cancelled opens, page/open error recovery and named deletion.
Cache coverage checks that POST search stays read-only and deletion prunes inactive
history pages. Review 1440/390/320px captures in both browser engines.

Notebook lifecycle tests (`notebook-lifecycle.test.ts` and
`notebook-lifecycle-migration.test.ts`) require the same disposable owner/API/worker
URLs below. They verify populated 015→016 preservation, atomic whole-subtree
archive/restore/soft-delete, retained history and recovery, independent archives,
unchanged expiry, owner-only administration, cross-tenant denial, stale scope,
retry identities, public sharing and inactive-note/notebook write guards. The
existing 014→015 test stays pinned to its migration boundary.

Browser `workspace.spec.ts` exercises notebook page/sidebar/manager entry points,
scope counts, Cancel, Archived navigation, Restore/Delete, conflict re-review,
committed-but-lost responses and retained draft blocking. `cache.spec.ts` checks
immediate source pruning and held-response fencing across descendant scopes. Run
the `notebook lifecycle|notebook deletion|notebook archive` subset in Chromium and
`playwright.webkit.config.ts`; captures cover 1440/390/320px. Check the active
manager behind dialogs too: touch-sized action rows must wrap rather than overflow.

Workspace refinement adds timer-paused viewer-checkbox saves, a held first save
that preserves the editor node, viewport and undo/redo, and fresh creation after
the saved route is adopted. The real shared `(notes)` layout owns the document;
the browser fixture mirrors that persistent layout. Search checks cover pending
request clearing, empty results, retry, control alignment and accessible layouts
at 1440/390/320px. Sidebar note-drag checks verify a readable preview, source-row
feedback and version-fenced Undo. Focus/outline navigation includes CRLF and
formatted/setext headings. These cases extend the existing save-race, history,
gesture and viewport regressions; the focused WebKit configuration includes the
new editor/search cases and lost-response/return-to-draft paths.

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

When changing public-reader presentation, also inspect the rendered head on direct
notes, notebooks, nested notes/notebooks, unavailable links and service failures.
Titles/descriptions must stay generic across HTML/Open Graph/Twitter, with no
content, capability URL or inherited marketing image. Verify the referrer meta tag
alongside privacy response headers. Review the brief recovery copy, retry and
keyboard focus at 1440/390/320px, with no JavaScript and enlarged text. Screenshots:
[shared readers](../design/screenshots/shared-readers/README.md).
The current Next nested not-found/error fallback is client-rendered: no-JavaScript
verification covers active readers/navigation, not unavailable-state UI. Inspect
404 status, generic metadata and privacy headers independently of hydration.

Use Node 24 and pnpm 10.33. All database tests require an explicitly named disposable
database ending in `_test`. No test drops a configured application database.

Backend load tooling and deterministic admission/query-budget checks are documented
in [backend capacity](backend-capacity.md). Timing runs use their own uniquely named
disposable databases and should run separately from the correctness/browser suites.

AI preferences coverage includes a populated 012→013 upgrade with all four legacy
organization/summary combinations, separate summary scopes and connections, partial
HTTP writes, owner-only permissions, reindex/restore preservation and disabling then
re-enabling features during inference. Browser cases exercise the five categories,
the original ten controls (four assistance controls were added in 015), provider availability, failed/overlapping saves, keyboard operation,
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

To check OpenCode's actual plugin loader and MCP startup, run the packed-host smoke
test with an absolute executable path:

```sh
OPENCODE_TEST_BIN=/absolute/path/to/opencode node scripts/testing/opencode-host.mjs
```

It installs only a temporary consumer under `/tmp/opencode`, uses isolated HOME/XDG
directories and starts the host with an empty executable PATH. The plugin, memory
skill and MCP connection must load without a separate Node installation on that PATH.
The test runner itself still requires Node, pnpm and npm. It does not restart the
user's service or change live configuration.

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
creation. Mobile shares the heading row between brand, New note and search, and
keeps Commands in the note-actions menu. Full-page notes must fill the viewport
at 320/390/768px and in short windows after hiding the sidebar; verify this against
production CSS, whose grouped selectors can change cascade specificity.
Touch dispatches for the destination tray
move in finger-like steps so autoscroll keeps receiving pointer deltas. Filter
checks treat the popover as self-positioning: sorting may reorder rows and drop
date headings, while the trigger keeps its geometry. Row dropdowns must leave list
rectangles unchanged, dismiss independently, restore focus after export/move dialogs
and preserve swipe cancellation. Browser
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
