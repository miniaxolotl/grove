# Delivery evidence

## Scoped meeting preparation — Phase A (25 October 2026)

Meeting preparation is an independently opted-in, on-demand workflow from one
notebook's direct notes or up to twelve selected saved revisions. Title, agenda and
optional date lead to source-linked Decisions, Previous discussions and Open
questions. Retrieval supplies at most twelve notes/24,000 characters from a bounded
lexical candidate window, with one structured generation call and explicit partial
coverage. No chat-history, descendant, calendar, attendee or web access is inferred.

Exact citations, whole-scope/source/preference/profile publication fences, stable
request/save retries, explicit cancellation and reviewed destination Save/Undo reuse
the existing assistance infrastructure. Source notes remain unchanged; saved briefs
retain coverage qualifications. Selected-source recovery preserves the agenda and
never silently broadens scope. One completed generated brief uses one assistance
action; actual provider-attempt evidence remains separate from user-action refunds.

Forward migration **20261025_031_meeting_preparation** leaves authored data, provider
usage and existing cleanup scheduling unchanged. The new worker-only cleanup
scheduler handles thirty-day derived-preview expiry without replacing the retained
scheduler. The preference defaults off and enables no background inference. The
populated upgrade test verifies retained data, opt-outs, forced RLS and narrow grants.
The existing admin migration test now asserts its named026→027 boundary before
upgrading to the current schema; preservation assertions are retained.

Implementation `daf189f` normally integrates subscription-badge development
`06d8740` at verified source **56b675dcc1fdceeed6f354be678e13645e5d6b45**.
Implementation PR #139 is stacked on planning PR #135; the plan integration changes
only documentation and retains the runtime and test source verified below.
Integrated verification: **446 backend passes, four optional S3/broker skips, zero
failures**; root/site lint and types, root/production website builds, **nine artifact
tests**, **50 CI/release/provider contracts**, workflow lint and bundle budgets pass.
Production website build **TbNm5ggTLWqDzmLQS5OoP** keeps the Notes entry at **492,106
gzip bytes** with deferred meeting UI. Five focused supported Noble WebKit cases
pass. The initial full Chromium run passed241 cases and exposed an outdated
sixteen-checkbox settings assertion after adding the seventeenth preference. The
updated regression verifies default-off and explicit opt-in persistence independently
of Ask, and passes in Chromium and WebKit. The full Chromium repeat passes **all242
cases**, with no retries or weakened checks. The follow-up changes only test coverage,
reviewed captures and delivery documentation; runtime source/build remains unchanged.

The real UI→HTTP API→PostgreSQL/worker journey passes generation, source links,
reviewed Save/Undo and unchanged originals, with no page errors, WCAG A/AA violations
or horizontal overflow at1440/390/320px. All inference is deterministic synthetic
test data, not a paid/live-model quality evaluation. [Four reviewed final-source
captures](design/screenshots/meeting-preparation/README.md) include the real-service
form/desktop/phone views and a WebKit partial-coverage/source disclosure.

Weekly review/recurrence, study, knowledge gaps and similar past problems remain
later phases, not implemented here. Large-scale retrieval performance, live-model
grounding/cost/latency, physical-device behavior and production activation remain
unqualified. No production migration, merge, provider/billing activation or deployment
was performed; rollout is a separately authorized owner operation.

## Visible subscription and complimentary access (25 October 2026)

The desktop/mobile workspace now keeps a small Free/Pro/Unlimited badge in its
existing controls, with no extra mobile navigation row. Hover/focus opens source
details and concise used/limit rows; click/tap pins the same panel. Library and
monthly action limits come first, with pending counts, reset dates and additional
AI/audio budgets behind a disclosure. Account details remain reachable while
purchases are hidden. Billing retains separate renewal/payment/end status and
**Manage subscription**, warning that a grant does not cancel a separate purchase.

Optional session-only `plan` metadata reuses canonical price/product/expiry and
admin-grant precedence. Scoped agents receive no new billing metadata. Workspace
reads use local state and the shared account/session cache, without Stripe calls
or another polling timer. The existing owner-only `/account/usage` adds `planUsage`
with canonical plan, resource/provider counters and explicit units; detailed reads
stay idle until intent. Billing reconciliation refreshes the badge snapshot so
checkout does not leave an old Free label. Missing/legacy data never guesses an
access source; failed reads offer retry. No migration, billing activation, price,
quota, retained-data, provider or deployed-runtime change is required or performed.

Backend red/green regressions cover Free/paid/trial eligibility, cancellation at
period end, non-entitled/expired/unsupported subscriptions, tenant/key boundaries,
complimentary Pro/Unlimited while billing is hidden, grant removal, subscription
preservation and no-config behavior. Two further red/green regressions verify actual
used/pending/configured limits, tenant/agent isolation, hidden-purchase Unlimited
and unconfigured usage snapshots. Full **435 backend cases pass**, with four
optional-service skips; **65 focused billing/action/admin** checks also pass.
Root/site lint, type checks and builds pass, with all **nine packaged artifacts**.
Production build `vb8B5nPqgh71PSfuIVlul` passes the Notes entry budget at **491,632
gzip bytes**, keeping the editor deferred.

[Four reviewed captures](design/screenshots/subscription-badge/README.md) use
actual components and production CSS with synthetic accounts/responses. **24
targeted journeys in each of Chromium and supported Noble WebKit** pass across
1440/390/320px, including keyboard access, WCAG A/AA,44px targets, overflow/page-error
checks, on-demand reads, exact/pending/zero/unlimited limits, audio hours, short
viewports, touch dismissal, retry, session replacement and checkout reconciliation.
A reproduced hover-dismiss→keyboard-focus failure now passes after replacing the
sticky dismissal flag with actual focus provenance. Simultaneous failures share
one recovery action. The shared workspace browser fixture
now accepts the badge's new `/me` read; its reproduced failing notebook case passes
after that fixture-only adjustment. The prior implementation passes the full
**239-case Chromium suite** and seven existing iPhone/WebKit settings/sidebar cases.

The final UI-only simplification removes six repeated meters, duplicate
complimentary prose and the separate footer action. Used/limit rows retain pending
and exhaustion labels; the linked plan heading/source opens Account. The collapsed
panel is at most365px high across all five plans at1440/390/320px. Both engines
pass all24 targeted journeys again, with **17 affected Chromium** navigation/settings
checks, nine artifacts, root/site lint/types/builds and the bundle gate passing.
Backend/API policy is unchanged by this final visual pass.

The merge follow-up integrates admin polish #133 (`05fe8fd`), retaining both delivery
records; no code conflicted. Integrated root/site lint/types/builds, nine artifacts,
the same491,632-byte Notes budget and435 backend cases (four optional skips) pass.
The backend repeat uses four test-file processes after a saturated-host timeout
and reboot interrupted earlier attempts; no timeout, assertion or database policy
was relaxed. Fifteen actual-component tier/source/usage/accessibility journeys per
Chromium and supported WebKit pass at1440/390/320px against integrated production
CSS/build`HBGViTUdyNh-S2oqCXNSi`. No production data or runtime was changed.

## Admin interface polish (25 October 2026)

People & access separates grants, system roles and availability in a compact
directory, with exact-match recovery and loaded rows retained during refresh
failures. A wider inspector keeps identity/navigation and editing actions stable
while the task content scrolls. Usage retains full values and explicit units,
including large counters at 320px; history describes individual field changes
without copying staff-note text into the feed.

One coordinated draft protects section changes, closing, Escape and backdrop
dismissal. Confirmed saves retain context and refresh the shared version; uncertain
saves retain the exact request for audit-once retry. Conflicts compare latest and
attempted values before a deliberate new save. Availability and privileged role
changes have separate review/confirmation. Periodic refreshes preserve dirty
forms, clean forms can adopt fresh snapshots, and disabled/removed action controls
recover keyboard focus in Safari without stealing a new field's focus.

Root/site lint, types and production builds, **406 backend cases** (four optional
S3/broker skips), **nine artifacts**, all **239 existing Chromium cases** and
bundle budgets pass. Notes entry remains **488,426 gzip bytes**, with the editor
deferred. Actual-component/API/PostgreSQL journeys in Chromium and mobile/touch
WebKit cover 1440/390/320px, held saves, exact uncertain retries/audit-once,
version review, suspension/restore, revocation concealment, minute-refresh draft
retention, clean refresh, explicit request-limit retries and keyboard focus. Narrow/short windows, enlarged text,
forced colors, clipboard denial, long identity/draft values, WCAG A/AA and overflow
are checked. [Ten reviewed synthetic captures](design/screenshots/admin-polish/README.md)
record the layout and application source.

No new migration, API permission, dependency, subscription/provider configuration
or production account change is introduced. Source delivery does not activate the
underlying support schema; [027 rollout](deploy.md#admin-support-rollout-027)
remains an explicit separate operation. Physical mobile keyboards and native
mail/clipboard prompts remain unqualified.

The follow-up integrates Free/Pro action allowances #131 (`3041590`) without
changing admin components or weakening quota policy. Admin reporting remains
provider-attempt counters; it is not presented as the separate user-action usage
report. Unlimited documentation now includes plan storage/action exemptions while
retaining the shared generation-concurrency safeguard.
Integrated verification passes **431 backend cases** (four optional-service skips),
all **239 Chromium cases**, nine artifacts, root/site lint/types/builds and bundle budgets. Real API/admin
journeys pass again in Chromium and mobile WebKit on the integrated source; the
reviewed captures use build **`Cf1S8gKaMlcFrViMdH4n3`**.

## Free/Pro storage and action allowances (25 October 2026)

Configured Cloud now separates user actions from retained provider-attempt budgets:
Free/Pro support 10,000/50,000 notes, 100/500 notebooks and monthly recall/search
30,000/150,000, Ask replies 300/1,500, organization 1,000/5,000 and on-demand
assistance 50/250. Two account-wide generation slots share durable leases across
foreground/API/worker replicas. Ordinary admission remains 180 operations/minute.
Reading, editing, keyword search and export remain available at AI exhaustion;
downgrades never delete existing content. Speech/research, subscriptions, grants,
provider-attempt counters and the introductory $5 price remain unchanged.

Source `a72cb5c` integrates merged admin-support #129 as
`d012ddbe9d1a7c3a92dd09dda2dcbdf89553615e`. Forward migration **028 follows 027**
and creates empty tenant-isolated action/lease tables, without reinterpreting old
usage. [Counting semantics](billing.md#library-and-user-actions) distinguish cached
reads, durable replays, fragmented work, source changes, background maintenance and
retrieval safety; [rollout](deploy.md#user-action-allowances-rollout-028) requires
explicit owner migration and matching API/worker configuration.

At the integrated source, **431 backend cases pass**, with four optional-service
skips and zero failures. Twenty-four action regressions plus a populated pre-028
upgrade cover final-slot races across non-owner API/worker roles, expired/released
reservations, retry IDs, original-month settlement, plan/grant changes, source
retention, nested storage checks, multi-call replies, asynchronous assistance,
organization coalescing, preference-toggle bypass denial and keyword fallback
pagination. Failed replies release action capacity but retain provider evidence;
action-covered retrieval does not inherit the smaller background embedding guard.
The integrated repeat initially found the local base fixture still at 026; applying
forward 027/028 to that task-owned disposable database resolved it without resets.

Root/site lint, type checks and production builds pass, as do all **nine packaged
artifacts**, **34 release/provider contracts**, pinned workflow lint, bundle budgets
and OpenCode/Claude/Codex native-host smoke checks. API and worker Compose expansion
matches all 12 action/storage defaults using synthetic required-field placeholders
only. Website build **`VMRgAIPjlRxwzZ26D8Ns9`**; Notes **488,425 gzip bytes**.

[Four reviewed captures](design/screenshots/free-pro-usage/README.md) show actual
Billing components and production CSS with synthetic responses. Both tiers pass
Chromium and supported WebKit journeys at 1440/390/320px: warnings, exhaustion,
refresh, unlimited/legacy compatibility, flag-off hiding, WCAG A/AA, no horizontal
overflow and no page errors. The full **239-case Chromium suite** passes again at
the integrated source, with zero failures.

A separate [50,000-note/full4096-vector local check](development/backend-capacity-results.md#50000-note-action-policy-scale-check-25-october-2026)
observed 608 ms median and 614 ms maximum/p95 over ten warm sequential recalls, with
866,091,008 bytes of embedding storage and zero paid provider calls. This does not
qualify production throughput, cold-cache performance or profitability; unchanged
research/audio exposure can exceed the introductory price. No retained database,
production flag, paid provider, subscription, release or deployment was changed.

## Solo-owner account support (25 October 2026)

Settings → Admin now offers a paginated **People & access** directory and one
account inspector for **Usage**, **Account**, and **Access**. Fixed aggregate
reports show per-user UTC today/month generation, research and timed speech,
plus note/notebook/active-connection counts even while billing is hidden.
Support adds email-draft/copy-ID/usage-summary shortcuts, a short staff note,
capture/recall edits, reversible suspension and account-filtered recent history.
No new role hierarchy, ticketing system, private-content access or identity-email/
password editor is introduced.

Forward migration **027** retains existing data/counters and adds narrow guarded
reporting/support operations. Backend regressions first fail for missing support
features, cross-action operation-ID reuse, and restored suspension state, then
pass with versioned/idempotent audited edits and recovery reconciliation. Provider
updates cannot clear support suspension; restoring it cannot clear a provider ban.
Self/last-admin guards remain. Non-superuser reporting and raw RLS isolation pass;
no private-content policies are broadened. See the [contract](system-administration.md),
[rollout](deploy.md#admin-support-rollout-027) and [verification](development/testing.md#admin-support-and-usage).

Local source verification passes **406 backend cases** (four optional-service
skips), all **nine artifacts**, root/site lint/types/builds and bundle budgets.
The existing **239 Chromium** cases pass. Real-component, real-API/PostgreSQL
support journeys pass in Chromium and supported WebKit at 1440/390/320px, including
same-operation uncertain-save retry/audit-once, suspend/restore and revocation
concealment, WCAG A/AA, focus return, overflow and page-error checks.
[Six reviewed captures](design/screenshots/admin-support/README.md) use only
synthetic identities. No production schema, account, provider or billing changes
were performed for this work.

## Hosted directory review evidence (25 October 2026)

Real production **1.11.3** browser tests use only a dedicated synthetic reviewer.
ChatGPT executes explicit save, fresh-chat recall, exact inspection, metadata-
preserving version-fenced correction and exact retained soft deletion, plus three
separately answered negative scenarios. Both hosts deny note access before separate
Grove approval; Claude subsequently reads the same ChatGPT-authored correction and
executes its own synthetic notebook save/correction/history checks. The
[reviewer walkthrough and boundaries](design/review/hosted-chat/README.md) distinguish
these hosted results from the earlier direct-MCP tests and from directory approval.
Credentials stay in private portal fields. This is evidence only, with no runtime,
schema, feature-switch or production deployment change.

## System roles and complimentary access (25 October 2026 UTC)

Settings → Admin provides exact-email/user-ID account lookup, separate system roles
and Standard/Pro/Unlimited access, required reasons and recent changes. Versioned,
audited operations retain retry identities; a lost response cannot duplicate a
grant. Role discovery reuses the session-owned cache, while protected reads/writes
always check current authority. Temporary discovery failures retain an explicit
retry rather than falsely reporting role denial.

Forward migration **025**, after speech-cache 024, creates no default admins. Narrow
owner-held functions expose only account metadata; ordinary users, keys, OAuth
agents and workers cannot manage roles or grants. Existing private-content RLS and
Stripe subscription records are unchanged. Complimentary Pro/unlimited access is
independent of purchases; unlimited preserves shared safety limits. Restore
reconciliation cannot revive revoked admin/grant state. See the
[contract](system-administration.md) and [rollout](deploy.md#system-administration-rollout-025).

Integrated source `43ef855` includes Ask defaults/history #122 and passes **380 backend
cases** (four optional-service skips), **nine artifacts**, root/site lint/types/builds,
all **239 Chromium** scenarios and bundle budgets (Notes: **488,425 gzip bytes**). Fifty
CI/release/provider contracts and pinned workflow lint pass. Twelve targeted
admin/migration cases cover non-superuser ownership, inherited privilege denial,
concurrent edits, idempotency, last-admin protection and session revocation during
the global-lock wait. The last case first reproduced stale authorization, then
passed with a fresh post-wait revocation check.

Real-component journeys against a disposable API/PostgreSQL pass in Chromium and
supported WebKit at 1440/390/320px: all grants, role promotion/revocation, same-payload
lost-response retry with one audit, keyboard dismissal, denied-access concealment,
WCAG A/AA and overflow/page-error checks. Both engines also pass after the final
role-discovery retry refinement. [Six reviewed captures](design/screenshots/system-admin/README.md)
contain synthetic accounts only. Native OpenCode/Claude/Codex smoke checks pass.

The original pre-rollout readiness was separately recorded in private operator custody.
At that checkpoint the verified owner was active and the database was at 023. An encrypted
backup passes full archive decode/validation. Owner-approved read-only Spaces
inspection confirms lifecycle expiry covers only `exports/` and legacy `speech/`, not
`narration/`; existing scoped runtime narration read/write/delete passes and its
synthetic object is removed. The temporary inspection key was privately saved and
revoked with provider/Doppler readback. No bucket rules, live roles, billing flags,
production schema or deployed source changed during feature verification.

Conflict-resolution integration preserves tier PR **#123 (`187f2ea`)**, including
025 → 026 migration order and duration-based meters. New regression-first cases
prove unlimited generation/research/duration do not treat null allowances as zero;
independent non-generation budgets, speech attempts and global research spending
remain bounded. The combined backend passes **397 cases** (four optional skips)
and nine artifacts. Admin and Free/Pro/Unlimited Billing journeys pass in both
Chromium and supported WebKit at 1440/390/320px, including legacy-character display,
unlimited meter concealment and no paid upsell for complimentary grants.

## Self-contained directory tool metadata (25 October 2026)

All 14 existing MCP tools publish the same human-readable top-level title and
`annotations.title`. Three descriptions now describe only their own operation,
retaining full-replacement metadata, authored history and reversible-archive
semantics without cross-tool recommendations. No tool, schema, grant, owner-only
check, source label or migration changes. Two regressions fail before the fix and
all **10 directory/client-boundary cases** pass afterward through the real MCP SDK.
Root lint, types, build and all **nine packed artifacts** pass. This is source verification, not a claim that
production scanners have observed the new metadata or that Claude policy eligibility
has been resolved. [Current hosted status and limits](hosted-chat.md#official-directory-submissions).

## More generous Free/Pro allowances (24 October 2026)

Free allows **1,000 generation requests and 20 research calls/day**; Pro allows
**5,000 and 100/day**. Monthly defaults are 31 daily allowances. Transcription and
read aloud independently receive **2 hours Free / 8 hours Pro per month**. Shared
defaults, validated configuration and Compose agree, including explicit zero
overrides. Cloud tier admission replaces blocking legacy account guards while
self-hosted/flag-off limits and installation-wide research spend remain intact.

Forward migration **026** adds synthesis duration beside retained character/attempt
counters. Pre-dispatch reservations serialize across API/workers; valid publication
settles to measured MPEG frame time. Failed/uncertain attempts retain reservations,
cache hits/replays do not charge again, and unknown historical/old-writer attempts
receive a conservative bound without deleting or resetting usage. Explicit API
units support honest hour labels and legacy-response compatibility. The
[rollout](deploy.md#tier-allowances-and-speech-duration-rollout-026) requires owner
migration, renamed duration configuration and coordinated API/worker/site delivery;
existing per-item recording limits do not become long-lecture ingestion support.

Regression-first cases reproduced old defaults, blocking Pro guards, character
accounting, concurrent TTS overspend and missing migration accounting before fixes.
Final local verification passes **381 backend/service tests** (four optional
RabbitMQ/S3 skips), **233 Chromium cases**, all **nine packaged artifacts**,
root/site lint, types and builds, matching rendered API/worker Compose defaults and
bundle budgets (Notes **489,087 gzip bytes**). Both-engine actual-component Billing
journeys pass at 1440/390/320px, including WCAG A/AA, hour/legacy/custom units,
exhaustion, checkout recovery, keyboard refresh, plan changes and flag-off hiding.
[Four reviewed captures](design/screenshots/billing-tier-limits/README.md) show only
the relevant desktop/phone states.

The **$5 price is introductory**, not a margin guarantee. The
[cost report](development/tier-costs.md) provides verified public rates, transparent
full-use/course-use calculations, measured retained voice-sample sensitivity and
missing actual-invoice/infrastructure inputs. No paid model calls, provider-state
change, billing activation, production migration or deployment was performed.

Integration of Ask tools/history **#122 (`e958a15`)** preserves both delivery and
testing histories. The combined source passes **383 backend cases** (four optional
skips), **239 Chromium cases**, nine artifacts, root/site lint/types/builds and
bundle checks (Notes **489,196 gzip bytes**). Both-engine Billing journeys pass
again; the four relevant captures remain byte-identical after the Ask-only styles
and cache integration. No provider or rollout setting changed during integration.

## Remembered Ask tools and clearer history (24 October 2026)

Tools now saves each changed switch to account defaults automatically, across
sessions and restarts. Before the first message it saves without creating an empty
conversation. Saved-chat changes retain their version check and update the chat
and changed defaults atomically; simply reopening an old chat leaves defaults
alone. Ordered workspace writes survive navigation, cancel stale reads and refresh
other tabs. Uncertain saves retain the message and require confirmation before send.

History has labelled Delete actions, distinct previews, readable metadata and
quiet current/focus treatments. Existing named confirmation, retained deletion,
Cancel/retry and focus recovery keep saved notes intact. Current user/API/cache
documentation replaces the separate default-save instructions.

After integrating speech #119, root/site lint, types, builds, **nine artifacts**,
**368 backend cases** (four optional service skips), **239 Chromium** and **seven
focused iPhone/WebKit** scenarios pass. Fresh Node processes verify saved defaults
after API/service reinitialization; synthetic proxy checks cover PATCH admission,
private/no-store and origin/auth denial. Notes entry is **489,194 gzip bytes** and
the bundle budget passes. [Six reviewed captures](design/screenshots/ask-settings-history/README.md)
record desktop/390/320px, confirmation and tool save/recovery states. This feature
needs no new migration and records local source verification, not production rollout.

## Text-addressed read-aloud cache (24 October 2026)

Migration **024** stores exact saved-text SHA-256 and voice/profile-aware cache
metadata with private derived audio. Matching audio persists independently of
24-hour request receipts; text edits retain previous versions for seven days.
Reverting before expiry reuses the original object without inference. Publication
retains source, session, consent, profile, restore and lease guards. Cleanup
irreversibly claims expired objects before deletion, including when an editing
transaction began before the expiry boundary.

Production read-only investigation found the alternate voices disabled by an
absent `MINIMAX_TTS_ENABLED` on both API and worker; both provider keys are present.
Both components already use S3 artifacts. The [rollout](deploy.md#content-addressed-speech-cache-024)
documents flag activation, the forward migration and lifecycle-independent
`narration/` storage. That initial investigation did not change production.

The owner subsequently requested Vercel control. `minimax-tts-enabled` is created
and verified On in production, Off in preview/development. API/worker use their
existing server-only `FLAGS` credentials; availability, enqueue, cached reads and
worker dispatch/publication check the global flag dynamically. Missing/error
decisions deny only the alternate voices. Self-hosting without FLAGS keeps its
environment opt-in. Source deployment/migration remains pending; creating the flag
does not activate it in the currently deployed older binaries.

After integrating hosted-chat #116 and the flag follow-up, root lint, types, build, **366 backend/service tests** (four optional service
skips), **nine packaged artifacts** and **seven deployment contracts** pass.
Regression-first checks reproduced revision-bound reuse, one-day expiry and a
cleanup/revert race, then pass with the fix. Populated 023→024 preservation and
loopback S3 request metadata also pass. Preferences/privacy copy replaces the
stale one-day promise. Website lint, types and production build plus **20 focused
Chromium settings/public-page/hosted-chat checks** pass; no layout or interaction change
requires new screenshots.
The flag follow-up additionally verifies disabled cached reads, pre-send and
post-inference worker guards, error fallback and environment/flag precedence.
Root/site static/build checks and all nine artifacts pass again on this source.

## Hosted ChatGPT and Claude setup (24 October 2026)

Installation and Connections distinguish ChatGPT/Claude web from native coding
agents, with remote URLs, OAuth/DCR guidance, Personal examples and explicit
pending-client refresh/approval. A denied remote tool links the exact authenticated
connection instead of restarting OAuth. Approval forms identify the client and
carry a row-locked state fingerprint: newer scope edits/revocation reject stale
reviews, while normal last-contact updates do not. No new tool, migration, secret,
or source label is introduced. At the owner's request, new connection forms and
native proposals select all action/scope checkboxes, including deletion and all
notebooks; users can narrow them before approving. Existing grants retain saved
choices, and sign-in alone still grants no note access.

Root/site lint, types and production builds, **350 backend tests** (four optional
S3/broker skips), **nine packed artifacts**, **all 233 Chromium cases**, **11 focused
iPhone/WebKit cases**, three native hosts and bundle budgets pass. The backend
guidance and stale-review cases were verified failing before implementation.
Fifty CI/release/deployment contracts, pinned workflow lint and the API Docker build
also pass. Notes entry is **489,087 gzip bytes**, with the editor still deferred.
[Four reviewed captures](design/screenshots/hosted-chat/README.md) cover desktop
and phone, with WCAG A/AA and 320/390/1440px overflow checks.
The all-selected-default follow-up retains explicit narrowed/retry/resume tests;
its compact native permission summary keeps the primary action entirely visible
at 320×640 in both engines without hiding permissions or loosening the assertion.

Official-directory preflight adds titles to all existing tools and optional API-only
public domain proof at `/.well-known/openai-apps-challenge`. Four isolated tests
cover exact text/headers/HEAD, absent/invalid configuration, no database or identity
calls, private MCP's unchanged 401 and real-SDK discovery. Three expectations failed
before implementation. This adds no migration or new memory tool. An overlapping
local run timed out in an unchanged packaged telemetry control and two browser
cases; all passed unchanged in isolation, then the complete nine-artifact and
233-case browser suites passed without relaxed timeouts/assertions.

Initial real ChatGPT/Claude discovery selected DCR; CIMD is not advertised. That
check did not create/approve a memory connection or deploy this feature. An official
OpenAI package draft has since been created after publisher verification, but
domain setup, reviewer access and live tests remain review gates; no accepted or
published directory listing is claimed. **End-to-end hosted-client acceptance
against this source candidate remains unverified**, pending the protected rollout
and real sign-in/save/recall/refresh/revocation in both hosts. This is not an automatic
every-chat memory hook. [Setup, permissions and rollout limits](hosted-chat.md).

## Billing lifecycle review follow-up (24 October 2026)

Post-merge [#112 review](development/billing-review.md) reproduced and repaired three
Checkout edge cases: blocked resubscription after a subscription ends, expired URLs
returned from lost-response replays, and deletion blocked by attempted expiry of an
already-paid Checkout before renewal cancellation. Current session retrieval replaces
historical POST state; only an exact canonical terminal subscription permits reuse
of the completed-checkout slot. Ongoing/missing subscriptions remain fenced.

Root/site lint, types and production builds, **nine packed artifacts** and **334
backend/service tests** pass (four optional RabbitMQ/S3 skips). Twenty billing cases
cover lifecycle/RLS/quota behavior, with separate pricing/migration tests; research
and speech suites verify provider dispatch stops at their allowances. Concurrent
Free/Pro monthly generation reservations share API/worker caps while note writes,
reads and exports remain available. Existing Billing journeys pass again in Chromium
and container iPhone/WebKit at 1440/390/320px, including checkout/portal navigation,
double-submit, payment recovery, cancellation display, flag-off hiding and WCAG A/AA.

This is synthetic provider and disposable PostgreSQL verification, not a paid Stripe
lifecycle or production acceptance claim. No UI change, new screenshot, migration,
provider configuration or deployment is introduced; the existing gallery remains
applicable. Real payment, renewal and endpoint-delivery checks remain rollout gates.

## Website support and contact (24 October 2026)

Public `/support` and `/contact` pages use `support@usegrove.cloud`. Current
policy, marketing, recovery, sign-in and workspace help destinations are updated;
the public contact module is safe for client imports. Canonical/social metadata,
sitemap entries and safe reporting guidance accompany the pages. No auth policy,
provider configuration, API, billing, deployment or production release is changed.

The app-specific website contact supersedes the shared website email snapshot
in the earlier billing entry below. Stripe's company-wide reply-to address remains
separate; this work does not change that provider setting or the merged billing behavior.

Root/site lint, types, builds, nine artifacts and **227 Chromium cases** pass.
Eight additional local axe audits cover both pages at 320/390/768/1440px.
Local WebKit is blocked by missing host browser dependencies, not counted as a pass.
See [route/verification details](website-support-contact.md) and the
[reviewed browser gallery](design/screenshots/website-support-contact/README.md).

## Advertising registration handoff (24 October 2026)

Source adds a server-qualified, content-free `/welcome` page and consent-gated
AdRoll account-created segment delivery. Default auth/private/shared tracking
exclusions remain; fresh-document navigation and no-referrer headers protect the
boundary. This is source implementation, not production rollout or paid-ad launch.
See [contract and verification](advertising-conversions.md) and
[local screenshots](design/screenshots/registration/README.md).

## Minimal billing and shared support contact (24 October 2026)

Billing uses one open settings sheet: current plan, labelled usage meters,
short reset/renewal dates, compact included allowances and a visible $5 upgrade
action. Payment recovery has one Update payment control. Customer copy omits
provider names, API limits and internal accounting explanations. Settings observes
link-size changes so late font loading keeps the full active tab visible on phones.

Root/site lint, types and production builds, nine artifacts, 22 focused settings/
cache cases and three final navigation cases pass. Updated Chromium and iPhone/
WebKit journeys at 1440/390/320px verify meter labels/values, visible price/action,
checkout failure/retry and double-submit, cancellation, hidden-flag state, keyboard,
WCAG A/AA and overflow. [Twenty refreshed captures](design/screenshots/billing/README.md)
record the review. Sixteen public-site/shared-reader cases also pass after all
website help, legal and authentication contacts adopt `hello@bramblelabs.co`.

Stripe's live customer support/reply-to address is saved and verified as that same
address. Custom sending-domain and mailbox forwarding progress is recorded in the
[billing rollout](deploy.md#billing-rollout-023); no payment or application release
is implied by these provider settings.

## Five-dollar pricing and hidden billing (24 October 2026)

Owner-selected **$5 USD/month** is configured in Vercel's numeric
`billing-pro-monthly-usd` flag. The API resolves immutable monthly Stripe Prices
under the Grove Pro product, rejects stale browser quotes and preserves existing
subscribers' product-based entitlement. The boolean flag now hides **all** billing
navigation, page, status and portal responses when off; webhooks and deletion
cancellation continue. This supersedes the initial paused-portal behavior below.

Owner-authorized live configuration creates the Grove Pro product/price, dedicated
portal, webhook and restricted runtime key. The key verifies provider reads and a
live 500-cent/USD Checkout which is immediately expired without payment/subscription.
Actual Vercel SDK evaluation confirms billing=false and monthly USD=5. Credentials
are saved and read back in Doppler and ignored 0600 local inventories. The price
catalog and flags are configured; the API/worker schema/runtime rollout and normal
protected source deployment remain outstanding. [Operator record](deploy.md#billing-rollout-023).

Integrated development through note tools #111 and voice selection #109. Root/site
lint, types and builds, **323 backend tests** (four optional-service skips), **nine
artifact checks** and all **223 Chromium scenarios** pass. The updated $5/hidden-flag
Billing journeys pass in both engines at 1440/390/320px. Notes entry is **488,218
gzip bytes**, editor deferred. The application price resolver also reads the live
Vercel amount and resolves the existing 500-cent Stripe Price without creating a
new price or charging a customer.

## Flagged Stripe subscriptions and usage (24 October 2026)

Grove Cloud starts on Free, with configurable Pro allowances for generation,
research, transcription and read aloud. Stripe-hosted Checkout and customer
management use configured recurring Price IDs. Settings shows current subscription,
upgrade allowances, remaining usage and daily/monthly reset dates; writing and
exports remain available at the AI allowance. No prepaid credits or usage overage
charges are introduced. See [billing contracts and configuration](billing.md).

The server-side Vercel `billing-enabled` flag defaults false and gates new checkout,
navigation and quota enforcement across website, API and workers. The initial
paused-portal behavior was superseded by the hidden-billing follow-up above; only
signed webhooks and deletion cancellation remain available while off.
Migration **023** adds tenant-isolated billing state without changing
retained content. Current Stripe state, not redirect/event arrival order, decides
entitlement. Persisted checkout operations fence duplicates, lost responses and
interval races; deletion recovers/invalidates uncertain checkout before cancellation.

Local root/site lint, types and builds, **304 backend tests** (four optional-service
skips), **nine packaged artifacts** and all **223 existing Chromium scenarios** pass.
Real-component Billing journeys also pass in Chromium and container iPhone/WebKit
at 1440/390/320px: Free/exhausted usage, disclosed monthly/yearly test prices,
checkout/double-submit, Pro/cancellation, paused portal, errors/retry/past-due,
keyboard focus, WCAG A/AA and no overflow/browser errors. Notes entry is **488,128
gzip bytes**, editor deferred. [Twenty reviewed captures](design/screenshots/billing/README.md)
use synthetic accounts and loopback Stripe responses, not real payments.

Regression-first checks include non-owner RLS, a non-superuser migration owner,
populated **022→023** preservation, concurrent caps, recognized/expired subscriptions,
UTC accounting even with a non-UTC database session, provider dispatch and canonical
webhook reconciliation. Unconfigured Next routes deny checkout and Flags Explorer
discovery denies anonymous requests. The initial browser run lacked the documented
production telemetry build variables; rebuilding with synthetic telemetry identifiers
passes the complete suite without changing its assertions.

This initial verification used no Stripe account configuration or payment. The
later catalog setup is recorded above; payment, cohort activation, production
migration and deployment remain separate [023 rollout](deploy.md#billing-rollout-023)
steps, not implied by this source delivery.

## Workspace session recovery (24 October 2026)

Workspace requests wait for a Clerk session token and send it explicitly. An HTTP
401 receives one shared forced refresh and a byte-identical replay. Refresh outages
and ten-second token timeouts keep snapshots/drafts mounted with load/save retry;
permission 403s stay local to the resource. Current-generation missing tokens or a
rejected replay still clear private state. Cancellation and live user/session checks fence late
work; newer typing and original mutation identities survive recovery.

Application source `48aa5a3` passes root/site lint, types and production builds,
**nine packaged-artifact checks**, the backend RS256 authorization test and **12
existing iPhone/WebKit regressions**. The full **223-case Chromium suite** passes
with the telemetry-enabled production build. **Fifteen recovery journeys per engine** pass
in Chromium and iPhone-emulated WebKit with zero page errors. Nine additional
transport groups verify bounded replay, cancellation, cache retention/teardown and
permission handling. Four installed-Clerk-SDK cases verify explicit-Bearer precedence
and expired-token rejection with zero network calls. Verification reproduced and
fixed cancellation starting an unnecessary refresh and search403 cancelling its own
query through the note-detail eviction path.

Notes entry is **488,617 gzip bytes**, with the editor deferred. Updated workspace,
cache ownership and verification guidance accompanies [six synthetic recovery
captures](design/screenshots/session-recovery/README.md). These checks establish
the recovery behavior; the initiating request from the reported physical Safari
incident remains untraced.

Follow-up `1d8968a` carries credential generations through replay: an older denial
cannot clear a session after a newer refresh has started or succeeded. The failed
operation retains its draft and retry ID without another automatic replay. Dispatch
also rechecks telemetry opt-out while retaining a stricter original choice. Invalid
error envelopes preserve their HTTP status rather than triggering transient retries.

Integrated with voice-selection development `f159036`, the follow-up passes fresh
root/site lint, types/builds, nine artifacts, backend auth, 12 existing WebKit cases,
the full **223-case Chromium suite**, all fifteen recovery journeys plus two correction journeys per engine, and four
telemetry preference-transition cases per engine. Direct checks cover eight review
groups including 24 malformed error envelopes and pending/late token races. Notes is
**488,769 gzip bytes**, editor deferred. [Two additional reviewed captures](design/screenshots/session-recovery/README.md#superseded-replay-follow-up)
show draft preservation after a superseded denial.

Final integration with note-management `d8cf0c1` preserves lifecycle pruning and
both documentation histories. Fresh root/site gates, nine artifacts, backend auth,
**223 Chromium**, **12 WebKit**, recovery/correction journeys in both engines and
the transport checks pass. An integration probe verifies that a replayed lifecycle
Apply prunes deleted detail/list sources with the same operation body. Notes is
**488,937 gzip bytes**, editor deferred; original capture provenance is retained.

## Note and notebook management tools (24 October 2026)

Remote MCP and every bundled bridge share **14 tools**: the existing save/recall/
search/delete operations plus exact reads/history, metadata-preserving partial
updates, atomic filing, archive/restore and paginated notebook create/rename/move.
Source/destination grants, versions, retry identities and owner-only subtree
administration remain enforced. Deletion is retained soft deletion, not physical
erasure; stale tool/skill/approval wording is corrected.

Ask Grove adds explicit archive/restore/delete previews with full subtree counts,
existing-notebook parent moves and version-checked Apply/Undo. Delete has no Undo.
Source allowlists, exact conversation scope, overlap checks and complete fingerprints
prevent unseen/stale batches; recovery invalidates lifecycle previews. Retained
drafts block Apply. Metadata-only notifications prune deleted sources in offline
tabs, not just invalidate them for an unavailable refresh.

On application source `98742ee`, root/site lint, types and production builds, all
**nine packaged-artifact checks**, **three pinned native hosts**, **310 backend
tests** (four optional RabbitMQ/S3 skips) and **34 release/deployment contracts**
pass locally. PostgreSQL uses disposable data and non-owner API/worker roles.
Final-source repeats pass the full **223 Chromium** suite and **12 focused
iPhone/WebKit** checks. Actual-component
journeys pass subtree preview/no-write/Apply/Undo, note lifecycle, notebook moves,
disabled tools, interrupted Apply/retry, retained drafts and offline-tab deletion
in both engines. Desktop/390/320px axe and overflow checks pass.

Notes entry is **488,327 gzip bytes**, editor deferred, within its existing budget.
[Nine reviewed captures](design/screenshots/note-tools/README.md) use synthetic
notes and deterministic generation with the actual disposable API. No paid-model
intent accuracy or production rollout is claimed. No schema migration is required;
deploy the matching API before upgraded clients and website. [API](server.md),
[client](client.md), [Ask](ask-tools.md) and [verification](development/testing.md)
document the new contracts and retained authorization boundaries.

Merge verification integrates voice-selection #109 (`f159036`) without overlapping
Ask/MCP/runtime edits. The combined tree passes root/site lint, types and builds,
nine artifacts, three native hosts, 310 backend tests (four optional-service skips),
223 Chromium and 12 focused WebKit checks, both-engine note-management journeys,
50 automation contracts and workflow lint. Notes entry is 488,208 gzip bytes with
the editor deferred. Both feature histories and original capture provenance remain.

## On-demand voice selection (24 October 2026)

Read aloud keeps playback compact and exposes **Change voice** through its options
menu. Settings shows **Reading voice / current name / Change** only while Read aloud
is on. Compact voice rows pair a quiet selection highlight with labelled preview
icons and brief helper text. One chooser separates candidates and audition from
**Use voice**:
browsing/cancelling and same-voice confirmation preserve prepared narration; a
confirmed different voice releases old playback and fences unfinished requests.
Settings confirmation changes only its existing Save/Discard draft.

Source `1506a85` passes root/site lint, types and production builds, **nine artifact
checks**, **19 relevant speech tests**, **31 existing Chromium models/cache cases**
and **four existing iPhone/WebKit Settings cases**. **Fifteen actual-component journey
groups per engine** verify zero-write browsing, independent samples, save races,
late/lost replies, cancellation, unavailable/off states, keyboard focus, responsive
bounds and WCAG A/AA. The Notes bundle gate passes with the editor deferred.
[Eight reviewed captures and verification details](design/screenshots/speech-voice-flow/README.md)
document desktop/mobile playback, chooser and Settings. Speech, product-copy and
testing guidance now describes the on-demand flow; the prior inline-picker gallery
is marked historical.

## Selectable read-aloud voices (24 October 2026)

**Reed · Basic** retains the existing OpenAI default; **Willow**, **Cedar** and
**Brook** add curated MiniMax presets. Read aloud remembers the account's choice;
Speech settings uses Save/Discard. Samples, Prepare audio and Play remain explicit.
Serialized preference writes retain newer choices, and switching voices releases
playback and fences/cancels superseded requests. Cancellation reports confirmed
server state or offers recovery when confirmation is unavailable.

Forward migration **022** adds the default and per-voice profile map without changing
consent flags/generations. Immutable task identity and per-voice profile checks
support exact routing, omitted-default replay and A→B→A cache reuse while fencing
legacy/mismatched workers. Restore retains the current default and expires derived
audio. MiniMax transport bounds wire/decoded sizes, validates final hex/MP3 output,
sanitizes failures and renders provider control notation as prose.

Local verification passes root/site lint, types and production builds, **nine
packaged-artifact checks**, and **293 backend tests** with four optional-service
skips. The existing Chromium suite passed **221 cases**, with its two trace-directory
collisions passing on isolated rerun; **four existing iPhone/WebKit settings cases**
pass. **Eleven voice journey groups per engine** cover saves, late/lost replies,
cancellation, playback, keyboard focus, 1440/390/320px bounds and WCAG A/AA. Notes
entry is **488,115 gzip bytes**, editor deferred; Settings is **480,498 gzip bytes**.

Live MiniMax system listing and all three synthetic samples succeed. Numbers,
multilingual prose, control-like notation and a 3,000-unit narration synthesize and
decode; the maximum produces **1,662,036 bytes in 7.348 seconds**. Reed's sample is
omitted because OpenAI credential access was unavailable. Subjective listening and
language quality remain unverified. [Twelve reviewed captures and provider evidence](design/screenshots/speech-voices/README.md)
include sample provenance/checksums and distinguish fixture playback from provider
qualification. Updated [speech/privacy](speech.md), product-copy and testing docs
describe the behavior and MiniMax's current processing terms.

`MINIMAX_TTS_ENABLED` defaults false and explicitly gates reuse of the server-only
MiniMax key. The [coordinated 022 rollout](deploy.md#selectable-speech-voices-022)
requires matching API/worker binaries and a separate owner migration/activation.

## Feature-focused product copy (23 October 2026)

Speech controls/preferences, sign-in and feature-availability messages describe what
people can do without naming backend vendors or installation details. Speech prompts
name the exact preference and retain visibly underlined settings links. Privacy copy
keeps external processing, inputs, controls, retention and irreversible-send disclosures
using recipient categories. Operator configuration and source attribution stay accurate.

Root/site lint, types and builds, all **nine packaged-artifact checks**, bundle budgets,
the full **223 Chromium** suite and **six focused iPhone/WebKit** settings cases pass.
Actual-component journeys in both engines verify 1440/390/320px copy, bounds and WCAG
A/AA, settings navigation, unavailable speech/sharing and zero writes when opening
controls. Notes entry is **488,014 gzip bytes** with the editor deferred. No provider
configuration or deployment changes are included.

The requested default follow-up keeps transcription off and starts Read aloud on
for new accounts. Forward migration **021** changes only the future-account default;
saved choices and preference versions are untouched, and generation/playback remain
explicit actions. New default/upgrade regressions first failed for the old default
and missing migration; all three new cases, including saved-choice preservation,
pass in the full **254-backend-test** run (four optional-service skips). Historical
migration tests remain pinned to their advertised upgrade boundary.
The [owner rollout](deploy.md#speech-defaults-021) remains a separate operation.

[Copy guidance](development/product-copy.md) and [five reviewed synthetic captures](design/screenshots/product-copy/README.md)
record the boundaries and evidence. Current speech instructions and availability docs
are aligned; the testing guide now counts all sixteen AI preferences.

## Connection quality — local implementation checkpoint (23 October 2026)

Connections require a specific source-backed bridge and abstain on filing,
templates, ratings and generic topics. Policy-versioned reassessment hides old
results while preserving unchanged-source dismissal intent and fencing stale Undo.
Cleanup shares the substantive duplicate/conflict policy without changing reviewed
Apply/Undo authority. Bounded note/notebook discovery retains short/late facts,
minority hints and independent lexical/vector nominations.

On application `eb64413` and runner `e726c23` (development `ad1b9fe` integrated),
**279 backend tests** pass with four optional-service skips; root/website lint,
types and builds, **nine artifacts**, bundle budgets, **eight affected Chromium**
and **four focused iPhone/WebKit** scenarios pass. Notes entry is **488,019 gzip
bytes**, editor deferred. PostgreSQL/RLS/worker/recovery checks use disposable
resources and non-owner roles. No frontend source changes or new captures.

Deterministic candidate fixtures nominate **18/18 note** and **4/4 notebook**
positive pairs, with separate adversarial template/minority-thread regressions.
These are not live semantic accuracy results. Paid current-policy qualification
remains pending explicit provider/budget approval; the historical old-policy
baseline is 30/38. [Evidence and limitations](development/connection-quality-results.md)
and [coordinated cutover](deploy.md#connection-quality-policy-cutover) describe the
no-new-migration rollout and old-binary/rollback limits. No production activation,
backfill or deployment was performed; this checkpoint does not claim PR readiness.

Test-only agent follow-up #104 is subsequently integrated in `cfbdc46`, with runtime
source unchanged. Fresh root lint/types, nine artifacts, five client-boundary cases
and the complete 279-pass/four-skip backend suite pass on the combined tree.

Owner-approved [draft #105](https://github.com/miniaxolotl/grove/pull/105) now has
passing [full CI 40034164506](https://github.com/miniaxolotl/grove/actions/runs/40034164506)
on `83dd0a8`: all six jobs and GitGuardian pass, including **281 backend tests**
(two optional skips), **nine artifacts** and **223 Chromium scenarios**. The final
test-only follow-up initializes isolated evaluator scratch storage. Live semantic
qualification remains pending; passing CI does not authorize ready/merge/deployment.

## Agent plugin startup and diagnostics (23 October 2026)

OpenCode's Grove bridge now reuses the host executable (Bun runtime mode only for
compiled Bun hosts), fixing the reproduced `spawn node` failure with a restricted
desktop/service PATH. Existing custom/disabled Grove MCP definitions remain respected.
`grove doctor` distinguishes offline CLI checks, explicit packaged-bridge/API probes
and unknown live-host readiness. Diagnosis never installs, starts unrelated MCPs or
writes memories; OAuth refresh occurs only on an explicit API probe. Setup no longer
equates API access with host activation, and existing status JSON semantics remain.

Regression-first fixes reject malformed API envelopes/configuration, preserve caller
cancellation and distinguish damaged credential storage from a new sign-in requirement.
All **189 backend/client tests** pass against a new disposable PostgreSQL database
with non-owner roles (two optional S3/broker checks skipped), as do **seven packed
artifact checks**, root lint/types/build, **50 automation/provider contracts** and
pinned workflow lint on Node 24.21.0/pnpm 10.33.0.

The maintained **three-host Linux x64** suite pins integrity-locked OpenCode 2.1.3,
Claude Code 2.1.309 and Codex 0.164.0, runs in temporary homes/prefixes with synthetic
loopback APIs/models, and takes about 32 seconds locally. It checks native install/
uninstall, four tools, skills, Claude SessionStart and Codex paused automatic-write
denial. Native missing-Node controls fail as expected; OpenCode connects with empty
PATH and its compiled runtime exercises all four bridge tools. Existing CI runs
this suite without a runner/inventory change. No systemwide install, live agent
configuration, actual-model billing or production deployment is included.

Native absolute-runtime overrides, additional OS/host/consumer-runtime matrices and
broader reload/configuration-race hardening remain follow-ups, not implied acceptance.

Review regressions reproduce and fix interrupted-body transport errors, identity-only
credential files and parent-process diagnostic telemetry. JSON syntax failures remain
`invalid_response`; transport failures remain `unreachable`. Local authentication
validation preserves expired refreshable OAuth and never rewrites damaged stores.
Doctor uses bearer authentication without a reporter and opts out upstream. An
enabled-build control verifies that telemetry is genuinely active while the doctor
creates no identity or analytics requests. All **nine packed-artifact checks**, **nine
client/boundary tests**, three pinned native hosts, root lint/types/build and **50
automation/provider contracts** plus workflow lint pass after integrating #102.

## Note context actions (23 October 2026)

The editable note surface has app-matched text, image, link and recording right-click
menus in writing/source/preview, with keyboard invocation and viewport-bounded action
rows. Text edits preserve selection, normal Undo and autosave. Media uses parsed exact
source ranges, authenticated originals and existing playback/transcript controls;
reference removal never deletes retained media/history. Native fields and public
readers retain their existing controls. [Behaviour/limits](note-context-actions.md).

Root/site lint, types and builds, five packed artifacts and bundle budgets pass.
The unchanged full **223 Chromium** suite and **12 focused WebKit** cases pass.
Targeted journeys also pass in both engines: pointer/keyboard selection, format/Undo,
copy/paste denial and delayed-selection guards, repeated-image CRLF identity,
remove/Undo, original PNG download bytes, source-end targeting, lazy recording
playback/mute/transcript, disabled upload guards and 1440/390/320px bounds. Verification
uses synthetic fixtures/loopback media, not personal or production data. Notes entry
is **488,018 gzip bytes** and the editor remains deferred. No backend/schema/provider
or deployment change. [Reviewed gallery](design/screenshots/note-context-actions/README.md).

Merge review integrates landed speech without changing its backend/runtime contracts.
Five reproduced findings are corrected: CommonMark URL decoding, generation-fenced
clipboard edits after mode/identity/read-only transitions, normalized paste offsets,
incremental shortening of oversized drafts and persistent Preview removal focus.
Thirteen focused actual-component journeys pass in each browser engine, including
normal delayed-action completion and keyboard Undo. Notes entry is **488,021 gzip
bytes**, with the editor still deferred. Original gallery/build provenance is retained.
Combined verification passes all **223 Chromium / 12 focused WebKit** cases,
**240 backend cases / four optional-service skips**, root/site lint/types/builds,
five packaged artifacts, 50 automation/provider contracts and workflow lint.

## Ask note limits and organization follow-ups (23 October 2026)

Ordinary saves, Ask previews, organization batches and assistance action lists now
share one account-locked note-capacity check. Over-limit batches roll back all
writes and retain their previews; edits, moves, replay and Undo remain available
at capacity. Organization history pairs each created note with its applied ID and
bounded excerpt, while follow-up retrieval still checks current scope and versions.

All six new real-PostgreSQL regressions failed before the fixes and pass afterward.
Root lint/types/build and five packaged-artifact checks pass. The complete backend
suite after integration with media/speech passes **246 tests**, with four optional
RabbitMQ/S3 skips and zero failures.
Verification uses disposable databases and non-owner runtime roles; no migration
is required.

## Agent plugin startup (23 October 2026)

OpenCode's installed Grove plugin loaded its skill/automatic context while its MCP
child failed with `NotFound: ChildProcess.spawn (node ...)`: the background host
did not inherit the shell's Node/version-manager PATH. The plugin now reuses its
host executable, selecting Bun runtime mode for compiled OpenCode binaries, without
overwriting an existing Grove MCP configuration.

The packed OpenCode v2.1.3 smoke test reproduces the failure with an empty executable
PATH before the change and connects afterward. Node 24.21.0 / pnpm 10.33.0 root
lint, types, build, all **five artifact tests** and **four client tests** pass.
Claude Code **2.1.309** and Codex **0.164.0** were installed only under
`/tmp/opencode`, with isolated HOME/XDG/client directories. Both native hosts discover
and execute all four packaged tools against an authenticated loopback fixture.
Claude's SessionStart context and both skills load; Codex's two skills and paused
automatic-write denial pass. Claude's manifest validates; its missing directory
listing icon is advisory, not a startup failure. Claude/Codex still require Node
22+ on their host PATH. These are synthetic local checks, not live account/model
acceptance; no systemwide installation, active-host configuration or release changed.

## Explicit transcription and read aloud (23 October 2026)

Stacked on recordings #95, speech adds independent default-off transcription and
read-aloud preferences, OpenAI whisper-1/tts-1 adapters and explicit bulk jobs.
Machine transcripts are separate suggestions; copying to a draft, saving authored
history and inserting through normal autosave/Undo are deliberate user actions.
Read aloud reuses the minimalist player and identifies the AI-generated voice.
Opening notes, enabling preferences and anonymous public reads never start inference.

Migration 019 fits between recordings 018 and Ask tools 020. Conservative attempt,
duration/text and shared inference budgets, global provider slots, cooperative
deadlines and source/profile/preference/session/restore fences bound work. Generated
MP3 uses the existing private temporary artifact store/cleanup; originals and saved
transcript history remain retained. Restore clears derived speech without reviving
old output. [Contracts, privacy and explicit rollout](speech.md).

Integrated source `856cb39` preserves #95 `93983e5` navigation/research. Local gates
pass: **240 backend cases / four optional-service skips**, **223 Chromium** and
**12 focused iPhone/WebKit** navigation cases, root/site lint/types/builds, five
packed artifacts, release/deployment contracts, workflow lint and bundle budgets.
Notes entry is **487,997 gzip bytes** with the editor deferred. Both-engine real-API
speech journeys cover opt-ins, candidate/save/use, exact cache reuse, playback,
retry/cancellation through both close controls, heading navigation/pinning and
1440/390/320px accessibility. [Current synthetic captures](design/screenshots/speech/README.md)
record source/build identity and no-JavaScript public-reader verification limits.
Review follow-up replaces regex narration with CommonMark node extraction and a
profile cutover: ten Markdown privacy cases plus the old-profile regression pass.
Uncertain enqueue/retry identities remain cancellable on close/in-app navigation;
both browsers pass held/lost-response cancellation journeys after reproducing them.

A bounded real OpenAI check synthesized and transcribed only synthetic speech with
the selected models; this is API/codec evidence, not general quality or device
qualification. Credentials stay in private custody. No production migration,
deployment, speech activation or PR merge is performed by this slice.

## Custom recording player (23 October 2026)

Recording playback now uses a quiet inline strip rather than browser chrome:
workspace typography/colours, one play/pause control, slim seeking, elapsed/total
time, speed and mute. No card border, decorative waveform or extra dependency.
Private loading/transcripts are unchanged. Sources attach on Play in the enhanced
player, including WebKit; leaving the player stops playback. Public readers keep
native controls before hydration and without JavaScript.

Real-component/disposable-API journeys pass in Chromium and mobile/touch WebKit:
deferred loading, playback/pause, keyboard/seek/rate/mute, end/replay, HTTP503 retry,
unmount cleanup, 1440/390/320px bounds and WCAG A/AA. Both engines also pass actual
production-Next public playback with and without JavaScript and no transcript
controls; disposable links are revoked afterward. Focused checks cover Space,
Home/End/arrows, preselected speed, 44px buttons, reduced motion and forced colours.
[Reviewed captures](design/screenshots/recordings/README.md) record the final strip.
Final local verification passes root/site lint, types and production builds, five
packaged-artifact checks and all203 Chromium scenarios. Bundle budgets pass;
Notes entry is483,386 gzip bytes and the editor remains deferred.
No production deployment, migration or speech-provider request is performed.

## Recordings — stacked continuation

Migration018 adds PCM WAV duration validation and independently versioned retained
transcripts. The compact Add media menu contains image, recording and audio-upload
actions; active capture has explicit Stop/Cancel feedback. Originals reuse image
storage, tenant/revision guards and quotas. Playback supports scoped Range/HEAD;
transcript Use inserts through normal editor history. TAR includes WAV/text
sidecars and v3 exports page bindings/transcript history separately. PDF resolves
only actual image nodes. [Feature and limits](recordings.md).

Shared input buffering, MIME/reference metadata, uploads and media URL construction
replace duplicated image/audio paths. Initial verification passes184 backend/service
cases (four optional-service skips), root/site static checks and builds, five packed
artifacts and bundle budgets. The real-component synthetic-microphone journey covers
capture, track cleanup, playback, transcript save/use, cancel and TAR/PDF. Visual
review found and corrected inline/baseline placement and inherited textarea sizing.
All203 Chromium checks pass. The corrected real-API journey passes in Chromium
(synthetic microphone plus ended-track checks) and WebKit (WAV upload fallback,
playback, transcript/save/use and TAR/PDF) at desktop/390px. Current playback keeps
its source URL through note autosave. Physical microphones remain unqualified.

## Saved-note images — stacked continuation

The follow-up supports file drop throughout the note workspace and moving an
existing preview image with pointer drag or Move up/down. Both engines verify
single-reference movement, Undo and normal autosave; 14 affected Chromium checks
pass again. Source-store tests now include the scoped-Spaces lifecycle receipt.

Explicitly authorized NYC3 provisioning created private source/temporary buckets
and independent bucket-scoped keys. Live readbacks verify anonymous403,
conditional412, cross-bucket denial, no source lifecycle and one-day temporary
exports/speech expiry. Keys are in isolated Grove Doppler configs and ignored0600
secrets.md; temporary operator keys are revoked and runtime deployment is unchanged.
Actual source-store readiness passes with the scoped key and exact-bucket operator
receipt, resolving the #86 lifecycle-inspection incompatibility without broad
runtime credentials. See [current configuration](media.md#configuration-and-rollout).

Migration017 binds tenant-owned immutable image objects to every saved revision.
Session-owner uploads use current-note versions, actual-byte validation, account-
locked attempt quotas and fenced completion. Private/history reads preserve narrow
agent grants; public reads reuse the live share scope and current revision only.
The editor adds upload/paste/drop and ordinary autosave/Undo; readers show images
without fetching third-party URLs. Cloud storage uses private Spaces/S3.

Portable note TAR downloads include relative Markdown, exact originals and a
checksum manifest. PDF embeds authorized raster snapshots. Optional v3 queued
exports include original-media chunks with bounded assembly and source/lease
guards. Recovery invalidates pending uploads and preserves ready objects behind
current tombstones. [Feature, limits and rollout](media.md) and
[three-column reviewed screenshots](design/screenshots/media-images/README.md)
distinguish fixture verification from live provider activation.

Local backend suite: **180 passed / four optional service skips**, including the
populated media upgrade, RLS/grant/ref forgery, quota/lease races, public revocation,
archive bytes, queued media and restore checks. Root lint/types/build and all five
packed artifacts pass, along with 17 release/deployment contracts and workflow
lint. Chromium's real-component/disposable-API journey verifies upload, autosave,
preview, phone bounds, TAR and PDF download; parsing confirms a one-page PDF with
an embedded image. The same upload/preview/TAR/PDF journey passes in WebKit using
the supported Noble container and actual streaming proxy. Production Next public
image rendering works with JavaScript disabled, makes no third-party requests,
and reloads to 404 after synthetic-link revocation. All **203 Chromium** scenarios
pass after removing an unnecessary editor `/me` read and integrating the isolated
dropdown-opacity correction already reviewed in #88.
No cloud bucket, retained database or production configuration is changed.

## Private image foundation — development increment (22 October 2026)

The [image foundation](development/media-foundation.md) establishes immutable
private local/S3 storage and bounded, fully decoded static PNG/JPEG/WebP input,
including explicit APNG rejection and fragment-count-independent buffering.
Original bytes/checksums are preserved. Source storage has no deletion API and
rejects export-directory/bucket/credential overlap and expiring lifecycle rules.
Conditional-write probing uses only unique removable operational scratch objects.

Real disposable storage exposed Garage 2.4.1 ignoring conditional PUT; readiness
now refuses that provider without changing retained test source. Digest-pinned
RustFS 1.0.3 supports private byte-identical storage and immutable concurrent writes;
CI includes that disposable conformance service. These are local/CI observations,
not qualification of deployed DigitalOcean Spaces. No cloud resource was provisioned.

This is **not complete image support**: no upload route, note/revision binding,
schema migration, image UI, archive/PDF integration, recording or speech behavior
is enabled. The primitives default to disabled and are not yet called by runtime.
The image acceptance gates remain prerequisites for exposing them.

Local verification passes on Node 24.22.1 / pnpm 10.33.0: **16 focused media
checks** with both disposable storage fixtures (no skips), root lint/types/build,
five packaged-artifact checks, 17 release/deployment contracts, workflow lint,
new-file formatting and 23 selected documentation links/anchors. No media
database/browser functionality is claimed; exact-head hosted CI remains required.

The storage-direction follow-up enforces **private Spaces/S3 in cloud mode**,
rejecting local storage without fallback. Self-hosting/test adapters remain local
when explicitly chosen. All **17 focused checks** now pass with both disposable
stores, alongside the same root, artifact, release and workflow gates. Spaces
setup distinguishes its datacenter endpoint from the SDK signing region; live
bucket activation remains separate. UI captures will use a three-column PR preview
and a documentation index when there is UI to review; none exists in this increment.

## Media plan review (22 October 2026)

The [images, recordings and speech review](development/media-plan.md) reconciles
the recovered setup-only plan with v1.11.0 source and the still-open refinement
PR #82. It separates proposed feature scope from shipped behavior and identifies
storage retention, revision-scoped authorization, streaming upload, export/recovery
and speech-provider decisions that must precede implementation. The three-slice
order remains images → recordings → speech. No media code, migrations, provisioning
or release is included. Related stale documentation now reflects retained deletion,
14 AI controls, all existing export record types and external execution-plan paths.

Local review verification passes on Node 24.22.1 / pnpm 10.33.0: root lint,
type checks and build, all five packaged-artifact tests, 17 release/deployment
contracts, workflow lint and 30 local documentation links/anchors. No new media
database/storage/browser behavior is claimed; feature qualification remains gated
by the review's acceptance matrix and successful exact-head PR CI.

## Workspace navigation (23 October 2026)

Search shows query-aware plain-text passages and literal highlights, with notebook
paths in global search and Ask/Search. Sidebar expansion/scroll and optional outline
pinning remember bounded account-owned UI metadata, never content or queries.
CommonMark/GFM heading identities drive searchable Jump to heading, Commands and
`Ctrl`/`Cmd` + `Alt` + `O`, private saved-note section links and the wide contents rail.
The same outline rows work in the compact inspector, with clipboard fallback,
current-section tracking and delayed hash/history navigation. Renaming headings or
reordering duplicates can invalidate links; copying does not enable public access.

Application source `c544123` passes root/website lint, types and builds, all **five
packaged artifacts**, the bundle gate, **223 Chromium** scenarios and **12 focused
WebKit** scenarios. Additional real-component journeys pass in both engines for
late passages across all three search surfaces, duplicate/Setext headings, section
links/reload/history, no-write jumps and edit/Undo, desktop/mobile restoration with
delayed directories, account/session replacement, removed IDs, malformed/blocked
storage, commands, copy/fallback, pinning/tracking and narrow accessibility/overflow.
Frontend test files remain unchanged; the new interactions also have a documented
[manual verification matrix](development/testing.md).

History review, deletion and heading jumps hand focus over after actual dialog
cleanup, avoiding races with opener restoration; **15 repeated Chromium history
cases** also pass without changing the existing assertions.

Notes entry is **487,751 gzip bytes**; CodeMirror remains deferred. Node 24.22.1,
pnpm 10.33.0 and Playwright 1.64.1 were used; WebKit runs in the supported Noble
container. [Sixteen synthetic captures](design/screenshots/workspace-navigation/README.md)
cover 1440/768/390/320px, short/forced-colour layouts and both browser engines.
No schema migration is required; no production activation was performed.

Integration with landed hardening #88 (`eaa717a`) preserves both delivery records
and its dropdown-opacity correction. Integrated root/website static/build gates,
five artifacts, **50 automation/provider contracts**, workflow lint, bundle budgets
and **223 Chromium / 12 focused WebKit** cases pass. Navigation-specific journeys
also pass in both engines. Notes entry remains **487,751 gzip bytes**.
Current-head full browser/source CI evidence is recorded on
[navigation PR #97](https://github.com/miniaxolotl/grove/pull/97).

Subsequent integration with workspace polish #96 (`26e28e1`) preserves its compact
navigation, Filters panel and full-height mobile notes alongside section navigation.
Both-engine navigation journeys pass; [three refreshed integration captures](design/screenshots/workspace-navigation/README.md)
record the changed chrome. Notes entry is **487,661 gzip bytes**, editor deferred.
Integrated root/site static/build gates, five artifacts, 50 automation/provider
contracts, workflow lint, **223 Chromium**, **12 navigation WebKit** and
**11 library/filter WebKit** cases pass.
Four existing compact checks now use the current shared navigation/action paths
without dropping save, Undo or focus assertions. Current-head hosted evidence is
recorded on PR #97.

Review follow-up corrects four reproduced edge cases: edits retain cursor-based
section tracking; shared readers preserve IDs from the complete saved source even
when hiding its repeated title; query tokenization precedes Unicode lowercasing;
and search-only extraction retains underscore word boundaries. Targeted real-
component checks pass in Chromium/WebKit for later-heading edits, duplicate-title
public anchors, `İstanbul` and `DATABASE_URL` passage/highlight matching. Root/site
gates, five artifacts, bundle budgets and 12 focused WebKit checks pass. Notes entry
is **487,681 gzip bytes**; ordinary non-search excerpts/access scope are unchanged.

## Streamlined workspace (23 October 2026)

Notes and notebook libraries keep search beside one Filters control; notebook
selection and sorting share that panel. Mobile search joins New note in the
heading, Commands shares the notebook row, and full-page notes hide the sidebar.
Compact readers keep Export/Delete and secondary tools in Note actions; preview
hides formatting tools and the repeated autosave explanation is removed.

Review found a production-CSS cascade leaving a second, empty grid row beneath
mobile notes. The compact-note override now follows the shared layout. The
regression first failed at a 602px document height and now checks full-height
documents at 320/390/768px and in short windows in Chromium and WebKit.

Root/site lint, types and builds, five packaged artifacts and bundle budgets pass.
All **223 Chromium scenarios**, **17 focused iPhone/WebKit scenarios** and 18
viewport/accessibility checks pass. Notes entry is **486,029 gzip bytes**, with
the editor deferred.
[Reviewed captures](design/screenshots/streamlined-workspace/README.md) cover
Notes, notebooks, the editor, Ask Grove, Settings and Archive at 1440/390/320px.
No migration or production deployment is part of this refinement.

The latest-base integration preserves landed CI hardening #88 (`eaa717a`), with
fresh root/site gates, five artifacts, 50 automation/provider contracts and workflow
lint passing. All 223 Chromium cases, 17 focused WebKit checks and six palette repeats pass;
the test action helper now waits for the deferred editor before choosing toolbar
or menu controls, avoiding a loading-layout race.

## Shared reader polish (23 October 2026)

Shared notes and notebooks use one Read only label, a clear title/date and the saved
content. Repeated sharing labels, promotional footer and reader cookie notice are
removed. Unavailable links mention expiry and request a new link; temporary failures
offer a single retry. Generic HTML/Open Graph/Twitter metadata explicitly omits
marketing images and author/keyword tags and includes no-referrer.

Root/website lint, types and builds, five artifacts and bundle budgets pass.
All **40 Chromium** sharing/privacy/consent/public-site scenarios and **five focused
iPhone/WebKit** reader scenarios pass. Six states pass 18 viewport/accessibility
checks at 1440/390/320px, plus metadata/headers, keyboard, retry and active-reader
no-JavaScript checks. [Fourteen captures and verification scope](design/screenshots/shared-readers/README.md)
record the production build and the framework's no-JavaScript error-fallback limitation.

Merge verification integrates Ask tools #93 (`991f63d`), preserving both delivery
histories. Root/website lint, types and builds, five artifacts, bundle budgets and
all **40 affected Chromium scenarios** pass on the combined tree. Reader source
is unchanged; Notes entry is **486,113 gzip bytes**.

## Ask Grove research and notebook tools (23 October 2026)

Web search, Research and Manage notes share clear composer switches, remembered
defaults, inline recovery, bounded provider spending and distinct web citations.
Exa Lite and Tavily Basic power the research tools. Ask Grove previews notebook
creation/renaming, note filing and researched notes with atomic Apply and versioned
Undo. Organization continues beyond its first 50-note candidate batch. Migration
020 retains existing conversations and adds isolated settings/execution/usage state.
[Feature and API](ask-tools.md) and [rollout](deploy.md#ask-grove-tools-rollout-020)
describe the limits and operator setup.

On integrated application source `da27de5`, all **186 backend tests** pass (two optional
RabbitMQ/S3 checks skipped), with root/website lint, types and production builds,
all **five packaged artifacts**, bundle budgets, **19 release/deployment contracts**
and pinned workflow lint passing. The complete **223 Chromium** suite passes on
the final UI source, along with **seven focused WebKit history/conversation cases**.
Notes entry is **486,094 gzip bytes**, within the existing budget. The integration
preserves landed conversation history #91; tool vocabulary/defaults, scope checks
and activity formatting share canonical implementations.

Six additional real-API/disposable-database browser journeys pass at Chromium
1440/768/390/320px and WebKit 390/320px, covering toggles/drafts/activity/citations,
note Save/Undo and notebook create/file/Undo with sidebar refresh. The naming/control
follow-up also verifies optimistic switches, failed-save rollback, refresh recovery
and saved-default feedback. Menu accessibility
and page-overflow checks pass. [Eighteen reviewed captures](design/screenshots/ask-tools/README.md)
use synthetic data and show three images per row; the PR contains a preview row.

Actual Exa/Tavily search and extraction calls pass. A final two-turn live MiniMax +
Exa case creates a cited MDN note, then creates a notebook and files the note with
Apply/Undo. Initial runs exposed competing action schemas, omitted empty fields and
premature status wording; narrowed schemas and Grove-owned batch descriptions now
have regressions. Invalid model responses remain retryable failures; this small
synthetic sample is not a broad quality qualification. Production activation is
separate from these local/provider checks.

## Ask Grove history (23 October 2026)

History now offers private title/question search, date-grouped rows with question
previews and scope/count metadata, a current-conversation marker and named delete
confirmation. Search remains in place as a compact list changes or scrolls. Opens
are cancellable, errors stay in the dialog, and failed pagination retries its
original cursor. Reopened conversations start at the beginning with Latest reply
navigation; unsent drafts and uncertain-turn IDs stay with their conversation.

The owner-only POST history endpoint returns 30 bounded results and signed,
account/query-bound microsecond cursors. Deleted cursor rows do not break paging;
deleted/foreign history and assistant payloads remain excluded. No model calls,
new credentials or schema migration are required. Workspace/API/cache guidance
and [nine captures](design/screenshots/ask-history/README.md) document the behavior.

Root/website lint, types and builds, five packaged artifacts and bundle budgets
pass. The full backend suite passes **169 tests**, with two optional-service skips;
the full Chromium suite passes **223 scenarios**, followed by seven focused checks
after the final draft refinement. Notes entry is **485,941 gzip bytes**; history
is deferred. Seven focused iPhone/WebKit checks pass after adapting the existing
recovery scenario to the touch Send button. Browser checks include 1440/390/320px
and short-height access.

## Ask Grove new-note preview (23 October 2026)

New-note proposals show one preview and Save note, without an empty Current note
comparison. Edit/merge proposals retain Review changes; Save/Open note/Undo use
the existing paths. [Reviewed desktop/phone captures](design/screenshots/ask-create-preview/README.md)
record the focused refinement.

Root/website lint, types and builds, five packaged artifacts and bundle budgets
pass. Four existing Chromium chat/composer/retry scenarios pass. Manual create,
Save/Undo and edit/merge comparison checks pass at 1440/390/320px in both Chromium
and WebKit. Notes entry remains **485,883 gzip bytes**.

## Notebook archive and soft deletion (23 October 2026)

Notebook page/sidebar/manager actions confirm the complete subtree and note counts.
Archive hides its notebooks and archives active notes; Archived notebooks offers
Restore and Delete. Restore preserves separately archived contents and retention
dates. Delete uses the existing tombstone mechanism: source records and revisions
remain retained behind visibility policies. Local drafts block confirmation; stale
scope requires review and uncertain requests keep their original retry identity.

Forward migration **016**, after **015**, adds notebook status/archive provenance,
write guards and public-reader filtering. Owner-only atomic mutations preserve
tenant/grant boundaries, fence old jobs and revoke direct links. An existing shared
ancestor can include restored descendants again. See [contract](notebook-lifecycle.md)
and [rollout](deploy.md#notebook-lifecycle-rollout-016).

Fresh root/website lint/types/builds, five packaged artifacts and bundle budgets
pass. The full backend suite passes **165 cases** with two optional RabbitMQ/S3
skips; the subsequent nine-case lifecycle run also verifies current-profile queue
recreation and old lease removal. Populated upgrade and isolated recovery preserve
authored data. All **217 Chromium** cases and **five focused iPhone/WebKit browser
scenarios** pass, plus a WebKit cache check. A narrow manager overflow and a mobile
test navigation omission were corrected during verification. Notes entry is
**485,883 gzip bytes**, with the editor deferred.

[Reviewed captures](design/screenshots/notebook-lifecycle/README.md) cover desktop,
390px and 320px. Tests use disposable local PostgreSQL/non-owner roles and synthetic
browser data; production migration/deployment remains a separate operator action.

## Workspace refinement (22 October 2026)

Notebook titles gain space from combined folder/file drag handles, aligned disclosure
and action controls, and a wider desktop sidebar. Commands and shortcut help share
one row. Buttons follow the landing page's flat, 5px-radius styling; desktop note
tools use 36px controls while touch targets retain separate 44px areas. Note dragging
has a readable pointer-positioned preview and whole-row source feedback.

Viewer checklist changes save immediately through the existing version/operation-aware
path; typing autosaves after 450ms. A shared `(notes)` layout and document controller
preserve the editor, focus, scroll and undo history through the first saved URL.
Starting another note resets document identity while retained drafts and uncertain
save retries keep their original identities. Focus mode retains view/edit controls.
The content-sized outline shows heading hierarchy and the current section, with
normalized CRLF positions and keyboard navigation.

Ask/Search aligns its mode and notebook controls and retains the search field/status
through pending, empty, ready and retry states. Clearing a pending query immediately
returns to the empty search state. Shared recovery and control components are reused.

Verification on application source `e31e438`: root/website lint, types and builds,
all five packaged artifacts, bundle budgets and the full **210 Chromium** suite pass.
**17 focused iPhone/WebKit** scenarios pass, followed by **three final first-save/recovery**
checks. Repeated affected Chromium checks also pass after correcting synthetic shifted-Z,
paused animation-clock measurement and a manual-click/automatic-save test race.
Dropdown description contrast uses the shared muted colour token.

The telemetry-enabled production build is `bb1JRm4mEIK8YwzqY7LrK`; Notes entry is
**484,414 gzip bytes**, with the editor deferred. Verification used an exact-source
disposable checkout on Node 24.21.0 / pnpm 10.33.0 because the worktree filesystem
was nearly full. [Fourteen reviewed captures](design/screenshots/workspace-refinement/README.md)
cover desktop, 390px and 320px; browser checks additionally cover 768px, enlarged text,
short windows, keyboard/touch, accessible contrast and save/conflict/retry behavior.

## CI/CD hardening (23 October 2026)

For the subsequent CI/CD source hardening, see the
[implementation and acceptance boundaries](development/cicd-hardening-review.md)
and [shared patch-first release/naming rules](release-conventions.md). Strict
selected validation, authenticated source reuse, bounded reads, protected caches
and deployment identity checks are implemented without moving runners. The
separately authorised dropdown-opacity repair preserves existing tests and merged
UI refinements; [desktop/mobile evidence](design/screenshots/dropdown-contrast/README.md)
records the baseline correction. Hosted rollout and automatic recovery acceptance
remain separate from source CI verification.

## Notebook assistance (22 October 2026)

Five contextual tools share concise previews and exact source evidence: subject-aware
notebook summaries, suggested filing in Move, editable source-linked action lists,
fixed-window visit digests and reviewed cleanup with both-original comparisons.
Apply/Undo rechecks versions; supporting sources do not authorize writes. Four
independent AI preferences inherit existing choices once. On-demand assistance
reuses the existing dialogs, profiles, worker limits and enrichment lane.

Migration **015**, after queue **014**, adds tenant-isolated previews/reviews,
transactional change tokens, frozen visit checkpoints and resumable summary fragments.
Source/profile/preference/lease guards prevent stale publication. Deletion and expiry
remove evidence immediately, including offline browser previews. Exports/recovery
retain authoritative decisions and operation references while invalidating previews.
See [feature/API documentation](notebook-assistance.md) and [rollout](deploy.md).

Verification passes on integrated source `1542c08`: **138 backend/service tests**
(two optional RabbitMQ/S3 checks skipped locally), root/website lint, types and builds,
five packaged artifacts, 17 release/deployment contracts and pinned workflow lint.
The full **203 Chromium** suite and **five focused iPhone/WebKit** assistance/source
scenarios pass; the final queue integration also passes **eight affected cases in
each engine**. Bundle budgets pass; Notes entry is **483,060 gzip bytes**.
[Fourteen reviewed captures](design/screenshots/notebook-assistance/README.md)
cover desktop, 390px and 320px.

The six labelled live-model subjects produced all 30 ready feature results, including
six expected actions, three filing matches/three abstentions and the expected
duplicate/conflict/explicit-replacement cleanup cases. The synthetic 10,000-note
unchanged refresh took **69 ms / zero model calls**; one edit rebuilt 12 fragments
in 804 ms. [Quality and scale evidence](development/notebook-assistance-results.md)
records the initial failures, remaining wording limitations and measurement scope.

Conflict-resolution follow-up integrates backend capacity #78 (`be49db9`). Queued
downloads retain interactive admission until completion and propagate cancellation
to artifact storage; background work preserves authorization without foreground
rate accounting. Session-revocation checks run only for principals with sessions,
preserving worker-role permissions. The integrated suite passes **154 backend tests**
(two optional-service skips), **eight focused Chromium cases**, all required static,
build and artifact gates, bundle budgets and release/workflow checks. New regressions
cover worker authorization and download deadlines, cancellation and storage failures.

## Backend capacity and responsiveness (22 October 2026)

List presentation is constant at **15 SQL queries** for 1, 30 or 100 notes, down
from **15/131/411** with the integrated preference guards. Revision exports and
conversation sources are batched. Exact semantic recall scores eligible vectors
once before fetching note bodies. Short account/minute admission commits before
work; each subsequent authorization still checks current grants and revocation,
including a session revoked while waiting for an account lock.

Ordinary and interactive HTTP lanes have bounded, cancellable queues. Retry-After,
cooperative deadlines, rollback checks and failed interrupted-download streams
support predictable recovery. Database pool/acquisition/statement settings are
validated and forwarded through runtime/Compose. No new migration is required.

All **115 backend/service tests**, **193 integrated Chromium scenarios**, five
packaged-artifact checks, root/website lint/types/builds and bundle budgets pass.
Seventeen release/deployment contracts, pinned actionlint/ShellCheck and Compose
validation pass. Browser coverage includes navigation, search, held saves/newer
typing, cache refresh, mobile controls and retry recovery. The pre-workspace-merge
build also passed one focused iPhone/WebKit first-save navigation check.

PR review reproduced and fixed stalled-body admission/deadline bypasses, an
understated Content-Length bypass of the body-size limit, and model diagnostics
replacing caller cancellation. Five new cases cover both upload encodings, actual
received bytes, the Node HTTP adapter and cancellation/usage across provider roles.
The merged workspace-polish #77 delivery record is integrated below.

The final local 20 requests/s, two-minute run completed **2,398/2,400 successfully**
at **209 ms p95**, with no generator drops. The **50 sustained / 100 burst targets
remain unqualified**, and sustainable background processing/real-provider chat
capacity remains a queue-workstream follow-up. The
[measurement report](development/backend-capacity-results.md) retains exact
configurations, unsuccessful iterations and sizing limits. These are synthetic
HTTP/database and browser-fixture observations; production resources were not changed.

## Workspace polish follow-up (22 October 2026)

Commands use full-row selection without a coloured edge stripe. Dialogs, dropdowns
and menus share workspace colours, compact headings and restrained shading; keyboard
focus and forced-colour selection remain distinct. Quotes use neutral inset surfaces
across writing, reading, public links and connection evidence. Desktop drag grips
appear on hover/focus without shifting rows.

Ask Grove has concise suggestions, divided source rows, neutral citations and a
comfortable reading width. The composer fits below desktop/mobile navigation;
long conversations scroll internally and short windows retain page scrolling.
Shared plain-text excerpts remove visible task/quote/fence/link syntax in note rows,
search, graphs and source lists.

The full **193 Chromium** suite passes for the visual treatments, followed by
**20 excerpt** and **seven conversation/control** checks. **18 focused WebKit** cases
pass, with five affected cases verified after the final changes; the final submission
check passes in both engines. Root/website lint, types and builds, five artifacts
and bundle budgets pass. Notes entry is **481,587 gzip bytes** with the editor deferred.
[Eighteen reviewed captures](design/screenshots/workspace-polish/) cover desktop,
tablet, phone, forced colours and short windows on application source `f33fd3a`.

## Durable queues and retained deletion (22 October 2026)

Migration **014** adds checkpointed bulk/maintenance tasks, fair database claims,
renewable token-fenced leases, cross-replica limits and model-generation backfills.
RabbitMQ has independent indexing, enrichment, email, maintenance and bulk lanes;
polling uses the same capacity gates. Authored notes/history remain retained behind
soft-delete visibility policies, including during account cleanup and recovery.

Account and notebook exports use bounded NDJSON pages and private local/S3 storage,
authenticated streaming downloads, expiry, cancellation and retry. Compact controls
preserve progress across navigation and show the saved notebook scope. Imports
deduplicate sources and protect local edits; connector adapters checkpoint their
pages with ordinary memory writes. [Operations and API](jobs.md) and the
[014 rollout](deploy.md#queue-and-retained-deletion-rollout-014) describe setup.

After integrating workspace-polish #77 and backend capacity #78, all **138
backend/storage cases** pass, including two-worker broker-outage/import/export/SIGTERM,
populated **013→014** upgrade, real RabbitMQ isolation/reconnect and private Garage
**12 MiB** multipart transfers. Download deadline/cancellation/storage failures release
interactive permits; freshness rechecks share one request admission, and worker writes
retain authorization without consuming request quota. Root/website lint, types and
builds, five packaged artifacts, 17 release/deployment checks and workflow lint pass.
The integrated workspace passes **196 Chromium** and six focused iPhone/WebKit scenarios.

The final notebook-assistance #80 integration passes **156 backend cases** with one
optional S3 check skipped, plus **eight affected browser cases in each engine**.
The S3 adapter is unchanged from the earlier Garage-qualified run. Root/website
lint, types, builds, bundle budgets and all five packaged artifacts pass again.

The synthetic 1,000-note/2,000-record export uses at most a 623,300-byte serialized
page. Its initial local run took 742 ms with 34.7 MiB RSS growth and foreground-read
p95 of 14.3 ms (16.5 ms baseline); these are regression-fixture observations.
[Reviewed screenshots](design/screenshots/queue-processing/README.md) show ready,
retry and notebook progress states. Cloud storage and migration activation are
explicit operator rollout steps; local verification uses disposable services.

## Independent AI preferences (22 October 2026)

Settings groups ten independent controls under Organization, Connections, Summaries,
Ask Grove and Connected agents. One Save action preserves newer edits and submits
only changed fields. Missing providers are distinguished from saved preferences;
related notes/notebooks correctly require generation. Shared preference keys,
legacy mappings, job/scope guards and a single row renderer reduce duplication.

Migration **013** preserves existing enabled/disabled choices. API reads, queued
work, worker publication, summary scopes, Ask Grove, reindex and restore enforce
the controls independently. Disable/re-enable races discard old results. Note
`autoKind`, explicit types, connection reviews and tenant boundaries are preserved.

All **102 database/service** tests, including the populated **012→013 upgrade**,
and **five packaged-artifact** checks pass. Root/website lint, types and builds,
bundle budgets, 17 release/deployment contracts and pinned workflow lint pass.
All 166 Chromium scenarios pass in exact-head CI39732842999 on `b09cba8`, including
the corrected marketing-proxy teardown. Three focused iPhone/WebKit scenarios pass
with reviewed 1440/390/320px layouts, keyboard controls, save races, error recovery
and WCAG A/AA checks.

The subsequent settings polish keeps drafts and held saves across settings tabs,
adds shared Save/Discard feedback, adopts fresh saved preferences, and keeps the
active tab visible when resizing. Availability badges, switch-style controls,
provider fields and account/data headings share consistent spacing. This passes
37 focused Chromium settings/cache checks, nine final settings checks, six focused
WebKit scenarios and the three-case WebKit tab-rounding follow-up. Root/website
lint, types and builds, five artifact checks and bundle budgets pass again.

[Screenshots](design/screenshots/ai-preferences/README.md) show the categorized
controls and save row. [Rollout](deploy.md) requires an explicit owner migration
and preference-aware API/worker before the website.

## v1.10.0 production acceptance (22 October 2026 UTC)

The timed-link, public-reader isolation and short-consent-copy release is live.
Source `cb9b1a44` and protected production `8cea4497` have identical trees;
source/production CI and Deploy **39726145131** pass. Migration **012** preserved all
**29 retained-table fingerprints** and actual non-owner isolation. API/worker image `7901fa69`,
all five published packages and the exact Vercel production alias verify.

Live synthetic checks pass for authenticated sharing controls, no-JavaScript and
phone readers, database-clock expiry, stable URLs/deadlines, new-secret renewal,
scope changes, revocation, authentication/tracking isolation, worker indexing and
relationship processing. Synthetic links are revoked and newly created test notes
removed. Live consent, matching AdRoll pixel HTTP 200 and revocation pass; the
Analytics description is **“Understand site usage and performance.”**

The [complete release record](release-1.10.0.md) includes exact source/runtime/site
identities, backup and migration evidence, the bounded browser-network retry, and
the existing hosting-path logging limitation.

## Command palette, shared search and stable note tools (22 October 2026 UTC)

Commands and note search share a compact, viewport-aware dialog with warm surfaces,
fixed search/footer positions and independently scrolling results. Commands group
contextual editing, creation, navigation and note management; labels outrank aliases,
matches are highlighted, unavailable actions explain why, and selection follows a
stable command ID through first-save navigation. Shared metadata supplies note-menu
labels/icons and keyboard shortcuts, help and tooltips use the same definitions.

Reviewed [desktop and mobile captures](design/screenshots/command-palette/) cover
320–1440px, short landscape, long context, enlarged text and empty results. Browser
checks also exercise 2× pinch zoom, reduced motion, keyboard/IME guards, nested
modal scope, disabled-click focus and note-search error/retry/notebook selection.

The note viewer/editor keeps its mode and formatting controls in one persistent row,
reserves save-feedback space and opens properties/outline in a shared inspector.
Reader bounds stay fixed through mode changes and saving; focus/expand return keeps
the reading position. Viewer task buttons edit parsed Markdown source positions
through the same CodeMirror history and autosave/version-conflict path as writing.
Nested/repeated tasks, quoted and ordered tasks, fenced examples, CRLF imports,
keyboard/touch toggles, undo/redo, held saves, retry and conflict review are covered.
Public sharing, history and comparison remain read-only Markdown consumers.

The sidebar consolidates desktop/mobile styling and navigation, gives notebook names
two readable lines, keeps hover actions in reserved space and uses inset focus outlines.
All four destinations fit on phones; enlarged labels can wrap the navigation. Notebook
management uses an icon and tooltip, while the explorer header remains reachable on scroll.
Note-row actions share the native dropdown used elsewhere, replacing the expanding
button strip. Menus overlay the list without shifting rows and restore focus after
nested action dialogs; swipe reveal and cancellation use the same menu.

After integrating settings/AI-preferences #75, all **193 Chromium** and **39 focused
iPhone/WebKit** cases pass. Root/website lint, types and builds, all five packed
artifact checks and the bundle budget pass. Notes entry is **481,536 gzip bytes**;
the editor remains deferred. Twenty-two reviewed captures cover the final application
source `a4a6ae6` (test harness `8e9248f`) on Node 24.21.0 / pnpm 10.33.0.

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
production activation is verified in the [v1.10.0 release record](release-1.10.0.md).

## Public-reader authentication isolation (22 October 2026 UTC)

Live rollout verification found that the root authentication provider loaded Clerk
on anonymous shared readers. The provider now belongs to account/workspace layouts.
A configured synthetic-key regression first reproduced the issue, then passed with
the fix: sign-in loads the provider, while successful/missing/failed shared readers
and marketing pages make no authentication-provider requests. Existing secret-path
links and server-rendered, no-JavaScript reading are preserved.

Root/website lint, types and builds, all five artifact checks, bundle budgets and
all 160 Chromium scenarios pass. These local checks are complemented by the
[v1.10.0 production acceptance](release-1.10.0.md). A separate hosting canary
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
