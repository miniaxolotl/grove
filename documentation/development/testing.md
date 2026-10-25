# Verification

## Notebook organization foundation

Run `tests/src/notebook-organization.test.ts`, `notebook-order-migration.test.ts`
and `recovery.test.ts` using the disposable non-owner PostgreSQL fixtures below.
Cover complete paged catalogs beyond100, missing-on-another-page parents, strict
HTTP input, same-account active parent/anchor checks, cycles, exact retry replay,
concurrent reorders, no-op/source-version stability, stale Undo/ABA, export ranks
and restore epoch fencing. The populated upgrade must preserve retained source
columns and grants; only existing derived export counters may advance on backfill.

The stacked UI uses the actual workspace components and production CSS with a
loopback real API/non-owner PostgreSQL fixture (`DASHBOARD_API_FIXTURE_PORT`).
Use a complete500-notebook account, including a child whose parent is on another
catalog page. Verify manager/explorer/sub-notebook order, search/path preservation,
adjacent moves, nest/unnest, explicit before/after placement, cancellation and Undo.
Hold/lose accepted responses and compare the complete retry body/operation ID;
conflicts must require explicit review and reset the chooser. Stale Undo must not
refresh/replay itself. Failed catalog scans retain the previous complete snapshot
and block movement until retry; lifecycle removes cached rows immediately.

Run the existing Chromium suite and supported WebKit notebook/navigation cases.
Review320/390/1440px, short viewports, focus return, keyboard selection, WCAG A/AA,
overflow and touch target/scroll behavior. Large-catalog functional checks and
representative filtered accessibility checks are distinct evidence. Use synthetic
names for [reviewed captures](../design/screenshots/notebook-organizer/README.md).
No new frontend test cases are added in this pass; existing fixtures/interactions
are adapted to the paged wire contract and the single-menu/searchable-Move UI.

Physical iOS/Android reproduction of the owner's notebook drag, scrolling and note
swipe failures remains required for a device-fix claim. The coarse-pointer notebook
folder control intentionally opens Organize and permits native scroll; note drag/
swipe handlers remain unchanged. Browser emulation is not physical acceptance.

## Admin interface polish

Use the actual AdminPanel with production CSS and a disposable real API/non-owner
PostgreSQL fixture. Synthetic accounts only; no production operator/account edits
or authentication bypass in application code. Run existing browser regressions and
targeted scripted/manual journeys without adding frontend test files for this pass.

Review 1440/390/320px and a short phone window. Check distinct grant/role/status
rows, exact-match miss/clear, preserved rows on refresh/pagination errors, no-name/
long-identity cases, and honest Standard/Unavailable wording. Inspect all account
sections with keyboard navigation, focus return, WCAG A/AA, enlarged text, reduced
motion, forced colors and no horizontal overflow.

Reproduce dirty exits via section changes, close, Escape and backdrop. Verify
Keep editing retains values, Discard is explicit, and confirmed saves keep context
and refresh the shared version before the next section edits. Hold saves to verify
busy guards. Simulate an accepted-but-lost response, compare the entire retry body
and operation ID, and assert one audit. Unknown outcomes must not offer Discard.
Force a real version conflict; compare latest/attempted values and require explicit
review before a new operation. Review suspension/restoration and system-role changes
before writing; check subscriptions, private-content boundaries and provider bans
remain protected by the existing backend suites below. Revoke the operator during
an edit and verify private admin content disappears. Test failed role refresh and
post-save detail refresh separately from actual authorization denial.

Copy denial must expose the actual selectable ID/summary; success must not steal
focus. Confirm role-only history names the role change and support-note text is not
duplicated into the feed. Save reviewed synthetic screenshots and exact-source
verification context in [admin polish](../design/screenshots/admin-polish/README.md).
Host WebKit-library gaps should use the pinned Playwright container described below,
not global OS changes. Emulation is not physical-keyboard or native-mail acceptance.

## Free/Pro action allowances

Free/Pro action quotas add `action-quotas.test.ts` and
`action-usage-migration.test.ts`: non-owner API/worker final-slot races, stable
operation reservations, expiry/release, original-month settlement, tenant/flag
isolation, nested storage checks and retained soft deletion, plan/grant changes,
multi-provider-call replies, cached results, assistance fragments, organization
coalescing/deferral, preference-toggle bypass denial and keyword fallback. The
populated pre-028 upgrade preserves authored notes and provider-attempt counters.
The existing provider-budget concurrency fixture isolates its attempt boundary;
separate action coverage pins the production two-call ceiling across replicas.
Use only the disposable databases described below. [Usage captures](../design/screenshots/free-pro-usage/README.md)
record actual-component desktop/mobile warnings and legacy/unlimited compatibility.

## Admin support and usage

`system-admin.test.ts`, `system-admin-migration.test.ts` and `recovery.test.ts`
cover paginated browsing, identity-read authorization, target-only UTC aggregates
(including billing-hidden and prior-month cases), private-content canaries,
non-superuser owners, runtime/worker/ordinary-user denial and actor-context
restoration. Support edits cover exact-setting conflicts with user changes,
audit/idempotent retries, cross-action operation-ID reuse denial, self/last-admin
protection, suspension across provider updates, provider-ban preservation, worker
claim/heartbeat denial and restored current support state. The populated 026→027
upgrade fingerprints all old columns while checking inherited helper privileges.

Use the existing isolated dashboard fixture with a disposable real API/database
for browser review at 1440/390/320px. Review the People list, account usage table,
capture/recall/support note edits, suspension/restoration, access grants, clipboard
fallback, same-operation lost-response retry, errors/revocation concealment and
keyboard/focus/overflow/accessibility. Screenshots must use synthetic identities.
No production identity or support edit is necessary for source verification.

## System administration

Run `tests/src/system-admin.test.ts` and `system-admin-migration.test.ts` with the
disposable non-owner API/worker URLs below, plus `recovery.test.ts`. They cover
website-only roles, current account/subject/session checks, exact-email/user-ID
lookup after authorization, agent/ordinary-user denial, role/grant revocation,
last-admin protection, version conflicts/concurrent edits and audit/idempotent
retries. Runtime/worker direct writes, audit access and bootstrap are denied;
non-superuser-owner functions expose only account metadata, not private notes.
The populated024→025 upgrade fingerprints every existing table and rejects inherited
table/function privileges. Restore replays current role/grant authority rather
than resurrecting the backup's admin/unlimited privileges. Actual generation
dispatch exceeds a plan allowance with unlimited but still obeys independent
non-generation budgets. Integrated duration/research regressions verify unlimited
does not treat a null allowance as zero, while speech attempts and global research
spend still stop dispatch.

For browser verification use the actual AdminPanel and production CSS through the
isolated dashboard fixture. Use synthetic Clerk identities and a disposable real
API/database, not owner notes. Check exact-email search, all three access options,
separate system roles, reason validation, keyboard dismissal/focus, lost-response
same-operation retries and audit-once behavior, revoke/refresh concealment and
1440/390/320px accessibility/overflow. Do not add production authentication bypasses.
See [reviewed captures](../design/screenshots/system-admin/README.md).

## Tier limits and audio-duration metering

`billing-limits.test.ts` pins all defaults explicitly and compares environment,
example and Compose values, including zero overrides and rejected legacy TTS units.
`speech-duration.test.ts` counts MPEG-1/2/2.5 Layer III samples across real-shaped
frames, ignores claimed Xing duration and rejects invalid/truncated/free-bitrate
streams. Tests use synthetic frames, not personal/provider audio.

With the disposable non-owner URLs below, run:

```sh
pnpm exec tsx --test tests/src/billing-limits.test.ts tests/src/billing.test.ts tests/src/tier-quotas.test.ts tests/src/speech-duration.test.ts tests/src/speech-duration-migration.test.ts tests/src/speech-jobs.test.ts tests/src/speech-cache.test.ts tests/src/conversations.test.ts
```

Coverage separates daily/monthly guards, tests Free/Pro API/worker final-slot
admission, preserves embedding capacity after generation exhaustion and keeps
flag-off installation limits. Pro research must dispatch above the old daily guard
but stop at the advertised tier cap without raising the global spend budget.
TTS tests hold concurrent providers, settle exact decoded duration, retain failed/
invalid/overrun reservations, reuse audio without another charge and preserve
character counters. The populated 024→026 upgrade checks non-owner API/worker RLS
and conservative handling of old writers. Never reset retained databases for this.

Use the actual Billing fixture with the API's explicit `units` metadata. Check
Free/Pro independent 2/8-hour meters, 1,000/5,000 daily AI, 20/100 daily research,
upgrade disclosure, zero/custom/exhausted allowances, refresh, old character-based
responses, errors and flag-off hiding. Review 1440/390/320px, keyboard/focus, WCAG
A/AA and overflow in Chromium and supported iPhone/WebKit. Save only relevant
reviewed captures. The [cost report](tier-costs.md) is rate arithmetic, not paid-call
or production-invoice evidence; no paid provider calls are needed by these tests.

## Remembered Ask Grove tools and history

`tests/src/conversations.test.ts` covers nonempty partial account tool writes,
unchanged chat count, fresh connection/service/session readback, inherited defaults,
unrelated preference preservation, key/foreign-account denial, replay, version
conflicts and atomic partial-default updates. Existing in-flight research cases
continue to fence disable/re-enable results. No new migration is required.

After the website production build, run the focused component/cache cases:

```sh
pnpm --filter website exec playwright test tests/workspace.spec.ts tests/cache.spec.ts --grep 'Ask tools|conversation history|tool defaults|chat creation waits'
pnpm --filter website exec playwright test --config playwright.ask-webkit.config.ts
```

These cover reload/new sessions, retained drafts, held/failed settings saves,
independent old-chat choices, queued creation, held-read fencing and cross-tab
defaults. History cases cover distinct previews, 1440/390/320px accessibility,
pagination, Cancel/failure/retry, active-chat deletion, old empty chats and preserved
notes. Screenshots and measured results are linked from [delivery](../delivery.md).
When running the full backend suite on a many-core workstation, bound test-file
concurrency to local database capacity (for example, `tsx --test
--test-concurrency=2 src/*.test.ts` from `tests/`) rather than increasing timeouts.

## Speech cache

Speech-cache regressions in `speech-cache.test.ts` use a separate disposable
database and real non-owner API/worker roles. They cover exact text-hash A→B→A
reuse, receipt-independent lifetime, seven-day stale retention without extension,
metadata-only revisions, note expiry/archive, consent/restore fences, tenant/note
isolation, failed storage publication and cleanup racing an older transaction.
`speech-cache-migration.test.ts` verifies populated 023→024 preservation.
`speech-storage.test.ts` sends the S3 adapter to a loopback HTTP endpoint and checks
the separate narration prefix, MP3 type and private/no-store metadata; it is not a
live bucket lifecycle qualification.

The cache suite also exercises dynamic alternate-voice flags: off/on discovery,
cached playback, denial before dispatch/after inference, error fallback and Reed
independence. `speech-runtime.test.ts` checks Vercel precedence over the legacy
opt-in, self-host fallback, missing credentials/storage and master speech disable.

## Hosted chat connections

`pnpm exec tsx --test tests/src/directory.test.ts` runs without a database listener.
It verifies exact optional public proof, content type/cache/nosniff, HEAD and wrong
method/path handling, zero identity/database calls, private MCP's unchanged 401,
bounded unchanged token validation, and titles/annotations through the actual MCP
SDK. Both the top-level title and `annotations.title` must match for every tool.
A self-contained-description regression rejects cross-tool recommendations while
retaining metadata-replacement, history and reversible-archive behavior wording.
Public verification must never become an account-approval shortcut.

With the disposable database/non-owner roles below, run
`pnpm exec tsx --test tests/src/hosted-chat.test.ts tests/src/connect.test.ts tests/src/memory-tools.test.ts`.
The official MCP HTTP client initializes/lists tools before approval, receives
exact-connection guidance without a 401 loop, then exercises owner-only grants,
two-client save/recall, retry IDs, partial edits, read-only and revocation. Existing
memory/connect suites retain notebook-scope, account/RLS and lifecycle coverage.
State-fingerprint cases reject stale permission/revocation reviews, serialize
competing approvals and preserve a review across ordinary contact updates.

After a production website build, `hosted-chat.spec.ts` and `connect.spec.ts` cover
web/native setup separation, endpoint copy/manual fallback, storage-disabled
selection, pending-client refresh, exact-client approval, narrowed retry and
responsive accessibility. New OAuth/API-key/native forms select all action/scope
checkboxes; existing connections and narrowed resumed approvals retain their
choices. Tests explicitly narrow a new proposal before exercising denied writes.
Run the hosted subset in supported iPhone/WebKit too.
Use synthetic notes and the actual components; only save relevant reviewed captures.

```sh
pnpm --filter website exec playwright test --config playwright.hosted-chat-webkit.config.ts
```

Real ChatGPT/Claude discovery is tracked separately from this local evidence.
Do not label a host verified until an authorized HTTPS candidate passes the
[live-host acceptance matrix](../hosted-chat.md#verification-and-release-status).

Billing tests use the disposable PostgreSQL/non-owner API and worker URLs below.
`billing.test.ts` covers tenant isolation, non-superuser owner lookup, optional
configuration, concurrent quotas, recognized/expired subscriptions, UTC windows,
signed raw HTTP webhooks, duplicate events and canonical state, Checkout ownership,
idempotency and duplicate prevention, flag-off concealment and cancellation. The
loopback provider preserves original idempotent POST responses separately from live
Checkout state, covering lost responses followed by expiry/payment, resubscription
after canceled/expired-incomplete subscriptions in either interval, webhook failure
and retry, payment-state downgrades, late events after deletion and worker cancellation.
Concurrent API/worker reservations exercise both Free and Pro monthly generation
boundaries while ordinary note writes, reads and exports remain available.
`billing-pricing.test.ts` verifies a 5-dollar flag resolves 500-cent immutable monthly
prices, stale quote rejection and invalid/offline price refusal; product entitlements
preserve grandfathered subscribers across flag amount changes.
The Stripe SDK calls a local synthetic HTTP service; no real payment is created.
Research and speech suites also verify monthly quotas stop actual provider dispatch.

```sh
pnpm exec tsx --test tests/src/billing.test.ts tests/src/billing-pricing.test.ts tests/src/billing-migration.test.ts tests/src/conversations.test.ts tests/src/speech-jobs.test.ts
```

Use the real Billing component fixture for Free/Pro, the 5-dollar monthly price,
exhausted/zero allowances, pending checkout, errors/retry, refresh after payment,
period-end cancellation and hidden flag-off information at 1440/390/320px. Check
labelled usage meters, short reset dates, keyboard focus and overflow in Chromium
and iPhone/WebKit. Confirm the complete active settings tab remains visible after
fonts load; checkout failures must show a concise recovery action without upstream
provider details. Keep customer copy focused on plans, usage and actions.
Flag-off production routes must hide new checkout; discovery requires Flags SDK
authentication. Actual Stripe test/live lifecycle and Vercel cohort evaluation
are rollout verification, not inferred from synthetic local success.
See the [post-merge billing review](billing-review.md) for findings and scope.

## Workspace session recovery

Run the existing `cache.spec.ts`, `client-cache.spec.ts` and `telemetry.spec.ts`
scenarios after the telemetry-enabled website build below. The dashboard fixture
exposes `getWorkspaceToken(options?: { skipCache: boolean })` and
`switchWorkspaceAccount(userId, sessionId)` only in its test bundle. Use held,
rejected and null token promises with synthetic HTTP responses to exercise the
actual components in Chromium and supported iPhone/WebKit:

- Hold the first token: no workspace request dispatches before it resolves.
- Reject the initial listing with 401; repeat on stale-read visibility resume.
  Recovery uses a new Bearer token without a page reload or terminal denial.
- Reject concurrent reads, hold their refresh, then deliver an old 401 after it
  completes. The batch shares one forced refresh, including its late response.
- Reject a save, type more during its held refresh, and compare both serialized
  requests. Operation ID/version/body stay identical; newer typing and the editor
  node survive, and the later draft saves separately.
- Throw during refresh or let a token wait reach ten seconds. Retry feedback keeps
  content mounted. Navigate away/back after a failed save, restore token access,
  and retry the same operation. Query retries must not multiply refresh attempts.
- Return 403 independently from `/projects` and `/memories/search`. Each exposes
  its own retry and keeps the workspace mounted. Search must not enter note-detail
  eviction or cancel its own infinite query.
- Return null or reject the replay with 401: private state is cleared. Switch
  sessions and accounts during a held refresh: no old mutation is replayed and no
  old draft appears under the replacement identity.
- Hold a replayed save, complete another request's newer token refresh, then reject
  the old replay. Keep the editor node/draft mounted with retry feedback; an explicit
  save retries the identical operation. Repeat while the newer refresh is pending.
- Opt out during both initial-token and forced-refresh waits; each eventual dispatch
  must carry `X-Grove-Telemetry: off`. Re-enable during those waits and confirm that
  an originally opted-out request still carries the header.
- Return empty/HTML/`null`/malformed JSON envelopes with 401: one refresh, two HTTP
  attempts and current-generation private-state teardown. Verify raw API errors
  retain 401/403/409/503 status even without an envelope, and a late null token from
  before a successful refresh is recoverable.

The transport-level verifier additionally cancels one of two refresh waiters,
cancels while discarding a 401 body, fences replacement during initial token access,
and checks no auth replay for network/403/409/5xx failures. The installed Clerk
backend probe signs synthetic RS256 tokens and verifies fresh-Bearer precedence
over expired/missing/other-account cookies, plus rejection of an expired Bearer
despite a fresh cookie. Both probes run without provider traffic.

[Recovery captures](../design/screenshots/session-recovery/README.md) record the
reviewed source and outcomes. Synthetic lifecycle events and WebKit emulation verify
the recovery paths; the initiating request from the reported physical Safari
incident remains untraced. See [request ownership](client-cache.md#session-readiness-and-recovery).

## Other verification paths

Note-management coverage in `memory-tools.test.ts` and `memory.test.ts` exercises
the shared HTTP/remote-MCP contracts, metadata-preserving partial updates, exact
revision reads, atomic batch moves, retry conflicts, scoped/hidden-parent discovery,
revocation and owner-only notebook lifecycle. `conversations.test.ts` covers explicit
lifecycle intent, whole-subtree previews, Apply/Undo, stale versions, deletion without
Undo and hierarchy-cycle rejection. Recovery invalidates the new previews too.
Use the disposable database/non-owner roles below. All packaged bridges enumerate
the expanded catalog and exercise new tool routing and paused automatic corrections.

Actual-component Ask journeys use synthetic notes/notebooks at 1440/390/320px:
review lifecycle targets/counts, verify no write before Apply, archive/restore/Undo,
delete without Undo, notebook moves, disabled Manage notes and failed/stale Apply.
Verify navigation/cache refresh, keyboard focus, accessible labels and no horizontal
overflow. [Note tools gallery](../design/screenshots/note-tools/README.md) records
the relevant reviewed captures.

Connection-quality tests use a freshly migrated disposable database and non-owner
API/worker roles, as described below. Rerun `pnpm test:db:setup` after integrating
development's forward migrations; a database bootstrapped before media/speech
integration lacks the columns needed by the full current suite. Never reset an
existing database to fix this.

```sh
pnpm exec tsx --test tests/src/relationship-evidence.test.ts tests/src/relationship-discovery.test.ts tests/src/relationship-evaluation.test.ts tests/src/relationships.test.ts tests/src/notebook-assistance.test.ts
```

These cover substantive support/provenance, cached abstention, bounded note/notebook
candidate recall, template-saturated shortlists, minority threads, policy backfill,
changed/exhausted source snapshots, microsecond expiry, concurrent Dismiss/Undo,
cleanup and tenant isolation. Evaluation-runner tests use only a local synthetic
HTTP provider: they verify actual request caps, fatal aborts, usage and atomic
report replacement without paid calls. Live semantic qualification is separate;
see [quality results and limits](connection-quality-results.md).

Browser compatibility uses the existing connection/evidence/graph/cache and cleanup
scenarios with unchanged public payloads. Run the three connection scenarios and
cleanup preview in Chromium and supported container iPhone/WebKit; include the
native fullscreen graph scenario in Chromium only. Browser fixture checks do not
establish live model quality or replace real database/worker cutover tests.

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
HTTP adapter responses, independent speech preferences, non-owner source/RLS
checks, retained machine-versus-authored transcripts, retry/lease races, global
provider slots, conservative budgets, source/profile/session/restore fences,
private Range/HEAD playback, exact cache expiry and derived-only maintenance.
The populated 018→019 upgrade preserves authored notes, WAV metadata and transcript
history and the historical default-off behavior. `speech-defaults.test.ts` checks
the forward 020→021 upgrade, preserving all saved speech combinations and preference
versions while new authenticated accounts get transcription off/Read aloud on.
Opening an account and saving Read aloud off must not queue speech. Narration uses
real CommonMark parsing; regression cases exclude code,
images/media and link definitions while retaining labels and escaped prose. Its
profile cutover prevents reusing audio from the prior extractor. Restore
verification also seeds completed speech and checks that results
and artifact access expire rather than being revived.

Selectable voices add `speech-voices-provider.test.ts` and
`speech-voices-migration.test.ts`, extending jobs/recovery coverage for exact
voice routing, immutable omitted-default replay, A→B→A cache reuse, independent
profile cutovers, legacy/mismatched workers, consent generations and retained
defaults after restore. The 021→022 upgrade preserves existing settings and tenant
isolation. Historical migration assertions stop at their own boundary; current
service checks then migrate forward to the current schema.

Actual-component voice journeys use synthetic API responses and the bundled sample
MP3s in Chromium and iPhone/WebKit. Verify the on-demand chooser explicitly:

- Ordinary playback has no selector or sample controls. Opening/browsing/cancelling
  the chooser sends no preference, synthesis or sample requests.
- Sample buttons audition independently of the checked radio; failed samples retry
  in place. Samples share exclusive playback ownership and stop on dismissal.
- Opening/cancelling and same-voice confirmation preserve the narration element and
  position. Only a confirmed different choice resets it. Account refreshes retain
  prepared voice identity and an edited chooser candidate.
- Confirmations serialize quick saves; failed saves keep the applied voice with
  visible retry. Browse during a held enqueue, then confirm another voice and check
  cancellation/late-response fencing. Cover lost replies, both close controls,
  in-app navigation and uncertain cancellation recovery.
- Settings confirmation edits only its draft. Held saves retain a newer chooser
  candidate/draft; failed saves and Discard work. Read aloud off hides the summary
  without clearing the voice. Retain unavailable saved choices without fallback;
  hide player configuration when the feature is off or all voices are unavailable.
- Check menu-to-dialog focus, native radio arrows, Escape/backdrop focus return,
  1440/390/320px bounds, short viewports and WCAG A/AA. Review actual screenshots too:
  enclosing form styles must not override the chooser's compact radio-row layout.

Run concurrent browser suites with distinct ports **and** `--output` directories;
the runner clears its output directory and can otherwise delete another engine's
active traces. Paid provider checks remain separate from CI. See
[on-demand voice captures](../design/screenshots/speech-voice-flow/README.md) and
[original provider/sample evidence](../design/screenshots/speech-voices/README.md).

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
and synthetic live-provider runners. The shared AI preferences now have 16 controls,
including the two independent speech choices;
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

### Agent plugin acceptance

After `pnpm build`, run `pnpm test:agents`. The Linux x64 runner installs exact,
integrity-locked OpenCode 2.1.3, Claude Code 2.1.309 and Codex 0.164.0 native
packages into a temporary prefix, with lifecycle scripts disabled. It uses their
packaged native binaries directly; nothing is installed systemwide. Pins and
integrities live in `scripts/testing/hosts/package-lock.json`, separate from product
dependencies. `OPENCODE_TEST_BIN`, `CLAUDE_TEST_BIN` and `CODEX_TEST_BIN` may point to
absolute isolated binaries of those qualified versions.

The existing TypeScript CI job runs this suite without changing runner placement
or CI Gate inventory. Temporary HOME/XDG/client stores, local marketplaces and
loopback API/model fixtures isolate it from live credentials, sessions and billing.
Native install/uninstall, skills, the complete tool catalog, Claude's SessionStart and Codex's
paused automatic writes are checked. Missing-Node native failures are intentional
negative controls. OpenCode connects with an empty PATH and its compiled runtime
also exercises the original four bridge operations; packed-artifact tests cover all
new tool routes. Paths contain spaces; owned
processes are stopped on success/failure. macOS/Windows and other host versions
are not qualified by this Linux runner.

For the focused OpenCode regression alone:

```sh
OPENCODE_TEST_BIN=/absolute/path/to/opencode node scripts/testing/opencode-host.mjs
```

It installs only a temporary consumer under `/tmp/opencode`, uses isolated HOME/XDG
directories and starts the host with an empty executable PATH. The plugin, memory
skill and MCP connection must load without a separate Node installation on that PATH.
The test runner itself still requires Node, pnpm and npm. It does not restart the
user's service or change live configuration.

Artifact tests additionally run packed `grove doctor`: offline checks make no API
calls or local writes, probes never invoke memory tools or claim live-host readiness,
and malformed/unapproved/version-incompatible API results remain explicit failures.
`tests/src/client-boundaries.test.ts` covers invalid envelopes, cancellation and
damaged local state without implicit reauthentication or secret-bearing messages.

The telemetry-enabled artifact test first proves that ordinary commands initialize
telemetry, while blocking analytics delivery. Doctor must make no offline request;
its explicit probe may make only the requested `/v1/me` read with telemetry disabled.
Credential regressions reject damaged authentication without rewriting it, but keep
expired, structurally valid OAuth available for refresh. Assertion explanations make
these guarantees explicit, including that doctor creates no telemetry identity.

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
