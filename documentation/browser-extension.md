# Browser extension

Grove builds unsigned, locally installable extensions for Chrome, Firefox and Edge
from `packages/browser-extension`. Store publication and live provider acceptance
are separate: these packages are not signed Firefox releases or published store
listings. Source behavior and installation are described here; the
[design](design/browser-extension.md) retains the release requirements and deferred scope.

## Install and connect

Install only against a compatible deployed API, including migration `037` after
`036` and the native OAuth-origin admission rule below. Default-origin CI packages
point at production; passing source CI does not deploy that server. An older API
rejects extension requests with **Origin is not allowed**, regardless of whether
the package is signed. Use a custom-origin build for an isolated local stack.

Use Node 24 and pnpm 10.33, install the locked dependencies, then run
`pnpm build:extension`. The output under `packages/browser-extension/dist/` contains
`chrome/`, `firefox/`, `edge/`, a `grove-<browser>.zip` for each browser and
`packages.build.json` with product version, configuration, input inventory and hashes.
Successful source CI also retains these unsigned ZIPs and their report as a
`grove-browser-extensions-<source SHA>` artifact for 14 days.

- **Chrome:** open `chrome://extensions`, enable Developer mode, choose **Load
  unpacked** and select the extracted `chrome/` directory.
- **Edge:** open `edge://extensions`, enable Developer mode, choose **Load unpacked**
  and select the extracted `edge/` directory.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
  Add-on** and select `firefox/manifest.json`. This development install ends when
  Firefox closes. Ordinary persistent Firefox installation requires Mozilla signing;
  renaming the unsigned ZIP to XPI does not bypass that requirement.

The manifests require Chrome/Edge 127+ and Firefox 142+, desktop only. These are
API/manifest floors, not claims that every version/OS is tested. Pin the toolbar
icon or use the suggested **Alt+Shift+G** shortcut (browser conflicts may require
rebinding). Chrome/Edge use a native side panel; Firefox uses its native sidebar.

Choose **Sign in to Grove**. Native browser identity performs public-client OAuth
discovery and authorization-code/PKCE sign-in; no pasted key, embedded secret or
website-cookie extraction is used. Approve only the reading/saving capabilities
and Personal/notebook scope you want in **Grove Connections**, then check approval.
Notebook discovery starts immediately; there is no setup wizard. Sign-in alone is
not an approved grant. Revocation is enforced by the API on subsequent operations.

## Use the panel

Three main tabs keep the panel focused: **Capture**, **Search**, then **Settings**.
Page lookup is inside Search; context actions appear only after selecting notes.

### English writing checks

Capture checks spelling and basic grammar locally while you write. Open an underline
or press **Alt+Enter** in the editor, then choose a correction, **Ignore**, or **Add
word**. Applying a correction uses the editor's native Undo history and updates only
the current draft, never an already-submitted save. Saving does not wait for checks.

Settings → **Writing** contains independent spelling/grammar switches, an Advanced
disclosure for individual rules, automatic checking and highlights, and a personal
dictionary. Parent switches preserve individual choices. Preferences and personal
words are stored on this device, scoped to the API/account and English language.
They do not contain draft text or check results. Turning Grove off overrides them.

The bundled `dictionary-en` 4.0.0 data is SCOWL-derived **American English**, with
`nspell` 2.1.5 for affix-aware lookup. Their MIT/BSD notices are included in the ZIP.
There is no dictionary download, external spelling service or AI request. Basic rules
cover brackets/quotes, **a/an** sound exceptions, repeated words, spacing and obvious
capitalization. They are not a complete grammar/style analysis. Unknown names can be
added to the dictionary; ambiguous rules abstain rather than guess a replacement.
Future UI translations and proofing languages remain separate; only English ships.

Under Writing → **Websites**, choose **Enable on this site** from the native panel
beside a website and approve its native permission prompt. Returning visits reuse
that choice. Only eligible multiline textareas are currently bound. HTML inputs,
passwords, usernames, search/subject/title fields, readonly/hidden/code fields and
author opt-outs are excluded before reading their contents. Verification/identity/
address labels and explicit single-line ARIA semantics also exclude a field. Label
inspection is bounded, follows static accessible labels and skips nested editors;
ambiguous or excessive metadata stays unbound. Rich-text/contenteditable
editors are not yet supported by the installed adapter. Site restrictions cannot
override a globally disabled feature. Removing website access stops binding.

Checks cover a bounded 6,000 UTF-16-unit window and expose partial coverage for longer
text; results never replace newer typing. Keystrokes coalesce, dictionary work runs
in the extension background rather than the editor thread, spelling alternatives
are generated only on review, and highlight movement coalesces per animation frame.
Warm latency is a regression measurement, not a universal responsiveness guarantee.
Run `pnpm test:writing` and the installed browser journeys to reproduce the focused
rules, bounds, source/Undo, permission and excluded-field checks.

### Explicit AI sentence tools

Select one sentence, then choose **Use AI** (or **Alt+Enter** with a selection).
The compact menu offers **Make more concise**, **Make more verbose**, **Rewrite**
and **Humanize**. Only the chosen tool runs. Selection and opening the menu send
nothing. First use shows the sentence and configured provider disclosure with
**Generate alternatives**; valid connection-scoped consent is reused across editors
and tools. Changing the provider profile or disclosure requires new consent.

Grove requests three distinct alternatives and accepts two or three after validation.
The unchanged original stays visible. Click an alternative to replace only the
current selection with native Undo, **Copy**, or **Dismiss**. Editing, disabling AI
or losing eligibility closes stale results. Humanize means natural conversational
wording, not an AI-detection guarantee. Output can be wrong: structural validation
does not establish factual or semantic equivalence. English is the supported contract;
sentence segmentation is not language detection or an automatic translation feature.

Settings → Writing → **AI writing tools** is independent of spelling and grammar.
Site restrictions and Grove Off still win. Enabling a switch never generates text.
AI needs a separately approved **Allow explicit sentence rewrites** permission in
Grove Connections; note access alone is insufficient. Missing configuration, permission
or network does not disable local checks, which never fall back to AI.
Website AI additionally requires browser-supplied document identity; hosts without
it keep AI unavailable rather than reuse another document's authority.

Requests persist before HTTP **202** acceptance; Grove's existing enrichment workers
perform generation. The UI reads durable queued, processing, backoff, expired-lease
recovery, uncertain, failed and completed states. Polling only reads status; it does
not execute work. Unknown acceptance offers status reconciliation, not automatic
regeneration. Cancellation fences Grove output; it cannot recall a provider call
already sent. If cancellation cannot be confirmed, server staging still expires.

- **Capture:** write a quick Markdown note, choose its notebook and optionally
  review a source link. Context-menu **Save selection**, **Save link** and **Save
  page link** prepare a session inbox; reviewing a capture never saves it. Replacing
  a nonempty draft requires confirmation. At most five inbox captures wait per window.
- **Search:** find active notes, reveal the notebook filter when needed, load more
  results, read exact source text and open canonical Grove note links. Text is never
  executed as HTML. Unchanged result rows stay mounted during refresh; failed
  refreshes retain the previous results and label them stale.
- **Context:** select up to six notes, review the exact text/source links and confirm
  sharing before copying. The aggregate is limited to 6,000 characters. Copy rechecks
  access, lifecycle and versions; changed sources require a fresh review. Clipboard
  failure leaves the reviewed text available for manual copying. Nothing is inserted
  into another website or submitted to a model.
- **Search → This page:** review an exact source URL and choose **Find notes**. Opening the
  panel or changing tabs never discloses the current URL automatically. Matches are
  authorized, active, unexpired captures in the chosen notebook; content edits
  invalidate their page association. There is no full-library client-side scan.
- **Settings**, last in navigation, shows access and privacy, with connection IDs and
  storage details behind disclosures. Unconfirmed saves show recovery actions; a
  confirmed receipt removes the corresponding pending item. Access management,
  notebook discovery, refresh and sign-out remain available. The last chosen
  destination is remembered per API/account; existing drafts take precedence.
  System/light/dark appearance saves automatically on this device. Enablement has
  one home in the persistent header; Search modes reuse a single results/context
  surface and renderer while keeping independent input/results state.

Capture opens directly to the note editor. Save outcome and newer unsaved edits
remain visible; exact version/indexing metadata is available under **Save details**.
The source link remains editable and reviewed before saving. No feature, privacy
approval or uncertain-save safeguard is removed to simplify the panel.

### Turn Grove on or off

The single header switch is always available, including in Settings and while off.
There is no second enable/resume control to keep in sync. Turning Grove
off persists on this device across panel reloads and browser restarts, removes its
context-menu entries and adds an **OFF** toolbar badge. The toolbar/shortcut still
opens the native panel so Grove can be turned on again. Off blocks extension API
requests, sign-in/refresh, captures, search, reads, source attachment and context copy
in the trusted background, not only through disabled buttons. Opening an off panel
does not authenticate or contact Grove. Appearance and Settings remain available.

Switching off waits for earlier serialized actions to settle; a save already sent
is not cancelled, deleted or falsely labelled unsuccessful. Session drafts/tokens,
capture inboxes and opaque recovery receipts retain their normal scope/expiry rules.
No unknown save is automatically retried on resume. Changing appearance cannot
enable Grove. Other mounted panels update immediately and close private review
dialogs while off; the current draft is not replaced. Turning on rechecks access.
This is a device pause, not grant revocation or the browser's add-on uninstall switch;
use Connections to revoke access and Sign out to clear a mounted session.

The panel uses a persistent header/navigation frame with a separately scrolling
content area: controls cannot scroll beneath navigation, and view changes restore
their previous scroll position. Switches work with the keyboard and retain focus.
Search and This page share one results list, status, pagination and context-review
action; each keeps its own query/results state when switching views. Unchanged
rows remain mounted during refresh. Context review appears only after selection,
and still requires explicit consent and current-version/access checks before copy.

Restricted/internal/store/file pages cannot be attached; private browsing is disabled.
Manual notes and search do not need page access. `activeTab` may require opening the
extension from the page's toolbar/context menu before **Use current page** can read
its URL. Source URLs remain editable, and lookup/save is always a separate action.

## Implemented contracts

### Reviewed capture values

`@lib/shared/web-capture` provides `normalizeWebUrl`, `webCaptureSchema` and
`formatWebCapture`. The strict provenance value contains only `url`, `title` and
`capturedAt`; a web page is a cited external source, not a verified Grove fact.

URLs accept HTTP(S), reject embedded credentials, controls/whitespace and inputs
over 4,096 characters, normalize the standard URL authority and remove only the
explicit tracking-parameter set in the source. Functional query bytes/order,
duplicate keys, unknown parameters and all fragments remain intact. No link,
canonical hint, image or page is fetched. Titles are single-line, at most 300
characters; capture timestamps are UTC ISO datetimes.

Formatting escapes quoted external text and attribution as Markdown, while manual
notes retain their authored Markdown. Link-only captures are supported. The shared
6,000-character note limit includes quotes, title, source URL and timestamp; overflow
is rejected, never truncated or split. A valid source can still contain sensitive
query parameters: callers must show an editable review before disclosure.

These helpers do not widen the general `remember` schema. Browser-specific endpoints
are `POST /v1/browser/connect`, `POST /v1/browser/captures`,
`GET /v1/browser/captures/:operationId` and `POST /v1/browser/pages`. They use the
normal authentication, quota and connection-grant boundaries. Capture accepts an
operation UUID, content, destination, `capture: explicit` and optional provenance.
The note, structured revision, provenance, replay receipt and normal durable
processing jobs commit atomically. Acceptance of a note is not completed indexing.

Private API requests accept exact native `chrome-extension://<32-letter ID>` and
UUID-shaped `moz-extension://<ID>` origins only after OAuth verification. A native
origin is not identity proof: sessions and API keys cannot use this exception,
unapproved grants cannot read/save, and revocation still denies access. Website
origin restrictions and website CORS remain unchanged. The regression exercises
both native schemes, malformed/foreign origins, sessions, keys and revoked grants
against the real authentication and disposable PostgreSQL services.

Migration `20261105_037_browser_capture` follows structured documents `036`. Its
tenant-isolated `web_captures` table retains source history without changing note
row shapes. A database trigger invalidates active associations when content changes,
including structured edits. Metadata-only changes preserve associations; archive,
expiry, deletion and scope loss exclude matches. Cursor signatures bind URL,
account, connection and grant. Exports include active provenance; queued imports
validate it and use the existing scoped/idempotent worker. Retained authored data
is not physically erased by content edits or soft deletion.

### Writing work and temporary data

`@lib/shared/writing-assistance` owns tool identities, one-sentence selection and
strict request/output bounds: 2,000 UTF-16 units per sentence, up to three alternatives
of at most 4,000 units each. Requests contain an operation UUID, editor-session UUID,
`language: en`, explicit tool and selected sentence—no URL, surrounding draft or notes.
The provider is asked to preserve meaning, names, numbers, negation and uncertainty,
and to treat the sentence as data rather than instructions. Grove retrieves no extra
context or tools for a rewrite. This is not a semantic-safety guarantee.

The authenticated browser API adds:

- `POST /v1/browser/writing/consent`: accept/revoke the current disclosure policy.
- `POST /v1/browser/writing/requests`: commit encrypted staging and durable work;
  return **202**, not provider completion.
- `GET /v1/browser/writing/requests/:id`: read scoped current state/alternatives.
- `POST /v1/browser/writing/requests/:id/cancel`: retain an opaque cancellation receipt
  even before acceptance, preventing a delayed POST from recreating cancelled work.

Migration `20261106_038_writing_tools` follows `037`. Forced-RLS consent, request and
cancellation tables are scoped to the account/connection. `writing_enabled` defaults
false on connections, independently of note permissions. Grant/lifecycle changes
invalidate consent, erase temporary text and fence late writes. Workers recheck the
profile, disclosure, consent version, processing epoch, account/connection and lease
before provider dispatch and publication. Exact replay does not regenerate output;
provider-started attempts become uncertain after interruption/reclaim, never automatic
provider retries. Writing tasks and memory jobs share enrichment admission across replicas.

Selected text/results use AES-256-GCM with tenant/work-bound authenticated data.
Input is cleared after completion; results and unfinished input expire 15 minutes
after acceptance. Reads enforce expiry immediately; existing retention workers clear
expired ciphertext in bounded batches even without another user request. Cleanup may
lag the deadline while workers are unavailable. Cancellation/failure clears scratch;
opaque work/replay/cancellation metadata and usage accounting remain. These are not
notes, revisions, exports or a saved rewrite history. Provider retention is separate
and must be accurately disclosed; cancelling cannot erase already-transmitted content.

API and worker need the same dedicated `WRITING_STAGING_KEY` (32-byte hex, not another
service key), an accurate `WRITING_PROVIDER_NOTICE` (20–1,000 characters), and the
existing generation provider. Both optional writing variables must be set together;
leave both unset for local-only checking. The extension never receives this key or
provider credentials. Key rotation makes previous scratch unreadable; do not present
configuration alone as live-provider acceptance. Use the normal deployment process;
this guide authorizes no production configuration or migration execution.

### Draft and save snapshots

`createCaptureDraft`, `readCaptureDraft` and `editCaptureDraft` are the shared draft
contracts. Reads require the exact HTTPS API origin, account and connection,
and reject malformed data, future updates and expired drafts. Drafts have a fixed
24-hour maximum from creation; edits cannot extend it. Runtime drafts, capture
inboxes, OAuth tokens/state/verifiers live only in trusted browser **session**
storage. Closing a window removes its drafts/inbox; sign-out clears all session
data and mounted private views across open panels. A browser restart requires
sign-in again. Session storage is not an OS vault, and no offline library is kept.

`prepareCaptureSave` creates an independent local command snapshot with an
operation UUID, formatted content, notebook and optional provenance. Runtime saves
persist this snapshot before authorized HTTP I/O. While a save is unresolved, only
the same UUID and exact snapshot can be
retried; newer edits/destinations stay in the draft without altering the snapshot.

`settleCaptureSave` accepts failed/uncertain outcomes or a matching saved receipt
with note ID, version and indexing status. A completed operation cannot be replaced
by a stale failure; a later save requires a fresh UUID. Receipt validation is only
local structural validation, not proof of server storage, access or indexing.
Runtime receipts come from authenticated responses. Network/ambiguous failures show
**unknown outcome**, not success; retry replays the original request without losing
newer edits. Settings can reconcile a scoped opaque receipt after session loss.
Local persistent storage contains only device enablement/appearance preferences,
public OAuth registration, destination IDs
and at most ten opaque recovery receipts, pruned after seven days; never note bodies,
page/draft URLs, access tokens, refresh tokens or PKCE verifiers. Writing preferences
also retain explicitly approved site origins and personal dictionary words; AI work
ownership stores only opaque IDs in trusted session storage. A missing receipt is not proof
that an uncertain provider operation never happened; do not blindly create a new save.

### Native browser adapters

`browserProfile` distinguishes Chrome/Edge `sidePanel` + service-worker targets
from Firefox `sidebarAction` + event-page targets. The build generates their separate
MV3 manifests from the same source and shared product version.

`openNativePanel` directly calls the supplied native API in the original user event,
before any await, preserving method receiver and user-gesture timing. Missing APIs
and rejected native calls remain errors, with no fabricated success/fallback.

`contextMenuCapture` handles only the two explicit Grove selection/link menu IDs.
It rejects private/unknown-private browsing state and oversized/empty selections.
Selection provenance uses the event frame/page URL rather than a later tab URL.
It does not attribute a parent page title to a frame, a changed tab title to an old
page, or the containing page title to a link target. It performs no browser reads,
storage writes, page traversal, messages or remote I/O. Runtime menus place its
snapshot in the review inbox. Panel RPC accepts only this extension's exact panel
URL/ID, validates bounded requests and fences account/connection changes. Website
writing has a separate, bounded content-script protocol restricted to the verified
extension ID, ordinary top-level non-private tab, granted origin and saved site
choice. Content scripts cannot invoke panel capture/search/auth commands or receive
tokens. No external-message listener, analytics, history, cookie, clipboard-read or
`tabs` permission is included. `scripting` registers bundled writing code only for
opted-in sites; HTTP(S) site host access is optional, never granted to all sites by
default. The configured API/issuer host permissions remain exact.

## Build and verification

```sh
pnpm build:extension
pnpm test:extension
pnpm test:extension:service # disposable real API/worker PostgreSQL roles
pnpm test:writing
pnpm test:writing:service # also needs disposable migration URL; TEST_AMQP_URL enables broker checks
pnpm --filter website exec playwright install chromium
pnpm test:extension:browser
pnpm build
pnpm test:artifacts
```

`build:extension` uses esbuild's browser target, not a native CLI bundle. In addition
to the packages, it keeps the isolated ESM `core.js` and `core.build.json`. Runtime
scripts, fonts, logo, icons and their licenses are local; CSP forbids remote scripts, inline scripts,
dynamic code generation, frames and objects. Network access is limited to the exact
API and issuer hosts. Self-hosted builds may set `--apiOrigin`, `--siteOrigin` and
`--issuer` to exact HTTPS origins; rebuild manifests/CSP and qualify OAuth separately.
No runtime arbitrary-host setting or wildcard redirect is offered.

Firefox host match patterns do not support ports. A custom-port Firefox build
therefore requests only the configured HTTPS hostnames, deduplicated across API and
issuer; exact ports remain enforced by `connect-src` and OAuth endpoint validation.
Chrome/Edge retain the configured port in their permission patterns. Default
production manifests are unchanged. Custom-origin acceptance must use the actual
Firefox network stack, not seeded tokens or intercepted fetch responses.

Root lint/types/build, ordinary TypeScript tests and artifact tests cover the new
core. Artifact checks rebuild in isolated directories, compare deterministic bytes,
restrict the input graph to reviewed core/shared/Zod code, require no external
imports and exercise exports in a sandbox without Node globals, DOM or fetch.
Runtime/package checks also validate deterministic ZIPs/manifests/CSP, trusted
messages, off-state request/menu enforcement and storage feedback. Installed Chromium journeys exercise the real
package with synthetic HTTP/auth, native panel calls, retry, read/context/page
lookup, cross-panel sign-out, unknown-save pause/reopen/resume, theme isolation,
keyboard-switch focus and 320/390/768px accessibility/overflow (including short
windows and dark Settings). Set
`EXTENSION_EDGE_BINARY` to an actual Edge executable for its supplemental host run;
that run checks API acceptance, not the unobserved Edge `onOpened` event.

`MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 python scripts/testing/browser-extension-firefox.py`
uses an isolated native Firefox profile and temporary add-on to check installation,
native sidebar, capture, search and context with synthetic HTTP/auth. This variable
permits test automation of that disposable browser only, not application privilege.
Firefox packaging can also be checked with `pnpm dlx web-ext@10.8.0 lint --source-dir
packages/browser-extension/dist/firefox`. [Visual evidence](design/screenshots/browser-extension/README.md)
states the exact host/source and remaining limits.

## Rollout and acceptance boundaries

Apply migrations `037` and `038` as explicit forward-only owner operations after `036`,
deploy the compatible API/worker, then distribute a matching extension. Source CI
does not do this rollout. Configure optional AI staging/disclosure only after reviewing
the actual generation provider and retention; keep connection writing permission off
until explicitly approved. Local checking needs neither provider nor writing secrets.
Existing stores/provider registration and production
schema are not modified by build or tests. Store identities/signing, real native
OAuth consent/redirect/refresh, authenticated cross-origin production requests, supported
OS/browser-version matrices, suspension/restart recovery and actual first-use timing
still need release acceptance. Writing also needs live-model meaning/quality review
and native writing/permission-removal qualification; synthetic alternatives do not
establish these. In particular, a Chromium fixture is not branded
Chrome acceptance, and Edge method acceptance is not visible-sidebar qualification.
Do not advertise signed/store availability or a proven under-one-minute setup.

### Offline store/reviewer handoff

The package name is **Grove — private notes**. Suggested listing summary:
“Save reviewed notes and sources, search your Grove notebooks, and copy selected
context.” List only the five panel features above; do not promise full-page import,
AI summaries, chat extraction, Safari/mobile, offline search or signed availability.
The product homepage is `https://usegrove.cloud`; legal/privacy declarations and
store-owned support fields need operator review before submission.

| Permission             | Purpose                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `identity`             | Native public-client OAuth sign-in                                                  |
| `storage`              | Trusted session drafts/tokens; bounded public/opaque local state                    |
| `activeTab`            | User-invoked current-page URL/title, never site scraping                            |
| `contextMenus`         | Explicit selection/link/page review inbox                                           |
| `clipboardWrite`       | Copy reviewed context or an explicitly chosen alternative; never read the clipboard |
| `scripting`            | Bind bundled local writing code on explicitly permitted sites                       |
| Optional HTTP(S) sites | User-approved long-form writing checks and explicit sentence tools                  |
| `sidePanel` (Chromium) | Native persistent panel                                                             |
| Exact API/issuer hosts | Authenticated Grove requests and OAuth discovery/exchange                           |

Firefox declares authentication information, website content, browsing activity
and search terms for user-invoked transmission. There is no analytics or automatic
history collection. Operators must verify these declarations and corresponding
Chrome/Edge disclosures against the final production package and privacy policy.

Reviewer checklist: install the matching package; sign in with an operator-approved
disposable identity; approve a narrow Personal/notebook read/write grant; create a
note and review a selection/link capture; search/read it; explicitly look up its
source URL; review/copy selected context; verify read-only/revoked access, unknown-save
recovery and sign-out across panels. Reopen after a browser restart and sign in
again, reconciling any opaque receipts before repeating a save. Never put reviewer
credentials in the package, repository, PR or local plans. Store submission,
developer-account ownership, IDs, signatures, fees and publication require explicit
operator action; these materials do not execute it.
