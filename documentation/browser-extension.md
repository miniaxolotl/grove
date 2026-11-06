# Browser extension

Grove builds unsigned, locally installable extensions for Chrome, Firefox and Edge
from `packages/browser-extension`. Store publication and live provider acceptance
are separate: these packages are not signed Firefox releases or published store
listings. Source behavior and installation are described here; the
[design](design/browser-extension.md) retains the release requirements and deferred scope.

## Install and connect

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

- **Capture:** write a quick Markdown note, choose its notebook and optionally
  review a source link. Context-menu **Save selection**, **Save link** and **Save
  page link** prepare a session inbox; reviewing a capture never saves it. Replacing
  a nonempty draft requires confirmation. At most five inbox captures wait per window.
- **Search:** search active notes in a notebook, load more results, read exact source
  text and open canonical Grove note links. Text is never executed as HTML.
- **Context:** select up to six notes, review the exact text/source links and confirm
  sharing before copying. The aggregate is limited to 6,000 characters. Copy rechecks
  access, lifecycle and versions; changed sources require a fresh review. Clipboard
  failure leaves the reviewed text available for manual copying. Nothing is inserted
  into another website or submitted to a model.
- **This page:** review an exact source URL and choose **Find notes**. Opening the
  panel or changing tabs never discloses the current URL automatically. Matches are
  authorized, active, unexpired captures in the chosen notebook; content edits
  invalidate their page association. There is no full-library client-side scan.
- **Settings**, last in navigation, shows account/access, notebook discovery, privacy,
  recovery receipts, access refresh and sign-out. The last chosen destination is
  remembered per API/account; existing drafts take precedence over inferred defaults.

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
Local persistent storage contains only public OAuth registration, destination IDs
and at most ten opaque recovery receipts, pruned after seven days; never note bodies,
URLs, access tokens, refresh tokens or PKCE verifiers. A missing receipt is not proof
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
URL/ID, validates bounded requests and fences account/connection changes. No content
script, external-message listener, analytics, history, cookie, clipboard-read,
`tabs`, `scripting` or all-sites host permission is included.

## Build and verification

```sh
pnpm build:extension
pnpm test:extension
pnpm test:extension:service # disposable real API/worker PostgreSQL roles
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
messages and storage feedback. Installed Chromium journeys exercise the real
package with synthetic HTTP/auth, native panel calls, retry, read/context/page
lookup, cross-panel sign-out and 320/390/768px accessibility/overflow. Set
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

Apply migration `037` as an explicit forward-only owner operation after `036`,
deploy the compatible API/worker, then distribute a matching extension. Source CI
does not do this rollout. Existing stores/provider registration and production
schema are not modified by build or tests. Store identities/signing, real native
OAuth consent/redirect/refresh, authenticated cross-origin production requests, supported
OS/browser-version matrices, suspension/restart recovery and actual first-use timing
still need release acceptance. In particular, a Chromium fixture is not branded
Chrome acceptance, and Edge method acceptance is not visible-sidebar qualification.
Do not advertise signed/store availability or a proven under-one-minute setup.

### Offline store/reviewer handoff

The package name is **Grove — private notes**. Suggested listing summary:
“Save reviewed notes and sources, search your Grove notebooks, and copy selected
context.” List only the five panel features above; do not promise full-page import,
AI summaries, chat extraction, Safari/mobile, offline search or signed availability.
The product homepage is `https://usegrove.cloud`; legal/privacy declarations and
store-owned support fields need operator review before submission.

| Permission             | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `identity`             | Native public-client OAuth sign-in                               |
| `storage`              | Trusted session drafts/tokens; bounded public/opaque local state |
| `activeTab`            | User-invoked current-page URL/title, never site scraping         |
| `contextMenus`         | Explicit selection/link/page review inbox                        |
| `clipboardWrite`       | Copy only the reviewed context, never read the clipboard         |
| `sidePanel` (Chromium) | Native persistent panel                                          |
| Exact API/issuer hosts | Authenticated Grove requests and OAuth discovery/exchange        |

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
