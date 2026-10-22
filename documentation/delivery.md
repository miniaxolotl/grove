# Delivery evidence

## Minimal website refresh (22 October 2026)

The public site uses open notebook-led sections, shorter copy, compact family
controls and responsive demo transitions. Cookie Settings now remains readable
on hover, press and keyboard focus. The workspace retains its independent styles.
See the [screenshots and verification](design/screenshots/website-minimal-refresh/README.md).

## Timed public links (22 October 2026 UTC)

Owners can set link expiry to one hour, four hours, one day, one week, two weeks
or one month (30 days). Existing links retain no expiry. PostgreSQL computes and
enforces deadlines on every public read, including notebook navigation/pagination.
Expiry edits keep the URL; retries, scope edits and replacement preserve the saved
deadline. Renewing an expired link generates a new secret. The dialog shows the
expiry time, disables copying at expiry and preserves staged/cancelled edits.

The complete **92 database/service** suite and a separate populated **011→012
upgrade** case pass. After the final database-clock mutation fence, all **17 focused
sharing/upgrade** cases pass again. Root/website lint, types and builds, five packed
artifacts, bundle budgets, 17 release/deployment contracts and pinned workflow lint
pass. All **162 Chromium** scenarios pass, including auth isolation, no-JavaScript
reading, six duration options, retry deadlines, cancellation, expiry and responsive
accessibility. Creating a link now scrolls the restored action into view when its
new URL/tools make the dialog taller.
The final dependency-free build also passes **12 focused Chromium** and **seven
iPhone/WebKit** cases. Notes entry is **479,757 gzip bytes**, 474 bytes above the
authentication-isolation baseline and within the existing bundle budget.

[Reviewed screenshots](design/screenshots/timed-sharing/README.md) show the owner
dialog at desktop/390px/320px. The duration catalog has a dependency-free client
entrypoint so adding its six options does not pull server validation schemas into
the workspace bundle. Migration `20261022_012_share_expiration` is forward-only;
production activation follows the coordinated rollout in [deploy](deploy.md).

## Public-reader authentication isolation (22 October 2026 UTC)

Live rollout verification found that the root authentication provider loaded Clerk
on anonymous shared readers. The provider now belongs to account/workspace layouts.
A configured synthetic-key regression first reproduced the issue, then passed with
the fix: sign-in loads the provider, while successful/missing/failed shared readers
and marketing pages make no authentication-provider requests. Existing secret-path
links and server-rendered, no-JavaScript reading are preserved.

Root/website lint, types and builds, all five artifact checks, bundle budgets and
all 160 Chromium scenarios pass. This records local verification; production
acceptance requires the coordinated follow-up release. A separate hosting canary
was visible in Vercel request-path logs: hosting capability redaction is **not**
verified and must not be inferred from application telemetry filtering.

## Error-page refinement (22 October 2026 UTC)

Deferred views and service failures share a restrained recovery layout with
context-specific headings, a clear retry action and responsive spacing. The 404
and global-error pages use the same visual language and offer a route back to Grove.
Global recovery carries its own styles/fonts and native home links so it remains
usable outside the root layout. Error details stay out of that fallback's content.

After integrating landed stable-library and sharing features, root/website lint,
types and builds, five artifacts, **149 Chromium** and **35 supported focused
iPhone/WebKit** cases pass. Release/deployment contracts and workflow lint pass.
Production deferred retry/bounds/focus and
sign-in/private-response checks pass at 1440/390/320px. Additional checks cover
service/404 accessibility, 404 navigation without JavaScript, standalone global
recovery in both browser engines, keyboard navigation and enlarged text.
Notes entry is **469,016 gzip bytes (-31.5% original baseline)** with all landed
features included. The error-UI-only increase was 200 bytes before those integrations.
Preference drafts retain their loaded base across background refreshes and newer
edits across pending saves. [Reviewed error screenshots](design/screenshots/error-recovery/README.md)
record the final desktop/mobile presentation, exact source/build and browser coverage.

## Client caching and loading performance (21 October 2026 UTC)

The workspace now shares account/session-owned, in-memory read snapshots. Durable
changes reconcile affected notes, notebook lists, history, search, briefs and
conversation views. Retained drafts keep their original versions and uncertain
operation IDs; newer edits and later-version save replays require explicit review.
Metadata-only cross-tab invalidation, visible refresh, bounded retention and expiry
preserve freshness. The authenticated transport remains private and `no-store`.

Notes defers the drawer/editor, notebook secondary views and collapsed linked-note
title reads. Independent notebook/note reads start together. In-place chunk retry,
intent preloading, hidden-mobile preview gating and demand-loaded monospace fonts
reduce opening work. New list rows render at full contrast immediately.

The cache-delivery build reduced Notes-entry JavaScript to
**684,469 → 454,146 gzip bytes (-33.6%)**; notebook entry
is **695,542 → 456,830 (-34.3%)**. The first Settings→Notes round trip makes **2 → 1**
application reads; subsequent fresh repeated visits make zero. CI enforces the
513,351-byte Notes-entry ceiling and keeps editor code out of that entry. Exact
paired p75 is **227→85ms** for desktop return-to-Notes and **7762→6141ms (-20.9%)**
for mobile cold Notes. First drawer opening is slower (**437ms / 2291ms** desktop/
mobile), and mobile return-to-Notes is **512→612ms**. Production-build timing,
memory, long-task and layout evidence is recorded in
[performance verification](../scripts/performance/README.md).

Initial cache delivery passed **97 Chromium** scenarios and **nine selected iPhone/WebKit** cases,
including cache ownership/cancellation, late responses, expiry, drafts/conflicts,
mutation retries, pagination, keyboard/focus, dragging, responsive accessibility and
telemetry privacy. Real production Next/Clerk checks verify sign-in, account controls,
deferred editor loading, failed-chunk recovery and anonymous private/no-store denial.
Root lint/types/build, five artifact checks, website lint/types/production build,
twelve release-script contracts and actionlint/ShellCheck pass. WebKit uses the
Playwright 1.64.1 Noble browser container. Node is 24.21.0; pnpm is 10.33.0.

The visual refinement keeps the drawer's width consistent through
loading, failure and successful retry. Static placeholders, an honest loading label
and a reserved refresh/retry slot keep Notes calm while data arrives. Background
failures preserve rows and selection; pagination retries its original cursor.
Keyboard recovery retains focus and reduced-motion feedback stays static.
With the merged gesture refinement, the ready compact toolbar takes keyboard focus
from the temporary loading header.
The follow-up passes **100 Chromium** scenarios, **eight selected iPhone/WebKit**
cases and production drawer/auth/retry checks at **1440, 390 and 320px**. Required
root/website checks and five artifacts pass. Before gesture integration, Notes entry is **454,807 gzip
bytes (-33.6%)**, including 661 bytes for the refinement; the editor remains deferred.
Current application source/build and reviewed synthetic captures are recorded in
the performance verification linked above.
The integrated gesture/cache build is **457,678 gzip Notes bytes (-33.1%)** and
**460,613 notebook bytes (-33.8%)**; the same CI budget and deferred boundary pass.
Combined verification passes **112 Chromium** and **15 selected iPhone/WebKit**
cases, plus production drawer/auth/focus recovery at **1440, 390 and 320px**.

Final integration includes landed actions and canonical relationships. Connection
pages stay idle while collapsed, share cached batched titles/evidence, and reconcile
review/source changes with cancellation and deletion fencing. Row-delete retries
retain the original draft base when a later agent version requires review. The
combined tree passes **131 Chromium**, **32 selected iPhone/WebKit**, root/website
lint/types/builds and five artifacts. Production auth/deferred retry/focus checks
pass at **1440, 390 and 320px**. Notes entry is **463,180 gzip bytes (-32.3%)**;
notebook entry is **466,081 (-33.0%)**. Both editor and PDF renderer remain deferred.
[Final synthetic screenshots](design/screenshots/client-performance/README.md)
show quiet loading, background recovery and desktop/mobile editing.

See [cache ownership and integration](development/client-cache.md) when adding
workspace actions or resource families. No schema migration is required.

## Public read-only sharing (21 October 2026 UTC)

Owners can share live saved notes/notebooks, choose direct-only or descendant
notebook scope, recopy stable links, replace or revoke them. The shared dialog is
available from note toolbar/commands and notebook page/sidebar/manager actions.
It identifies covering notebook links and allows revocation during pending saves.
Public readers render independently of Clerk, inference and the private workspace
cache. [Sharing](sharing.md) records the permissions, API and key lifecycle.

Local verification on Node 24.21.0 / pnpm 10.33.0:

- Root `pnpm lint`, `pnpm check-types`, `pnpm build`, all **74** database/service
  tests and all **5** packed-artifact tests passed. PostgreSQL 17 / pgvector 0.8.2 used
  separate non-owner API/worker roles in a newly created disposable `_test` database.
  Coverage includes cross-account/RLS denial, concurrent rotation/revocation,
  encrypted retry-safe tokens, scope narrowing/moves, expiry/restore/deletion,
  account/limiter purging, temporary-schema shadowing and backup invalidation.
- Website lint/types and telemetry-enabled production build passed. The full
  Chromium suite passed **83/83**; after the final long-heading reader correction,
  all **6** targeted reader/privacy checks passed, including the added no-JavaScript
  case. All **5** public-reader checks also passed on iPhone 13 / WebKit using the
  Playwright 1.64.1 Noble image with Node 24.21.0.
- Browser checks verify stable copy, uncertain-response retry, stale settings,
  inherited access and revocation while saving; anonymous/deep-link navigation,
  live edits, revoked-link reload/history, no-store/no-referrer/no-index headers,
  scoped Markdown links and safe failure recovery. Malformed upstream responses
  emit only generic errors. Real SDK payloads contain neither capability nor
  content canaries, and public-reader replay is absent.
- Desktop 1440px and mobile 390px/320px reader/dialog screenshots were reviewed.
  Automated WCAG 2A/AA/2.1AA and horizontal-overflow checks passed.
- A synthetic 10,000-note notebook returned ten 30-note pages in **9.1–15.6ms**
  locally. The listing used `memories_owner_page`, visited 31 rows and completed
  in 0.045ms under `EXPLAIN ANALYZE`, with no sort or temporary blocks.
- All **17** release/DigitalOcean contract tests, pinned actionlint with
  ShellCheck 0.11.0, and `docker build -t grove-public-sharing:test .` passed.

Rollout requires owner migration `20261021_011_public_sharing`, an API-only
`SHARE_LINK_KEY`, API/worker rollout and then the matching website. Actual host
capability-log redaction and live signed-in/signed-out checks remain rollout
verification, as detailed in [deploy](deploy.md#public-sharing-rollout).

### Sharing interface refinement

After screenshot review, the sharing dialog uses a compact 540px layout, grouped
settings and quiet inherited-access rows. Its primary action follows the current
state: Create link, Save changes, Turn off direct link, Copy link or Done. Cancel
restores staged settings without writing. Copy/Open remain unavailable while
permissions are pending. Copy feedback stays on the button; saves/replacement use
inline status, keeping mobile actions clear. Clipboard denial selects the URL for
manual copying, and completed mutations preserve keyboard focus.

Public readers have a tighter reading rhythm, aligned checklists, quiet notebook
rows with update dates, and explicit focus states. All navigation retains fresh
server reads. [Reviewed screenshots](design/screenshots/public-sharing/README.md)
cover desktop and mobile, including long names and short-viewport scrolling.

Follow-up verification on integrated development `5edcb42`: root/website
lint/types/builds, all **five artifact**, **88 database/service**, **113 Chromium**
and **28 iPhone/WebKit** scenarios pass. The disposable PostgreSQL database applies
relationship migration 010 before sharing migration 011 and exercises real non-owner
roles, public-scope/lifecycle/recovery and cross-account denial. Browser checks cover
scope conflicts, staged cancellation, clipboard denial, pending-save revocation,
no-JavaScript reading, and desktop/390px/320px accessibility and overflow. Mobile
review exposed the success-toast overlap that inline feedback resolves.

Handoff integrates landed gesture #58, actions #61 and connections #60. Phone
sharing uses the compact Note actions menu; desktop retains its toolbar button.
Share uses the common note-action slot and one notebook-action callback across
page/sidebar/manager controls. Authenticated proxy admission retains both sharing
and connection routes, while anonymous readers retain their independent scope.

Merge closeout integrates stable interactions #63 at `1e1eb27`. The only textual
conflict was in this delivery record; both feature histories are retained. The
combined **121 Chromium** cases and **19 focused iPhone/WebKit** sharing/filter/
selection/search checks pass. Root/website lint, types and builds plus all five
artifact checks pass before the user-authorized squash merge.

## Stable selection, filters and workspace feedback (21 October 2026 UTC)

Bulk selection shares the existing list header, with mixed selection and keyboard
focus recovery. Advanced filters open over the list; their count, search-clear and
sort controls reserve their geometry. Clearing filters preserves the selected sort
and empty results provide a direct reset. Native dropdowns stay within the active
popover and dismiss independently.

Global search and the command menu retain their query position through loading,
matching and empty states. Preference saves provide in-place status, retain newer
edits made during a pending save, and report errors without shifting the form.
[Interaction guidance](development/stable-interactions.md) describes the contracts
and [reviewed captures](design/screenshots/stable-interactions/README.md) show the
desktop and narrow layouts.

Root lint/types/build and all five packed-artifact checks pass; website lint/types
and the telemetry-enabled production build pass. After integrating the landed
gesture and note-action work (`570c133`), all 108 Chromium scenarios and 11 focused
WebKit scenarios pass. Refreshed captures were reviewed in both browsers. Geometry
checks cover 320, 390 and 1440px, mixed/bulk selection, nested overlays, search
loading and preference-save races. No schema migration is required.

## Connection and action integration (21 October 2026 UTC)

Integrated landed note actions #61 (`570c133`) after gesture polish #58. The reader
retains Export/Delete alongside compact Linked notes, and Notebook options combines
creation/organization with Connected notebooks. Both source and delivery histories
are preserved. Root/website lint, types and builds, five packed-artifact checks,
all **103 Chromium** scenarios and **20 iPhone/WebKit** scenarios pass on the combined
tree. Desktop/320px reader and connection captures were reviewed.

## Connection and gesture integration (21 October 2026 UTC)

Integrated gesture polish #58 into the connection feature, retaining stable graph
zoom, embedded touch scrolling, expanded pan/pinch, contextual Controls and the
shared evidence inspector. The expanded focus loop includes the connection list.
Memoized visible nodes keep graph edges mounted while an inspector opens, so
closing it restores keyboard focus to the original edge.

Root/website lint, types and builds plus all five artifact checks pass. The combined
90-case Chromium run passed 89 scenarios and exposed the edge-focus regression;
after the fix all three graph scenarios pass, including nested evidence/reader
dialogs, focus return and narrow-layout accessibility. All 11 focused iPhone/WebKit
relationship and gesture cases pass. Desktop and 320px graph/inspector captures
were reviewed. Final website lint, types and build also pass after the focus fix.

## Quieter connection UI (21 October 2026 UTC)

Connection lists now use compact rows with a title, short reason and quiet category.
Endpoint lists start with five results. A centered inspector keeps explanations and
endpoint navigation visible, with excerpts and notebook coverage under **Supporting
notes**. Partial coverage remains explicit; source revision labels and repetitive
scope text are removed from the default view. Graph edges are quieter, and guides
and accessible connection lists are available on demand.

Root/website lint, typechecks and builds, all five packed-artifact checks, the full
78-case Chromium suite and three iPhone/WebKit scenarios pass. Browser verification
covers disclosure and keyboard access, retained editor state, comparison focus,
dismissal/Undo, pagination and stale-source rejection. Updated desktop and 320px
[captures](design/screenshots/note-relationships/README.md) record the refinement.

## Explainable note and notebook connections (21 October 2026 UTC)

Connections now carry a specific reason and verbatim, revision-checked excerpts.
The reader and Notes graph share a canonical assessment, comparison and
version-checked dismissal/Undo. Notebook context and the Notebooks graph explain
shared threads with explicit source coverage; direct membership remains separate
from sub-notebooks. Migration `20261021_010_relationship_evidence`, bounded worker
backfill and review-state recovery are documented in [relationships](relationships.md).

Verification includes real PostgreSQL/RLS, leased-worker races, uncited notebook
invalidation, bounded retries/budgets, export/reindex/recovery, browser accessibility
and responsive comparisons. The complete 78-case Chromium suite and three focused
iPhone/WebKit cases pass. Packed artifacts, release/deployment contracts, workflow
lint and the API container build pass. All 76 backend tests pass. Additional
regressions cover discovery beyond 100 notebooks, retry after revised sources,
deletion after a notebook move and batched legacy relationship reads.
[Visual review](design/screenshots/note-relationships/README.md) records desktop,
320px and notebook-graph captures.

A live MiniMax run of 16 explicitly labelled synthetic cases passed all classifications
and exact-source checks, including four abstentions. Earlier runs exposed false
conflicts for superseded/tentative decisions and unsupported dependency directions;
the final level-specific schemas and instructions address those findings. Incidental
citations in abstentions are discarded; positive claims retain strict validation.
This small corpus is a regression signal, not a general accuracy estimate.

## Focused PDF exports (21 October 2026 UTC)

The PDF refinement uses a monochrome type scale, a consistent portrait reading
measure and compact list rhythm. Real task checkboxes, subtle quote/table rules,
content-weighted columns and padded monospace code retain the note's structure.
Only multi-page documents show a quiet folio. Section bookmarks aid navigation.
Six-to-eight-column tables and their introductory headings occupy landscape
sheets; prose returns to portrait. Ordinary rows stay together, while unusually
tall cells can continue across pages. Text wraps at measured edges without
injected zero-width spaces, and Markdown soft line endings flow naturally.

Code uses pinned JetBrains Mono 2.304 TTF under its existing OFL attribution,
requested from the same origin only for exports containing code. It is subset
into the PDF; rare missing glyphs fall back to the embedded prose face. A failed
font request leaves source export usable and can be retried. The production
Turbopack worker was exercised with actual code: it produced a parsed one-page
PDF with an embedded JetBrains Mono face and exactly one local font request.
The renderer remains deferred (about 754KB gzip) and absent from initial Notes
chunks.

The updated [PDF captures](design/screenshots/note-notebook-actions/README.md)
include an ordinary one-page note and a wide-table sheet. Browser checks inspect
actual font embedding, bookmarks, selectable text, single-page output, table
heading placement, mixed page orientations, every wide-table cell, oversized
record continuation, content bounds and font-load recovery.

Root lint/types/build and five artifact checks pass, as do website lint/types and
the telemetry-enabled production build. The 100-case Chromium run found one
ordinary table row split; after the row-keeping fix, all six export regressions
pass. Six distinct iPhone/WebKit export scenarios pass as well, including a final
repeat of the mixed-orientation/oversized-record case. Fresh single-page and
seven-page stress PDFs were parsed and visually reviewed.

## Note and notebook actions (21 October 2026 UTC)

Notes expose Export and confirmed Delete directly in the toolbar and row actions.
Deletion pauses autosave, settles active/uncertain saves with their original retry
identity, checks the saved version and explicitly discards local edits. Cancel
retains drafts; success focuses the next row or the empty-state heading. Notebook
Create/Rename/Move use distinct controls, reject no-op moves and preserve inputs
while reviewing a concurrent change.

Export downloads exact UTF-8 Markdown, copies it with a selectable fallback, or
generates a real paginated PDF. Local snapshots survive first-save routing and
identify unsaved content. pdfmake 0.3.12 (MIT) embeds its bundled Roboto fonts in a
cancellable worker; Markdown parsing is loaded on demand too. Images become links,
raw HTML is ignored and unavailable glyphs get explicit Unicode codes. Renderer
and fonts are absent from initial Notes chunks: the deferred worker is about
753KB gzip; Notes client-reference chunks grew about 8KB gzip against the integrated
gesture baseline. A production Turbopack worker was separately started and produced
an `application/pdf` Blob successfully.

Node 24.21.0 / pnpm 10.33.0: root lint/types/build and five artifact tests pass;
website lint/types and telemetry-enabled production build pass; 98 Chromium tests
pass, with five focused deletion checks repeated after the empty-state focus fix.
Fourteen focused iPhone/WebKit scenarios pass (the PDF filename assertion accounts
for WebKit replacing spaces with underscores). PDF checks parse selectable text,
links, pagination and all 280 cells in a wide table, checking text bounds as well
as real downloads. Deferred-load failure, cancellation, clipboard denial, stale
versions and lost save responses are covered. Final focused PDF checks also ensure
a title-only first-save snapshot produces one page rather than a blank leading page.

[Reviewed captures](design/screenshots/note-notebook-actions/README.md) show the
desktop/390px/320px reader, export chooser and PDF layouts. Physical-device download
and clipboard behavior remains unqualified. The feature requires no schema migration.

## Gesture and interaction polish (21 October 2026 UTC)

Native action menus measure, flip and clamp to the visual viewport; touch targets
reserve independent 44px areas. Backdrop dismissal requires an intentional primary
press/release. Note swipes reveal one action strip, preserve page scrolling and
cancel on capture loss or a second contact. Mouse, touch, pen and keyboard handles
share validated destinations, a scrollable touch tray and visible cancellation.

Graph selection, reading and same-scope note revisions retain zoom. Ordinary wheel
input and embedded touch gestures scroll the page; modifier-wheel and expanded
pinch zoom are deliberate. Expanded exploration has an in-app fallback, focus
return and nested reader support. The phone note header consolidates secondary
controls: the 390×844 reader begins at y=134 instead of y=280. Chat replies preserve
older-message reading/selection, with an explicit Latest reply action. Move/bulk
Undo and copy feedback share the active dialog's notification stack.

The screenshot-review follow-up simplifies presentation: one mobile move panel
contains destinations and cancellation, the smaller drag preview only identifies
the item, saved controls are neutral, and compact success feedback sits at the
lower right. Graph instructions are available through **Controls**, with explicit
Expand/Done labels and only relevant legends. Empty-state guidance stays below
the canvas. Independent touch targets and durable Undo remain available.
The follow-up passes all 87 Chromium and eight iPhone/WebKit scenarios, with the
three graph scenarios rechecked after the final 320px toolbar/accessible-label
adjustments. All required static, build and artifact gates pass; six refreshed
captures record the visual review.

Node 24.21.0 / pnpm 10.33.0 verification passes root lint, types, build and all five
packed-artifact checks; website lint, types and telemetry-enabled production build;
87 Chromium browser/accessibility/privacy scenarios; eight focused iPhone/WebKit
scenarios; and 25 memory/conversation database/API tests with non-owner roles in a
new disposable PostgreSQL database. Tests cover trusted mouse/touch/pen input,
second-contact interruption, autoscroll/hover expansion, 2× pinch-zoom menu bounds,
graph pan/pinch and nested focus, mobile text formatting/Undo, held replies and
version-fenced mutation Undo. The focused WebKit config is reproducible from
[testing guidance](development/testing.md).

[Reviewed captures](design/screenshots/gesture-polish/README.md) use synthetic notes
and production CSS. Physical iOS/Android keyboards, OS selection handles,
back-edge navigation and hybrid-device/trackpad/pen feel remain unverified. No
schema migration is required; this records feature verification, not a release.

## Google Search Console (21 October 2026 UTC)

The `sc-domain:usegrove.cloud` property is DNS-verified. Google successfully
processed the production sitemap and discovered five public pages. Cloudflare,
public DNS and Google owner/sitemap readbacks are accepted; ongoing checks are in
[product observability](product-observability.md#google-search-console).

## Unified note workspace and keyboard navigation (21 October 2026 UTC)

Reading and editing now share one persistent editor on the canonical note page and
in a wider drawer. The mode toggle retains editor history and scroll positions;
drawer autosave uses the same retained drafts, operation IDs and version checks as
full-page writing. Linked notes are collapsed; agent references are within Note
properties. History, comparison and restore remain contextual.

The workspace adds a searchable command menu, platform-aware shortcut help, scoped
arrow/Delete controls, and non-reflowing toast feedback. Text editing, native
selection and accessible notebook dragging retain their own key handling. Nested
dialogs dismiss independently, restore focus and release reference-counted scroll
locks. The sidebar logo returns to Notes. Settings share a persistent layout with
consistent navigation and independently scrolling content.

Verification on Node 24.21.0 / pnpm 10.33.0: root lint, types, build and all five
packed-artifact checks pass; website lint, types and telemetry-enabled production
build pass. All 75 Chromium browser scenarios pass, including privacy/telemetry
regressions, draft recovery, version conflicts, keyboard commands, confirmation
before deletion, mode switching, responsive geometry and accessibility. Hosted CI
exposed a first-save focus race: the command registry now follows the mounted
workspace, preview survives routing, and modal dismissal restores focus by a stable
key. Deterministic held-save tests verify that transition. Seven iPhone/WebKit
checks pass for settings, notes, mode/scroll retention, mobile notebooks, touch
menus and the first-save regressions. [Visual review](design/screenshots/note-workspace/README.md)
records the captures. No schema migration is required.

## Product observability 1.7.1 (21 October 2026 UTC)

Repair #45, coordinated release #46 and frozen production #47 are merged.
Immutable source `d22d90bc2b2968ed3c296249297f732e7e17d358` and production
`bccc1f0bef6f1514229375d205608904bb987e8b` have equal trees. Protected
[Deploy 39548392395](https://github.com/miniaxolotl/grove/actions/runs/39548392395)
passes. All five npm artifacts verify their registry hashes and exact source;
API/worker are ACTIVE on the manifest's immutable image, with healthy readiness
and preserved runtime collection settings. No schema migration is required.

Published CLI opt-out/configuration preservation/identity rotation, live browser
cross-tab privacy, anonymous PostHog events and symbolicated native/browser errors
pass. The repaired Sentry streamed spans are indexed for the exact CLI/API release,
confirming the previous `missing_dsc` rejection is resolved. All 14 dashboard
queries pass; replay remains masked at 10%/30 days. Full evidence and provider IDs
are in [product observability](product-observability.md).

## Reliable replies and one notes workspace (21 October 2026 UTC)

Production diagnostics and a synthetic request against MiniMax reproduced the
greeting failure: the provider returned `proposal:{}` for a nullable object. The
generation contract now represents optional actions and targets with bounded
arrays, validates them strictly, then converts to the existing public proposal/null
contract. Invalid actions stay retryable failures. Grove supplies preview wording,
and Apply remains the only step that changes notes. Planner instructions extract
topic keywords for text-only search and separate greetings from note requests.

Notes is the main workspace, with a shared sidebar notebook tree and a mobile
disclosure. Today’s note uses the same full-page editor in the selected notebook;
Date written groups the library by day. Legacy Journal links open the dated view.
New note follows filters and editor context. Notebook summaries, progress notes and
scoped chat are contextual actions; personal details are under Settings → Account.
[Visual review](design/screenshots/simple-notes/README.md) covers desktop and mobile.

Root and website lint/types/builds, five packed artifacts, 61 database/provider
scenarios, 68 Chromium browser/accessibility cases, 17 release/deployment contracts
and actionlint/ShellCheck pass. A disposable PostgreSQL account using the actual
MiniMax adapter also passes the original greeting, grounded note finding, and
edit/create/merge previews without changing notes. No schema migration is needed.
Four additional iPhone/WebKit scenarios pass for notebook browsing, dated writing,
composer editing and touch menu scrolling. The integration preserves the independent
native-observability changes from #41. This records local/provider verification;
production rollout follows the protected release path.

## Workspace polish and contextual conversations (20 October 2026 UTC)

The workspace now has one notebook tree with nested note links, shared pointer/
keyboard/touch move destinations, notebook nesting and version-fenced undo. Compact
filters, global Ctrl/Cmd+K search, a light graph and grouped Settings share the same
workspace chrome. Full-page writing is wider, autosaves after a pause and has
full-viewport focus mode. Save retries preserve their original operation and newer
typing; clicking outside dismisses idle dialogs and drawers.

Ask Grove stores account-isolated conversations and resolves contextual note
references before retrieving current evidence. Explicit create/edit/merge requests
produce reviewable previews with atomic apply and version-fenced undo. Merges keep
originals in Archive. History deletion, account export/deletion and restore
reconciliation include conversations. The auto-growing composer has plain and
Markdown modes, optional formatting/preview, native undo, selection preservation,
IME-aware shortcuts and touch-friendly sending.

Local verification passes root/website lint and types, production builds, all five
packed artifact checks, the 44 existing database/provider/auth/recovery scenarios
and seven conversation scenarios. All 55 Chromium browser/accessibility cases pass;
three compatible touch WebKit scenarios pass in the Playwright Ubuntu container.
[Screenshots and visual results](design/screenshots/frontend-polish/README.md)
cover the workspace, focus, both input modes, mobile composition, Settings and graph.

Before deployment, apply forward migration `20261020_009_conversations` using the
owner procedure in [deploy.md](deploy.md), then roll out API/worker before website.
This evidence records local verification; production activation is a separate release.

## Collection 04 website release (20 October 2026 UTC)

[Website #31](https://github.com/miniaxolotl/grove/pull/31) delivers Space Grotesk
and JetBrains Mono, approved Sprout artwork, the notebook-first story, connected
agent guidance and a licensed repository-local design kit. The strengthened
long-notebook regression also verifies sidebar destinations stay inside their
column. [Screenshots and local verification](design/screenshots/brand-family/README.md)
record desktop Chromium, mobile WebKit and the isolated notebook fixture.

[Release #32](https://github.com/miniaxolotl/grove/pull/32) published **v1.4.0**
from `ae1bd49c286866242da46c3adaabdbfe5acd238a`. Full independent source
[CI 39491456785](https://github.com/miniaxolotl/grove/actions/runs/39491456785)
passes, including all 49 browser cases. Frozen
[production #33](https://github.com/miniaxolotl/grove/pull/33) merged as
`987923fd2ed3129b04e981e211943adf272afe34`; its tree
`5bbdf17ffaa0979fc6f431717cf27eda76be045a` equals the released source tree.

Vercel deployment `dpl_FxRBUQDYnnwryudWMt6hdBw7HWt2` is READY on that production
commit. The live review at **20:39 UTC** verifies all 27 approved public asset
SHA-256 hashes, canonical/social metadata and home, privacy, terms, install and
self-host pages at 1440px and 390px. There are no document-overflow, browser-error
or automated WCAG A/AA findings. The visual kit is available at
<https://usegrove.cloud/brand-kit/index.html>.

The initial production review caught React hydration error 418 on both legal
pages. Cloudflare's default email obfuscation rewrote their public contact-email
HTML before React loaded. Setting `email_obfuscation` to `off` for the Grove zone
at **20:33:18 UTC** fixed the provider-side transformation. Readback confirms the
setting and the complete live review passes afterward. Local builds were unaffected.
Keep this setting disabled as described in [hosting](deploy.md#topology).

## Full-page writing and nested notebooks (20 October 2026 UTC)

New notes and Journal entries open a full-page CodeMirror writing space with live
Markdown, source/preview modes, shared formatting tools, undo/redo, outline,
properties and focus mode. Explicit Save and keyboard saving keep the document
open. Account-scoped drafts retain their original revision, retry operation and
in-flight save during navigation; concurrent changes still require review.

Notebooks have persistent parent relationships, expandable navigation, path-aware
pickers/breadcrumbs, and shared create/rename/move controls. Same-account foreign
keys and serialized mutations prevent invalid parents and concurrent cycles.
Notebook revisions fence stale changes. Hierarchy does not grant access to child
notebooks or disclose hidden ancestors. Notes retain their history and lifetimes
when notebooks move. Apply migration `20261020_008_nested_notebooks` before API
rollout as documented in [deploy.md](deploy.md).

Shared Select, NotebookSelect, NotebookTree, NotebookBreadcrumbs, NotebookDialog
and NotebooksProvider components serve the editor, library, organization and
settings. Dropdowns support typeahead, arrows, Home/End, touch scrolling, checked
choices, modal focus restoration and reduced motion.

All 44 database/provider/auth/recovery tests, five packed artifact tests, and 49
browser/accessibility scenarios pass. Root and website lint/types/build checks
pass. Visual review covers 320–1920px writing layouts, long-note scrolling with visible Save,
desktop and touch notebook organization, and long menus inside/outside dialogs.
Thirteen screenshots and geometry checks report no application errors, horizontal
overflow or WCAG A/AA violations. Menus animate position/scale while keeping text
fully opaque, so their contrast remains readable throughout the transition.

## Consumer-facing Grove website (20 October 2026 UTC)

The public site leads with “Good ideas. Room to grow.” and a private notebook
for everyday notes, plans, journaling and connected ideas. Notebook previews,
Ask Grove examples with source links, FAQs, navigation, account-entry copy and
social/search metadata share this positioning. The main call to action opens
browser sign-up; new accounts default to Notes. Optional AI-tool connections and
self-hosting remain accessible from the public site.

Root and website lint/types/build, five packed artifact checks and all 43 website
browser/accessibility checks pass. Public checks cover the no-JavaScript story
and sign-up path, keyboard notebook/demo navigation, source-note links, sharing,
metadata, installation, mobile navigation and WCAG A/AA accessibility.
Visual review covers desktop and touch notebook/journal/graph/Ask Grove previews,
the generated sharing image, and 320–1920px layouts without horizontal overflow.
The touch review reports no application errors or accessibility violations.

## Constellation graph and compact workspace (20 October 2026 UTC)

The Notes graph uses notebook-colored stars, connection-count sizing, curved
relationship lines, and hover/keyboard/selection neighborhood highlighting.
Titles stay readable while zooming; title visibility, full-screen exploration,
touch instructions, and reduced-motion behavior are supported. Connections still
require a loaded note in the same notebook at the referenced current version.

The workspace has slimmer navigation and headers, compact note metadata/tags,
quieter neutral surfaces, and tighter filters, Journal, Ask Grove, and readers.
Mobile navigation scrolls horizontally and reveals the active page; touch
controls retain larger targets.

Local verification covers root and website lint/types/build, all five packed
artifact tests, and all 43 website browser/accessibility checks. Expanded graph
coverage exercises title toggling, neighborhood highlighting, reduced motion,
keyboard reading, full-screen reading, and stale/cross-notebook exclusions.
Visual review includes a 30-note/42-connection fixture, sparse graphs, selection,
full screen, desktop and touch layouts, and 320–2320px workspace breakpoints.
The populated touch graph reports no browser errors or accessibility violations.

## Notebook, cited chat, and background services (20 October 2026 UTC)

Implementation `f69b2c6` on PR #12 passed CI
[39361151700](https://github.com/miniaxolotl/grove/actions/runs/39361151700):
42 backend/provider/recovery tests, 43 browser/accessibility checks, five packed
client checks, five deployment checks, lint, types, and production builds.
Desktop and narrow-layout graph, chat, journal, editor, and history views were
reviewed. The follow-up website polish preserves authored Markdown headings as
note titles and keeps graph keyboard shortcuts non-destructive.

The production rollout used a fresh 189,783-byte PostgreSQL custom backup with its
table list verified while API and worker were paused. Forward migrations 006
(independent note lifetimes) and 007 (background services) applied successfully.
API and worker are active on DigitalOcean deployment
`eefdf7be-e69c-4e08-90ef-b4d3d4c35b6f`, image
`sha256:eb84093ac03338190289735a40c5bd5615efd85f050b06caa79080420b2d178c`.
The initial notebook website deployment was
`dpl_Brtpc5QCXLftT1ecmszEaWqwg1j9`, built from a clean tracked-file archive and
promoted after the matching API/worker. `/health/ready` reports semantic enabled.

Signed-in production verification used the owner's authorized browser and labelled
demo notes. Temporary-note correction preserved its expiry and task reference;
the journal example is permanent. Its original text was restored through the
website as version 4, retaining the edited version and all earlier history. Ask
Grove generated current, scoped citations
and source search succeeded. The live graph showed two notes and one current
relationship; zoom and keyboard reading worked. All nine current note vectors
retain **4,096 dimensions**. Organization completed with no pending/failed jobs.

CloudAMQP TLS publish/confirm/consume and reconnect were exercised with opaque
synthetic IDs. The deployed worker dispatched and delivered both connection-event
emails on their first attempt; Resend confirms **Delivered** for both. The
verification connection is revoked. Sender `notifications@mail.usegrove.cloud`
uses the verified mail domain and a domain-restricted sending key. Click tracking
uses `links.mail.usegrove.cloud`; open tracking is disabled. Cloudflare is now
authoritative for `usegrove.cloud`; API/Clerk/mail CNAMEs are DNS-only.

User guide: [workspace](workspace.md). Operations:
[background services](background-services.md). Private live IDs, snapshots,
backups, and final deployment metadata are in the operator's excluded inventory.

## Configurable models (19 October 2026)

The model-provider feature is stacked on cloud-onboarding #11. Local verification:
32 contract/provider tests, 24 browser/accessibility tests, 4 packed-artifact tests,
and 5 DigitalOcean configuration tests passed. Root/website type checks, lint,
builds, Docker image build and a non-owner container readiness smoke check passed.
The new browser screens were inspected visually. Full 4,096-dimensional storage,
hybrid retrieval, source invalidation and profile cutovers use disposable pgvector
fixtures; HTTP fixtures exercise DeepInfra/MiniMax request and response contracts.
Live provider calls and production activation subsequently passed; see
[model configuration and rollout](models.md).

## Memory consolidation baseline

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
- Separate API/worker image, private PostgreSQL Compose, App Platform configuration,
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

Production promotion [PR #6](https://github.com/miniaxolotl/grove/pull/6) merged at
`f727969`. All five npm packages and the server image are published and verified.
Native remote-MCP OAuth credential sharing is not assumed; the supplied hooks and
stdio bridge use Grove's shared credential store.

## Hosted production verification

On 2026-10-19, `feat/neon-digitalocean-deployment` activated:

- Website **https://usegrove.cloud** on Vercel with production Clerk and HTTPS.
- API/MCP **https://api.usegrove.cloud** and a separate worker on DigitalOcean,
  app `3aef47f9-3724-4f21-9cad-8c4eb5644af0`, initial deployment
  `da11e9cf-a74a-4943-868b-705417c95d63`. Both use published image
  `sha256:884593cd2e9b50528d1421371fcbb77e804d0af357336d6d494da3a2e4585fff`.
- Neon PostgreSQL 17/pgvector 0.8.0, all three migrations, certificate-verified TLS,
  separate non-owner API/worker logins and RLS on all 11 tenant tables.
- Porkbun DNS, verified Clerk identity/email DNS, actual Svix webhook signing
  secret, and HTTPS 308 redirects for the three alternate domains and `www` names.

Live checks used two disposable production accounts and synthetic memories:

- `/health/ready` reports semantic search enabled; anonymous REST/MCP is rejected.
- Clerk sessions, website BFF save, leased worker indexing, hybrid recall,
  two-account isolation, archive exclusion and restore pass.
- Production DCR, PKCE consent/callback, zero capabilities before grant approval,
  refresh rotation, exact audience rejection, HTTP/stdio MCP, restricted agent
  capabilities, logout and online provider revocation pass.
- Real `user.created`, `session.revoked` and `user.deleted` deliveries populated
  database authority/receipt tables. Account deletion immediately denies access;
  the worker purges content and deletes the provider identity.
- Both fixture accounts were deleted after verification. Their memories, revisions,
  vectors, jobs, grants, keys and cached operations are gone; Clerk returns 404 for
  both identities. The temporary restore database and private fixture credentials
  and dump were removed after the recovery drill.
- A 61,318-byte PostgreSQL custom dump from Neon was restored in an isolated local
  database. Current-authority reconciliation removed three stale memories,
  blocked the deleted account, invalidated three old grants/API keys, replayed
  session revocation and passed non-owner/RLS isolation checks.

Browser qualification: production password entry reached Clerk's new-device email
challenge. Synthetic-account session verification used official short-lived sign-in
tickets. The hosted Account Portal presented Cloudflare verification to the
headless browser; OAuth consent was exercised using Clerk's documented
`mountOAuthConsent` component in that disposable browser on the website origin.
No production authentication/bot settings were relaxed. A human's complete email
challenge and hosted-portal interaction remain outside this automated evidence.

Relevant checks: 18 PostgreSQL/auth/client/recovery tests, five deployment-script
tests, 11 website browser tests, root and website typecheck/lint, website build and
workflow validation pass. A scripted same-digest rollout reached ACTIVE as
`4ca5a6eb-af88-45a8-9e48-af438604b095`, preserving runtime settings. The recovery integration
test also verifies reduced grants cannot regain access and the authority database
is unchanged. One-day Neon history is confirmed; in-place PITR was not performed.

Installation: [agent guide](client.md). Migration: [legacy import](migration.md).
Deployment and recovery: [runbook](deploy.md).
