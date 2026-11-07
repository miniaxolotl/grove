# Browser extension

Grove builds unsigned, locally installable extensions for Chrome, Firefox and Edge
from `packages/browser-extension`. Store publication and live provider acceptance
are separate: these packages are not signed Firefox releases or published store
listings. Source behavior and installation are described here; the
[design](design/browser-extension.md) retains the release requirements and deferred scope.

## Install and connect

Install only against a compatible deployed API, including migrations `037`–`039`
after `036` and the native OAuth-origin admission rule below. Default-origin CI packages
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

### Listing and toolbar icons

Packages bundle Grove's dedicated **Listing & toolbar icons**, with approved source
hashes in [`assets/icons/source.json`](../packages/browser-extension/assets/icons/source.json).
Listing PNGs are supplied at 96, 128, 300 and 512px. Firefox selects the transparent
green/white toolbar Sprouts through native `theme_icons`; this follows the browser
theme, independently of the panel's Appearance setting. Chrome/Edge toolbar buttons
and the Firefox sidebar use the supplied green-backed mark as a contrast-safe
fallback, without extra theme permissions. SVG masters are retained in the packages.
These are bundled assets, not evidence of store publication.

## Use the panel

Three tabs keep the panel focused: **Notes**, **Search**, then **Settings**.
The panel uses a quiet sage frame, a paper-like editor and tonal note rows rather
than dashboard chrome. Notebook and source controls share one **Details** disclosure.

### English writing checks

Spelling and basic grammar run locally by default in eligible textareas across normal
website tabs, even while signed out, and they keep working after the anonymous
grace period ends (see below). Notes uses the same checker. Open an underline
or press **Alt+Enter** in the editor, then choose a correction, **Ignore**, or **Add
word**; **All issues** returns from one issue to the full list without rechecking.
Choosing a correction copies it and replaces only that range with native Undo,
without changing an already-submitted save. Clipboard failure leaves the edit intact
and reports that copying was unavailable. Applying a correction updates only
the current draft, never an already-submitted save. Saving does not wait for checks.

Settings → **Writing** contains independent spelling/grammar switches, an Advanced
disclosure for individual rules, automatic checking and highlights, and a personal
dictionary. Parent switches preserve individual choices. Writing switches and domain
exceptions apply browser-wide on this device, including after sign-out. Personal
dictionary words remain scoped to the API/account and English language (with a separate
signed-out dictionary). Upgrade preserves existing opt-outs rather than resetting them.
They do not contain draft text or check results. Turning Grove off overrides them.

The bundled `dictionary-en` 4.0.0 data is SCOWL-derived **American English**, with
`nspell` 2.1.5 for affix-aware lookup. Their MIT/BSD notices are included in the ZIP.
There is no dictionary download, external spelling service or AI request. Basic rules
cover brackets/quotes, **a/an** sound exceptions, repeated words, spacing, obvious
capitalization (including the start of a new line or list item), unambiguous wordy
phrases (**all of the** → **all the**, **in order to** → **to**, **due to the fact
that** → **because**, **in the event that** → **if**, **in spite of the fact that** →
**although**, **on a daily basis** → **daily**, **close proximity** → **proximity**,
**revert back** → **revert**, doubled comparatives (**more better** → **better**,
**most biggest** → **biggest**)), declarative pronoun verb agreement for common
verbs (**he go** → **he goes**, **they goes** → **they go**, **she say** →
**she says**) plus **should of** → **should have** and **he don't** →
**he doesn't**, and plural acronyms before a plural verb (**PR's are** →
**PRs are**) or in decades (**1990's** → **1990s**). Inverted questions keep
their bare verbs (**does he have**, **will she come**) and mandative clauses
keep the base form (**I suggest he go**): the agreement check abstains there
rather than "fixing" correct English. Confused-word
checks cover **its a** → **it's a**, **its been** → **it's been**,
**their gone** → **they're gone** (**your gone** → **you're gone**),
**their is** → **there is**, **suppose to** →
**supposed to**, **bigger then** → **bigger than**, **I use to** →
**I used to** (never after _didn't_), preposition +
**and I** → **and me**, ordinal suffixes (**22th** → **22nd**), common eggcorns
(**weather or not**, **free reign**, **baited breath**, **escape goat**) and
single-token fixes the affix suggester cannot rank (**alot** → **a lot**,
**maintainance** → **maintenance**, **questionairre** → **questionnaire**,
**lisence** → **license**, **speach** → **speech**, **tendancy** → **tendency**,
**wich** → **which**). Spelling alternatives put the obvious fix first:
adjacent transpositions (**teh** → **the**), missing apostrophes (**dont** →
**don't**) and dropped doubled letters (**refered** → **referred**) outrank
unrelated near-edits, then follow the original word's capitalization, and
plural acronyms such as **PRs** are not flagged as misspellings. An article before a
plural-looking noun (**an apples**) abstains: the article is not the real error.
These are not a complete grammar/style analysis. Unknown names can be
added to the dictionary; ambiguous rules abstain rather than guess a replacement.
Possessive acronyms (**the PR's title**), soft-wrapped lines,
much/many and less/fewer are deliberately left alone.
Future UI translations and proofing languages remain separate; only English ships.

There is no per-site setup. Writing → **Check writing everywhere** pauses local
assistance browser-wide; **Domain exceptions** skips a chosen hostname and all its
subdomains, across HTTP(S) and ports. Domain matching uses label boundaries, not
substring matching: blocking `example.com` also blocks `docs.example.com`, but not
`notexample.com` or `example.com.other.test`. A child exception cannot override a
blocked parent. **Use current domain** fills the exact hostname for review; it does
not guess a registrable parent. Remove an exception to inherit browser defaults.

Only eligible multiline textareas are currently bound. HTML inputs,
passwords, usernames, search/subject/title fields, readonly/hidden/code fields and
author opt-outs are excluded before reading their contents. Verification/identity/
address labels and explicit single-line ARIA semantics also exclude a field. Label
inspection is bounded, follows static accessible labels and skips nested editors;
ambiguous or excessive metadata stays unbound. Rich-text/contenteditable
editors are not yet supported by the installed adapter. Domain restrictions cannot
override a globally disabled feature. Browser-withheld site access, restricted pages
and private browsing remain unavailable; extension controls cannot bypass native grants.

Checks cover a bounded 6,000 UTF-16-unit window and expose partial coverage for longer
text; results never replace newer typing. Keystrokes coalesce, dictionary work runs
in the extension background rather than the editor thread, spelling alternatives
are generated only on review, and highlight movement coalesces per animation frame.
Warm latency is a regression measurement, not a universal responsiveness guarantee.
Run `pnpm test:writing` and the installed browser journeys to reproduce the focused
rules, bounds, source/Undo, permission and excluded-field checks.

### Explicit AI writing tools

Select one sentence, then choose **Use AI** (or **Alt+Enter** with a selection).
The compact menu offers **Shorten**, **Expand**, **Rewrite**
and **Humanize**. Only the chosen tool runs. Selection and opening the menu send
nothing. Select a single word instead to see **Synonyms**, **Opposite words**, **Rewrite**
and **Humanize**. Word alternatives are requested from the configured AI provider,
not an offline thesaurus. Opposites deliberately change meaning; review before choosing.
First use shows the selection and configured provider disclosure with
**Generate alternatives**; valid connection-scoped consent is reused across editors
and tools. Changing the provider profile or disclosure requires new consent.

Explicit rewrites also send bounded context from that same eligible editor:
the previous/next sentence, surrounding fragments of the containing sentence, and
whether the selection starts/ends its sentence or paragraph. Each excerpt is capped
at 500 UTF-16 units, from a window of at most 6,000 units around the selection. No
other field, page body, URL or notebook is read for this context. First-use consent
briefly explains that AI uses the selection and nearby text; the result card shows
alternatives, not request excerpts or position flags. Selection/menu opening sends
nothing. Synonyms and opposites
still send only the selected word. Policy `rewrite-context-v3` requires fresh consent
instead of silently reusing selection-only approval. The UI and trusted client both
reject cached selection-only consent before context can leave the browser. Only the selection is replaced;
surrounding sentences/paragraphs are reference, not output.

Grove requests three distinct alternatives and accepts two or three after validation.
The editor remains unchanged until a choice is made. Click an alternative to replace only the
current selection and copy it in the same click, with native Undo. **Copy** alone
does not edit; **Close** dismisses the card. Clipboard failure never rolls back a
successful replacement or reports copy success. Editing, disabling AI
or losing eligibility closes stale results. Humanize means natural conversational
wording, not an AI-detection guarantee. Output can be wrong: structural validation
does not establish factual or semantic equivalence. English is the supported contract;
sentence segmentation is not language detection or an automatic translation feature.

Settings → Writing → **AI writing tools** is independent of spelling and grammar.
Site restrictions and Grove Off still win. Enabling a switch never generates text.
AI needs a separately approved **Allow AI writing tools** permission in
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

- **Notes:** write a Markdown note. The current tab's URL, title and capture time
  fill locally when the panel opens, and follow navigation until the note is edited.
  Typing, changing the destination or starting a save
  pins that note's page. Navigating or reopening the panel never replaces it.
  **New note** resumes following the current tab. Choose the notebook under
  **Details**. Source metadata is automatic, with no source-link fields or controls.
  Authored text stays unchanged; external selections remain quoted. Context-menu
  **Save selection**, **Save link** and **Save
  page link** prepare a session inbox; reviewing a capture never saves it. Replacing
  a nonempty draft requires confirmation. At most five inbox captures wait per window.
- **Search:** one bar searches active notes across every scope approved for this
  connection. No notebook, page selector or submit button is needed. Input waits
  250ms before searching, IME composition waits until committed, and clearing the
  bar clears results without a request. Enter retries immediately. Old responses
  cannot replace newer results, including after pause or sign-out. **Show more**
  uses the server cursor for the same query; unchanged rows stay mounted. Failures
  retain previous results, label them stale and offer **Retry search**. Results
  show bounded, noninteractive Markdown previews, omitting raw HTML. Each has one **Note actions**
  menu with **Open**, **Copy** and **Share**; there are no selection checkboxes or
  bulk actions. Arrow keys, Escape and outside clicks work without moving the list.
- **Read and copy:** opening a result rechecks access and renders its Markdown/GFM
  document: headings, lists, checklists, tables, quotes, code and safe links.
  **Copy note** rechecks its version before copying the original Markdown;
  **Open in Grove** opens the full editor. HTML remains literal text, unsafe links
  are inert and images/media never load automatically. PDF/Word originals are not
  fetched or extracted in the extension; previously imported Markdown is readable.
- **Share:** choose Share from a result's menu or reader, or **Save & share** in Notes.
  A new note saves first; changed/uncertain drafts cannot publish an older snapshot.
  The compact dialog identifies the note without reopening a full reader. Its
  title expands a saved-note preview; **Link options** holds expiry (initially one
  week), the URL and **Turn off link**. **Create link** explicitly publishes; the
  single main action then becomes **Copy link**, which rechecks current sharing
  access. Clipboard failure expands the options and selects the real URL for
  manual copying. Escape returns to the invoking note action. Unknown outcomes
  offer **Check sharing**, not an
  automatic second publication. Sharing needs its own owner-approved **Allow sharing
  links for accessible notes** permission in Grove Connections; note access alone
  is insufficient. See [sharing](sharing.md#extension-note-links).
- **Settings**, last in navigation, provides appearance, writing options, account
  access and a short privacy summary. IDs, backend addresses, storage/worker details
  and raw provider/validation errors are not shown. Unconfirmed saves show recovery actions; a
  confirmed receipt removes the corresponding pending item. Access management,
  notebook discovery, refresh and sign-out remain available. The last chosen
  destination is remembered per API/account; existing drafts take precedence.
  System/light/dark appearance saves automatically on this device. Enablement has
  one home in the persistent header. Search has one result list and copy action.

### Anonymous grace and trial

The extension works without an account. Local spelling and basic grammar checks
run signed out from install and keep working after the grace period ends; they
never require sign-in, contact Grove, or consume any quota.

Saving, search, capture, reader sharing, and AI writing tools need an account.
For the first **14 days** after install the signed-out panel invites you to try
these with a free account; after day 14 it asks you to create a free account to
continue them. The install date is stored on the device (`chrome.storage.local`,
with a `chrome.storage.sync` backup when browser sync is on). Reinstalling keeps
the original date while sync backup exists; with sync off a reinstall restarts
the local-only grace. This is best-effort and documented: the grace only times
the signup nudge, never Pro access. Once you create an account, Settings →
Billing offers a single-use **7-day Pro trial** with full Pro allowances (card
required; converts to paid unless cancelled). Each account gets one trial; an
administrator can restore eligibility. See [billing](billing.md#subscriptions).

Notes opens directly to the editor. Save outcome and newer unsaved edits
remain visible without version/indexing diagnostics.
There are no source-link fields. Mounted approved panels follow source metadata
locally until the first edit pins it; only explicit Save transmits it. Context-menu
captures keep their original event source. Unknown/failed-save
retries retain the exact original provenance snapshot even after a tab change.
Restricted/private pages produce no automatic source. Required consent and uncertain-
save safeguards remain; automatic provenance is not automatic note capture.

### Turn Grove on or off

The single header switch is always available, including in Settings and while off.
There is no second enable/resume control to keep in sync. Turning Grove
off persists on this device across panel reloads and browser restarts, removes its
context-menu entries and adds an **OFF** toolbar badge. The toolbar/shortcut still
opens the native panel so Grove can be turned on again. Off blocks extension API
requests, sign-in/refresh, captures, search, reads, source attachment and sharing
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
Search preserves its input/results when switching views. Unchanged rows remain
mounted during refresh. Per-note actions recheck access and saved versions; a
focused action menu returns focus to its trigger, and sharing never publishes
just because its dialog opened.

Internal/file pages cannot be attached; private browsing is disabled. An untouched
draft clears its automatic source when a readable web URL is unavailable; edited
drafts retain their pinned source. The owner-approved `tabs` permission reads
active-tab URL/title across sites and may show a browsing-history warning on install
or update. It does not grant document contents or history API access. Only mounted,
enabled, approved panels follow their own window's active tab; no navigation listener
collects browsing data in the background. Source values stay in scoped session
storage and reach Grove only on explicit save, never from navigation or search.

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
notes retain their authored Markdown unchanged, with automatic provenance stored
separately rather than appended to the body.
Drafts distinguish authored text from context-menu excerpts; existing legacy source
drafts keep their original quoted formatting and unresolved saves keep exact bytes.
Link-only captures are supported. The shared
6,000-character note limit includes attribution for quoted external captures; overflow is
rejected, never truncated or split. A valid source can still contain sensitive query
parameters. Its hostname is visible under Details before an explicit Save; following
a tab never sends its metadata to Grove or fetches the page body.

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

`@lib/shared/writing-assistance` owns tool identities, word/sentence selection and
strict request/output bounds: 2,000 UTF-16 units per sentence, up to three alternatives
of at most 4,000 units each. Requests contain an operation UUID, editor-session UUID,
`language: en`, explicit tool and selected text in the `sentence` field. Optional
rewrite `context` contains only four bounded excerpts plus sentence/paragraph
start/end flags, never separate browser metadata or retrieved notes. Excerpts may
contain anything the user typed, including a URL or private detail. First-use
approval explicitly covers nearby text. Context shares encrypted staging, exact replay
identity and expiry with the selection; opaque queue payloads remain unchanged.
Synonyms/opposites require one word of at most 80 units and reject context;
their returned alternatives are also limited to 80 units. Other tools use one sentence.
Except for requested opposite words, the provider is asked to preserve meaning,
names, numbers, negation and uncertainty, and to treat the selection as data rather
than instructions. Opposites deliberately reverse the word's meaning. Grove retrieves
no external context or tools for a rewrite. The provider is told to use supplied
editor excerpts only to fit the selection, never repeat or rewrite them. This is
not a semantic-safety guarantee.

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

Draft source ownership is persisted as automatic or pinned. The first local edit
fences late metadata before storage responds. Manual removal stays removed even if
the editor is emptied. Legacy drafts are protected; only truly pristine legacy
drafts can start following automatically. Repeated identical URL/title observations
do not change capture time, extend expiry or churn storage. Inbox captures remain
pinned to their original event snapshot rather than a later tab destination.

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
**Save not confirmed**, not success; retry replays the original request without losing
newer edits. Settings can reconcile a scoped opaque receipt after session loss.
Local persistent storage contains only device enablement/appearance preferences,
public OAuth registration, destination IDs
and at most ten opaque recovery receipts, pruned after seven days; never note bodies,
page/draft URLs, access tokens, refresh tokens or PKCE verifiers. Writing preferences
also retain explicit domain exceptions and personal dictionary words; AI work
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
extension ID, ordinary top-level non-private tab, native origin access and effective
browser/domain settings. Content scripts cannot invoke panel capture/search/auth commands or receive
tokens. No external-message listener, analytics, history, cookie or clipboard-read
permission is included. Approved `tabs` metadata access supports mounted-panel source
following. Bundled content scripts run on ordinary HTTP(S) tabs
by default, guarded before field reads. Broad HTTP(S) host access is declared for
local writing and may require native installation/update approval; users can withhold
it in the browser. Network CSP still permits only the exact configured API/issuer;
writing text is never sent by local checks. `scripting` attaches to already-open tabs
on installation and removes legacy optional-site registrations.

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
Chrome/Edge retain the configured port in their API/issuer permission patterns.
Local writing also declares broad HTTP(S) access in every target, without widening
network CSP. Custom-origin acceptance must use the actual
Firefox network stack, not seeded tokens or intercepted fetch responses.

Root lint/types/build, ordinary TypeScript tests and artifact tests cover the new
core. Fast `test:extension` runs capture, drafts, platform, oauth, client plus
messages, webextension guards, reader summaries/rendering, share-URL validation
and clipboard helpers. Artifact checks rebuild in isolated directories, compare deterministic bytes,
restrict the input graph to reviewed core/shared/Zod code, require no external
imports and exercise exports in a sandbox without Node globals, DOM or fetch.
Runtime/package checks also validate deterministic ZIPs/manifests/CSP, trusted
messages, off-state request/menu enforcement and storage feedback. Installed Chromium journeys exercise the real
package with synthetic HTTP/auth, native panel calls, retry, reading/copying,
sharing, cross-panel sign-out, unknown-save pause/reopen/resume, theme isolation,
keyboard-switch focus and 320/390/768px accessibility/overflow (including short
windows and dark Settings). Set
`EXTENSION_EDGE_BINARY` to an actual Edge executable for its supplemental host run;
that run checks API acceptance, not the unobserved Edge `onOpened` event.

`MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 python scripts/testing/browser-extension-firefox.py`
uses an isolated native Firefox profile and temporary add-on to check installation,
native sidebar, capture, formatted search and reader/copy with synthetic HTTP/auth. This variable
permits test automation of that disposable browser only, not application privilege.
Firefox packaging can also be checked with `pnpm dlx web-ext@10.8.0 lint --source-dir
packages/browser-extension/dist/firefox`. [Visual evidence](design/screenshots/browser-extension/README.md)
states the exact host/source and remaining limits.

## Rollout and acceptance boundaries

Apply migrations `037`–`039` as explicit forward-only owner operations after `036`,
deploy the compatible API/worker, then distribute a matching extension. Source CI
does not do this rollout. Configure optional AI staging/disclosure only after reviewing
the actual generation provider and retention; keep connection writing permission off
until explicitly approved. Sharing permission likewise defaults off and needs
separate owner approval; reading alone never authorizes publication. Local checking
needs neither provider nor writing secrets.
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
“Save notes and sources, search your Grove notebooks, and share a thought.”
List only documented panel features; do not promise full-page import,
AI summaries, chat extraction, Safari/mobile, offline search or signed availability.
The product homepage is `https://usegrove.cloud`; legal/privacy declarations and
store-owned support fields need operator review before submission.

| Permission             | Purpose                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `identity`             | Native public-client OAuth sign-in                                                      |
| `storage`              | Trusted session drafts/tokens; bounded public/opaque local state                        |
| `activeTab`            | User-invoked current-page URL/title, never site scraping                                |
| `tabs`                 | Local active-tab source following in mounted approved panels, never history collection  |
| `contextMenus`         | Explicit selection/link/page review inbox                                               |
| `clipboardWrite`       | Copy one note, a sharing link or a chosen writing alternative; never read the clipboard |
| `scripting`            | Attach bundled local checks to already-open normal tabs; inspect no excluded fields     |
| HTTP(S) hosts          | Default-on local writing, subject to native grants and browser/domain opt-outs          |
| `sidePanel` (Chromium) | Native persistent panel                                                                 |
| Exact API/issuer hosts | Authenticated Grove requests and OAuth discovery/exchange                               |

Firefox declares authentication information, website content, browsing activity
and search terms for user-invoked transmission. There is no analytics or automatic
history collection. Operators must verify these declarations and corresponding
Chrome/Edge disclosures against the final production package and privacy policy.

Reviewer checklist: install the matching package; check an eligible textarea while
signed out; disable checks browser-wide and for a domain plus its subdomains;
verify sensitive-field exclusions and correction copy/replace/Undo. Sign in with an operator-approved
disposable identity; approve a narrow Personal/notebook read/write grant; create a
note and review a selection/link capture; search/read/copy it with its result menu;
approve sharing separately and create/copy/revoke a disposable note link; verify
read-only/revoked access, unknown-save
recovery and sign-out across panels. Reopen after a browser restart and sign in
again, reconciling any opaque receipts before repeating a save. Never put reviewer
credentials in the package, repository, PR or local plans. Store submission,
developer-account ownership, IDs, signatures, fees and publication require explicit
operator action; these materials do not execute it.
