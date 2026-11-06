# Browser extension: first-release design

Chrome, Firefox and Microsoft Edge are the selected desktop launch browsers.
The [current guide](../browser-extension.md) owns implemented behavior, unsigned
local installation, rollout and verification. This design retains the release
requirements and deferred scope; it is not evidence of signed/store distribution,
live provider acceptance or permission to migrate, deploy or publish.

The shared TypeScript runtime now provides capture, search/read, reviewed context,
explicit exact-URL lookup and Settings. A separate **This page** view makes the
URL-disclosure consent boundary visible rather than running lookups on navigation.
Browser-specific manifests, trusted session OAuth/storage and atomic provenance
APIs implement the earlier core-only gaps below. The remaining release acceptance
checklist is intentionally stricter than fixture/unsigned-package success.

## Goal and release scope

Make Grove useful without leaving the current page: capture a useful detail,
retrieve existing knowledge and explicitly carry selected context into another
tool. Ship one shared interface with native browser adapters, not three products.

| Proposed v1 feature    | Release boundary                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search and read        | Search authorized notes, choose a notebook, read a note and open its canonical Grove page. Preserve existing lexical fallback and pagination.                             |
| Quick note             | Toolbar/keyboard entry into a short composer; optionally attach the current page. Remember the last permitted destination, visibly.                                       |
| Save selection or link | Context-menu capture into an editable preview containing the selected text, safe URL, page title and capture time. Save only after confirmation. No full-page extraction. |
| Copy context           | Select notes, preview the exact bounded text and source links, then copy. No model call, site-specific insertion or automatic prompt submission.                          |
| Saved on this page     | On explicit request, show authorized active notes associated with the reviewed current URL. Offer Open or Save separately; never silently merge or overwrite.             |

One sidebar has **Capture**, **Search** and explicit **This page** views; selected
search results expose **Copy context**. **Settings is last** and contains account/connection,
destination, privacy, draft-clearing and shortcut information. Existing notebook
management and full editing remain in Grove's web app.

The implemented device switch has one home: the persistent header. Off
must block trusted-background activity, not merely hide the composer, retain exact
unknown-save recovery and allow re-enabling from the toolbar. Appearance follows
browser light/dark mode by default with an explicit device override. A persistent
header/navigation frame encloses independently scrolling views; Settings groups
appearance, access and privacy without extra onboarding. Recovery controls appear
only for unconfirmed saves. Search and This page retain distinct disclosure forms
but reuse one results/context surface and renderer, not duplicate lists/actions.

Defer full articles, attachments, generated summaries/filing, chat scraping,
AI-chat takeaway extraction, append/edit existing notes, semantic page matching,
history ingestion, research-tab bundles, new-tab replacement, Safari and mobile.
Existing hosted ChatGPT/Claude connections remain a separate integration; this
extension must not depend on their directory approval or modify their setup.

## Shared design constraints

Source owners: [shared contracts](../../lib/shared/src/contracts.ts),
[API transport](../../packages/api/src/app.ts) and
[bundle targets](../../scripts/build.mjs).

- Reuse [authenticated API and tool contracts](../server.md), [search](../search.md)
  and existing scoped notebook discovery. The API owns authorization and writes;
  the extension gets neither database nor provider credentials.
- The current `agentSchema` accepts only OpenCode, Claude and Codex. Terminal
  [connection setup](../cloud-onboarding.md) uses a loopback listener and cannot
  simply be embedded in an extension. Extension OAuth/approval is a prerequisite.
- `sourceSchema` keeps agent/session/verification. Browser provenance and exact URL
  lookup use their own scoped contract, not string search over the latest list page
  or a local copy of the whole library.
- Current note bodies accept at most 6,000 characters. Include headings, quotes
  and attribution in that budget; show overflow and let users edit. Do not silently
  truncate a selection or invent automatic note splitting.
- Owner-only assistance, conversations, uploads and share management are not
  available to the extension's scoped OAuth connection. Do not bypass that boundary.
- API CORS currently names the website origin. Test privileged extension requests
  with exact API host permissions; do not add wildcard CORS or relax website JWT
  origin validation to make an extension work.
- Native build targets produce Node bundles; the extension has a
  separate browser-only build. Manifests/UI must use browser-safe imports,
  not the CLI bundle, native credential store or website's server modules.

## Architecture and safety requirements

### Shared application and browser adapters

`packages/browser-extension` uses a private TypeScript runtime and esbuild
browser target, reusing the repository's toolchain without a new framework. Thin
adapters cover panels, identity, context menus, commands, storage and clipboard.
Reuse browser-safe code under
`lib/` where it actually fits; do not pull server imports through a shared barrel.
MV3 packaging alone does not qualify native hosts or live OAuth.

Produce separate manifest/artifact variants from the same source:

| Browser | Native surface  | Background and distribution                                                                              |
| ------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| Chrome  | `sidePanel`     | MV3 service worker; Chrome Web Store package.                                                            |
| Firefox | `sidebarAction` | MV3 background/event-page adapter as supported by the qualified version; signed Mozilla Add-ons package. |
| Edge    | `sidePanel`     | MV3 service worker; independently tested Edge Add-ons package and identity.                              |

Preserve user gestures when opening panels; do not await network/auth work before
calling a gesture-gated panel API. A local extension tab may be an explicit recovery
surface, not a reason to omit a launch browser's native panel. Record minimum
browser versions and supported desktop operating systems after testing; Chromium
engine similarity is not evidence of Edge acceptance.

Use the smallest proven permission set: storage, identity, context menus,
native panel permission where required, `activeTab`, and only required Grove/auth
hosts. Declare shortcuts through manifest commands, not an invented permission.
Add `scripting` only if a bounded user-triggered capture needs it. Avoid
`tabs`, history, cookies, clipboard-read, persistent content scripts and
`<all_urls>` unless a separate reviewed requirement justifies them. Request any
additional access at its point of use. Capture restrictions must not block manual
notes or library search. File/internal/store pages get a clear unsupported-source
state. Keep private-browsing access out of v1.

### Sign-in and permissions

Use browser identity authorization-code flow with PKCE/state and exact registered
redirects. Validate issuer, resource audience, account and connection grant; OAuth
completion alone is not a connected state. Register/qualify distinct store IDs and
development redirects without wildcard redirects or embedded client secrets.

Reuse the existing owner-controlled Connections approval where feasible. Propose
read/write without deletion and visibly chosen Personal/notebook scope; explain
when all-notebook search requires a broader approved grant. Do not silently inherit
the CLI's new-connection defaults, widen an existing grant, create a notebook or
ask users to paste keys. Read-only grants remain useful; disable save with a reason.

Start authorized notebook discovery immediately after approval; do not add a setup
wizard. Reuse the existing website sign-in when available without reading its
cookies or extracting website tokens. Token renewal must be single-flight and
survive background suspension safely. Keep tokens in trusted extension contexts,
never content scripts, page messages, synchronized storage, URLs or diagnostics.
P0 must settle local token protection, refresh-token persistence and cleanup; browser
storage is not an OS secret vault. Sign-out/account changes clear visible notes,
drafts, tokens and selections before another account can use the panel. Remote
revocation/grant changes are checked before further reads, writes or context copy;
do not offer cached offline library reads.

### Capture and exact page lookup

Use an additive capture contract that commits the ordinary note and bounded
web provenance atomically: source URL, title, capture timestamp and a normalized
lookup key associated with the note. Use explicit capture and existing mutation
UUID/replay rules. Derive account and connection identity server-side. Keep the
existing `source.agent: "api"` for v1 compatibility unless a coordinated contract
change proves all bundled consumers accept a new value; do not disguise the
extension as the website or encode arbitrary URLs in `session`/`verification`.

Store the readable citation in the note as well. Structured provenance is private
note data and follows note scope, lifecycle, export and recovery. A forward-only
migration, if needed, must preserve existing rows and non-owner RLS. Reuse the
central mutation path so imports, moves, corrections and deletion cannot leave
cross-account or stale lookup entries. No background backfill is required for v1:
legacy notes without structured provenance are not claimed as page matches.

Define URL normalization before persistence: HTTP(S) only, no username/password,
remove only specifically reviewed tracking parameters and retain all fragments.
Preserve functional query parameters and identity-bearing hash routes; when unsure,
retain the distinction rather than collapsing different documents. Preview the
outbound URL and let users remove sensitive parameters or omit the source. Treat
page titles, canonical-link hints and selected text as untrusted data. Do not
fetch canonical links, bypass paywalls, read hidden form fields or contact a site
to enrich a capture. No page URL/text is sent merely because a tab changes.

Provide a bounded, paginated POST URL lookup under the existing read grant, with
explicit notebook scope and current lifecycle checks. It returns exact normalized
URL matches, not topic similarity. Never download all notes to filter locally.
Results cover only the current authorized scope, not the user's whole library.
Duplicate hints are advisory; retries of one save cannot create duplicates, but
two separately confirmed captures may legitimately reference the same page.

### Drafts, retries and durable work

Keep drafts in trusted, account/origin-scoped session storage, never browser sync.
Maximum lifetime is 24 hours, ending earlier on discard, window closure, sign-out or
browser session end; enforce expiry on every read. Closing/reopening the panel or
suspending the background context must not lose a draft. Do not claim browser-
restart recovery unless explicitly implemented and privacy-qualified.

Persist the exact submitted payload and UUID before sending. Distinguish unsaved,
saving, saved, failed and uncertain-response states; retry the identical payload
with the same UUID. New edits create a new operation only after reconciling the
previous one. Never show Saved on a timer or retry an uncertain write with a fresh
UUID. P1 must specify scoped reconciliation after session loss (an opaque operation
receipt/status contract if existing replay cannot suffice), without restoring
deleted notes or retaining raw captures indefinitely. Recheck destination grants
after discovery; never silently reroute a save when a notebook becomes unavailable.

Bounded interactive reads and short atomic saves stay synchronous. Embedding and
enrichment continue through Grove's existing [durable workers](../jobs.md); storage
success is separate from indexing status. Any new long-running work must reuse
that queue/outbox/lease stack, not browser timers, detached promises or a second
broker. Browser background contexts coordinate UI/auth, not server job execution.
Do not keep transactions open during remote I/O or queue content/tokens.

### Reading and copying

Use POST search, server pagination and current notebook grants. Preserve mounted
rows, filters, selection, focus and scroll during refresh; mark stale/failed refresh
honestly. Cancel/discard late responses after query, account or scope changes.
Display exact note source as text, without executing HTML or loading remote tracking
images; link to the full Grove reader for rendered documents.

Copy is an explicit disclosure of private text to the clipboard. Re-fetch selected
notes and recheck current versions/access before showing the final copy preview;
removed or changed sources require review. Include note text and
canonical Grove links with a visible size budget. Never include auth tokens
or public capability links automatically. Never read the clipboard or inject into
another website. Clipboard denial offers selectable plain text, not a false success.
Text already copied outside Grove cannot be recalled after revocation.

## Release qualification gates

These gates distinguish source implementation from a qualified three-browser
release. Passing fixture tests does not authorize provider changes, live migrations,
deployment or publication. Captures use the common structured-revision writer;
structured-document edits must continue to invalidate stale source associations.

| Milestone                        | Deliverables                                                                                                                                                                                                 | Exit gate                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 — prove feasibility           | Native panel/context-menu/shortcut spike in all three browsers; real identity redirect and fetch feasibility; build-tool decision, token threat model, permission/OS/version matrix and store prerequisites. | Demonstrate suspension/reopen and gesture handling in actual browsers. Document any provider/operator approval blocker. No promise of supported sign-in from mocks alone.                    |
| P1 — API and provenance          | Browser connection/approval support as needed; atomic capture/provenance and scoped exact-URL lookup; compatible schemas, bounded inputs, operation reconciliation and any additive migration.               | Disposable real PostgreSQL/non-owner RLS tests pass for both tenants, grants, replay, lifecycle, populated upgrade and recovery. Existing CLI/hosted clients retain behavior.                |
| P2 — shared shell and connection | Three manifests, native adapters, trusted transport/token boundary, sign-in/resume/revoke, notebook picker and real Settings.                                                                                | Installable test artifacts in Chrome/Firefox/Edge; approved-grant check, read-only mode, account switching, denied permissions and auth recovery verified.                                   |
| P3 — capture                     | Quick note, selection/link preview, safe attribution, scoped drafts and exact retry/status UI.                                                                                                               | End-to-end save/readback works in all browsers; lost response, duplicate retry, oversize selection, changed destination and panel closure tests pass without draft loss or fabricated saves. |
| P4 — retrieve and reuse          | Search/reader, explicit page matches, bounded selected-context preview/copy and safe canonical links.                                                                                                        | Pagination and lexical-only operation pass; deletion/revocation before copy, stale search, clipboard denial, tab changes and cross-account isolation pass.                                   |
| P5 — qualify and prepare release | Packaged-browser tests, accessibility/privacy review, relevant captures, reproducible artifacts/hashes, upgrade tests, reviewer instructions and offline submission materials for three stores.              | Every browser passes the same core checklist. CI is green on the exact candidate; store signing/configuration and live checks remain separately identified operator gates.                   |

Do not estimate launch dates until identity/provider access and packaging constraints
are resolved. A failed launch
browser gate blocks the advertised three-browser release unless the owner changes
scope; it must not quietly become an unsupported compatibility build.

## Verification and release acceptance

- **Pure tests:** URL normalization (functional queries, credentials, fragments,
  Unicode and malformed URLs), capture budgets, safe Markdown, draft expiry,
  account/scope transitions, context formatting and manifest permission differences.
- **Service tests:** two tenants, narrowed/revoked grants, hidden notebook parents,
  revoked during a request, duplicate save replay, changed-payload conflict,
  uncertain-operation recovery, note edit/move/archive/expiry/deletion, stale URL
  associations, export/recovery and old-client compatibility. Use disposable
  PostgreSQL and real non-owner roles, never a retained database reset.
- **Actual packaged extensions:** install, update, toolbar/command/context-menu
  entry, native panel, browser restart, background suspension, denied access,
  expired tokens, offline/429/5xx, ambiguous save, tab/window changes, narrow panel,
  keyboard/IME/focus and safe clipboard behavior in each named browser. Browser-page
  emulation alone does not qualify Firefox or Edge extension APIs.
- **Privacy:** inspect packages and network traffic for page uploads before consent,
  broad hosts, remote executable code, source/title/query/token leakage in logs or
  analytics, unsafe message senders, mixed-account storage and post-revocation copy.
  Package executable code locally with a restrictive CSP; omit extension analytics
  and session replay from v1 unless separately reviewed and explicitly consented.
- **UX:** measure install-to-first-use and first useful state rather than claiming
  instant setup. Aim for near-zero setup; under one minute applies only to unavoidable
  user choices, with sign-in/provider waits recorded separately. Preserve geometry,
  drafts, selection and focus through pending/success/failure/offline states.
- **Repository gates:** follow [required checks](../development/testing.md), plus
  extension-specific unit/service/artifact/browser jobs added by the implementation.
  Extend lint, types, builds, packaged artifact tests and CI selection for the new
  package; do not assume existing root scripts discover it. Release/workflow changes
  also need existing release/CI contract tests and workflow lint.

Before distribution, settle extension identity/version mapping in the existing
[coordinated release process](../release-conventions.md), rather than creating a
second version authority. Apply any operator-approved schema upgrade and compatible
API/worker rollout before clients needing it. Test upgrade from the prior extension
candidate and keep old clients compatible during independent store review delays.
Distinguish source merged, artifact built/signed, store submitted/approved and live
install verified. Preparing release materials is not permission to submit/publish.

Use a small owner-approved test cohort before public publication. Record artifact
hashes, qualified browser/OS versions, permission and privacy disclosures, reviewer
test instructions, support/revocation guidance and a compatible rollback path.
Never put reviewer credentials in Git/plans. Store IDs, signing, developer accounts,
provider redirect registration, any fees and production publication need explicit
operator decisions. No extension listing or website install claim before availability.

Implementation screenshots belong in `documentation/design/screenshots/browser-extension/`
with synthetic content, browser/build provenance and acceptance limits; embed only
relevant previews in PRs, at most four per row.

## Remaining product and qualification decisions

1. Qualify concrete browser/OS versions, native entry points, live OAuth redirects,
   session/suspension recovery and actual setup timing before advertising support.
2. Cloud-first defaults and exact-host self-hosted builds are implemented; each
   additional installation/issuer still requires its own provider qualification.
3. Confirm store/operator ownership, final store IDs, signing, privacy declarations
   and rollout order. Builds reuse the coordinated product version, not a second
   version authority. Do not guess developer account IDs, fees or publication dates.

### Browser references

- [Chrome side panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
  documents native panels and the user-action requirement for opening them.
- [Firefox sidebar](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction)
  and [background manifests](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
  describe its separate surface and background model; qualify the chosen version.
- [Edge sidebar](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/sidebar)
  documents its Chromium API and browser-specific behavior; test it independently.
