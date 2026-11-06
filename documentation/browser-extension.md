# Browser extension developer core

Grove's extension is **in development, not installable or released**. The private
`packages/browser-extension` package contains a browser-safe core for the planned
Chrome, Firefox and Edge extension. The [release proposal](design/browser-extension.md)
defines the remaining scope and gates. There is no manifest, sign-in surface, saved
capture endpoint, browser storage adapter or store package yet.

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

These helpers **do not** extend the live `remember`/REST schemas. A future authorized
capture service must atomically persist note and provenance under current grants,
with scoped URL lookup, lifecycle/export/recovery handling and real RLS tests.

### Draft and save snapshots

`createCaptureDraft`, `readCaptureDraft` and `editCaptureDraft` operate on data,
not browser storage. Reads require the exact HTTPS API origin, account and connection,
and reject malformed data, future updates and expired drafts. Drafts have a fixed
24-hour maximum from creation; edits cannot extend it. Caller code must remove
rejected values and clear session data on sign-out/session end. No browser restart
recovery, token storage or encryption is implemented by these functions.

`prepareCaptureSave` creates an independent local command snapshot with an
operation UUID, formatted content, notebook and optional provenance. It is **not a
currently supported HTTP request body**. A caller must preserve the snapshot
in its scoped session storage before sending it through the future authorized
transport. While a save is unresolved, only the same UUID and exact snapshot can be
retried; newer edits/destinations stay in the draft without altering the snapshot.

`settleCaptureSave` accepts failed/uncertain outcomes or a matching saved receipt
with note ID, version and indexing status. A completed operation cannot be replaced
by a stale failure; a later save requires a fresh UUID. Receipt validation is only
local structural validation, **not proof of server storage, access or indexing**.
Callers must derive receipts from authenticated API responses, recheck grants and
reconcile uncertainty after session loss before starting another operation.

### Native browser adapters

`browserProfile` distinguishes Chrome/Edge `sidePanel` + service-worker targets
from Firefox `sidebarAction` + event-page targets. These descriptors are not complete
manifests and do not establish a minimum supported version or host acceptance.

`openNativePanel` directly calls the supplied native API in the original user event,
before any await, preserving method receiver and user-gesture timing. Missing APIs
and rejected native calls remain errors, with no fabricated success/fallback.

`contextMenuCapture` handles only the two explicit Grove selection/link menu IDs.
It rejects private/unknown-private browsing state and oversized/empty selections.
Selection provenance uses the event frame/page URL rather than a later tab URL.
It does not attribute a parent page title to a frame, a changed tab title to an old
page, or the containing page title to a link target. It performs no browser reads,
storage writes, page traversal, messages or remote I/O. Menu registration and trusted
event/message boundaries remain to be integrated; the helper is not a consent proof.

## Build and verification

```sh
pnpm build:extension
pnpm test:extension
pnpm build
pnpm test:artifacts
```

`build:extension` uses the existing esbuild toolchain with `platform: browser`, ESM
and ES2022, not the native CLI bundle. It produces only internal `dist/core.js` and
`dist/core.build.json` (source product version, target names, hash, size and input/
import inventory). The private package has no independent product version. No
manifest, credential, deployment or store artifact is generated.

Root lint/types/build, ordinary TypeScript tests and artifact tests cover the new
core. Artifact checks rebuild in isolated directories, compare deterministic bytes,
restrict the input graph to reviewed core/shared/Zod code, require no external
imports and exercise exports in a sandbox without Node globals, DOM or fetch.
Native API doubles prove call contracts/timing, **not real extension installation,
OAuth redirects, browser suspension or account/grant enforcement**.

Remaining gates are real native-panel and identity feasibility in all three browsers,
operator-approved provider/store identities, API/provenance and uncertainty recovery,
actual session storage, sign-in and the five user-facing features. Continue in the
same implementation PR with atomic commits; keep it draft until the full release
checklist is satisfied. No screenshot is relevant before UI exists. No live schema,
provider, deployment or publication action follows from building this core.
