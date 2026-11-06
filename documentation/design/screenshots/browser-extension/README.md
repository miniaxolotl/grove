# Browser extension evidence

## Minimal panel — 6 November 2026

Runtime source `f731ed86` (stacked on #184 at `aeeff000`), product `1.11.14`.
These are actual installed-package views in Chromium `156.0.8078.4`, using the
existing synthetic HTTP/auth fixture, not marketing mocks or live accounts.

| Capture                                                                                | Search                                                                        | Contextual page lookup                                                             | Settings                                                                        |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| ![Editor-first capture with the newer draft kept after retry](minimal-capture-390.png) | ![Search with secondary notebook filtering collapsed](minimal-search-390.png) | ![Page lookup inside Search, only after an explicit request](minimal-page-320.png) | ![Access and privacy, without exposed connection IDs](minimal-settings-390.png) |

[Wide capture view, 768px](minimal-capture-768.png).

Compared with the initial package below: main destinations reduce from four to
three; the note editor precedes notebook selection; technical account/API and save
version details are disclosed on demand. Settings no longer repeats empty recovery
sections or exposes technical IDs by default. Context review appears only after a
selection, including selections from page matches. No feature or consent gate is
removed. The source link remains editable, never fetched or disclosed on tab change.

Installed-package checks exercise both Chromium manifests at320/390/768px across
Capture, both Search modes and Settings, with zero axe violations/overflow and at
most one primary action per view. At390×480, Save remains reachable above the fixed
navigation with source details expanded. Held/failed search preserves inputs and
existing results; unchanged rows retain identity after refresh; selection controls
do not shift results. Exact retry preserves the newer draft, pending recovery stays
visible until confirmed, and sign-out clears another mounted panel. Native Firefox
159.0 also passes temporary-install/sidebar/capture/search/context smoke with
synthetic HTTP/auth. This is not live OAuth or branded Chrome/Edge qualification.

Visual review retains the existing achromatic-ledger direction (seed1300687580),
Grove's Space Grotesk and actual wordmark; no new palette/type/theme or redraw.
Capture answers “what should I keep?”, Search “which note do I need?”, Settings
“what can this connection access?”. Review at all three widths: hierarchy8/10,
usability8/10, identity8/10. The deliberate empty space is an honest short note or
small result set, not fabricated content. The main remaining limits are the
native/live acceptance gates below and owner feedback, not additional decoration.

App-source taste lint reports zero failures; the retained shadow warning is the
real modal overlay. The generic URL inspector cannot install/reach this isolated
extension origin; installed-host screenshots, overflow/focus checks and axe are
used instead, not reported as a passing generic inspector run.

Reproduce with the commands below, directing `EXTENSION_SCREENSHOTS` to a separate
output directory. The additional `*-minimal-<view>-<width>.png` captures cover every
main view at all three widths. Earlier captures below remain historical evidence.

## Initial unsigned package — 5 November 2026

Runtime/build source: `f43240253fe9dfd8aa94bd71e263236e8144e279`, product
version `1.11.14`. Images come from the actual installed unsigned packages,
not a marketing mock or the website. All identities, note text, tokens and HTTP
responses are synthetic fixtures; no real account/provider grant is demonstrated.

| Capture and safe retry                                                                                  | Search and literal source text                                                                    | Settings                                                                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| ![Capture preserves the newer unsaved draft after confirming the original save](chrome-capture-390.png) | ![Selected search result displays script markup as literal text, never HTML](edge-search-390.png) | ![Connection, recovery and session-storage privacy settings](edge-settings-390.png) |

## Reproduce

```sh
pnpm build:extension
pnpm --filter website exec playwright install chromium
EXTENSION_SCREENSHOTS=/tmp/opencode/grove-extension-screenshots pnpm test:extension:browser
MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 python scripts/testing/browser-extension-firefox.py
pnpm dlx web-ext@10.8.0 lint --source-dir packages/browser-extension/dist/firefox
```

The standard installed-package run uses locked Chromium `156.0.8078.4` for both
Chromium manifests. These captures additionally used actual Edge `155.0.4283.62`
for the Edge package via `EXTENSION_EDGE_BINARY`, from an isolated extracted official
package (SHA-256 `3e53834d9d6e505bc57e6bff44d92cfe8cf0bed9064e88efc5b0d8f1c75f70fa`).
Firefox `159.0` temporarily installs the ZIP in an isolated profile, opens its native
sidebar through a real WebDriver gesture and checks capture/search/context.

## Observations and limits

- Screenshots use 390 × 844 CSS-pixel viewports; Settings is a full-page capture of
  a scrollable view. The bottom navigation remains fixed; sign-out is reached by
  scrolling and is exercised in the test. No image is evidence of an entire desktop
  browser's toolbar or of mobile extension support.
- Installed-package checks also cover 320/390/768px overflow and axe, literal
  untrusted source display, loss after commit, exact retry without duplicate notes,
  preservation of a newer draft, reviewed version-bound context, page lookup,
  panel reload and sign-out clearing another mounted panel. The saved receipt
  explicitly distinguishes the original note from the newer unsaved draft.
- Chromium reports the native panel opened. Actual Edge accepts `sidePanel.open`,
  but its visible sidebar/`onOpened` event was not observed in either headless or
  virtual-display execution; that native visual acceptance remains open. Firefox's
  native sidebar is observed open. These do not qualify every toolbar, context-menu,
  shortcut, OS, suspension, token-expiry or restart journey.
- Branded Chrome `157.0.8103.38` did not load the unpacked extension through the
  attempted headless automation path (no installed entry/worker; panel navigation
  was blocked). This is not silently counted as a passing Chrome-host test. The
  Chromium package/native panel checks pass; branded/manual Chrome acceptance is
  still required before a supported three-browser release.
- Native provider consent, OAuth callback delivery, refresh/revocation and actual
  authenticated production fetch are not replaced by seeded session
  tokens or the separate SDK PKCE/discovery fixture. Production migration `037`,
  compatible deployment, signing, store IDs and store publication remain unperformed.
- A separate `EXTENSION_PUBLIC_NETWORK=1` installed-package run verified privileged
  read-only API resource metadata and issuer discovery through the exact packaged
  hosts in Chromium and actual Edge. It made no authenticated request, registration,
  grant, write or provider mutation. This removes a public-fetch/CORS uncertainty,
  not the remaining authenticated/live-consent gates.
- No install-to-first-use timing or physical keyboard/IME/device claim is made.

## Visual review

Achromatic ledger, seed `1300687580`, with Grove's bundled Space Grotesk and mark.
The source citation and exact save receipt are the product-specific elements;
editing and disclosure, rather than decoration, lead the screen. The repeated
left/right edges, restrained borders and reserved feedback area keep the narrow
panel legible. Sparse search results remain honest rather than adding fake notes.
Settings deliberately scrolls instead of shrinking privacy text or hiding controls.

App-source taste lint reports zero failures; its one shadow warning is the real
modal overlay, not a resting card. The generic URL inspector cannot install an
extension or reach its isolated extension origin; installed-host screenshots,
overflow measurements and axe are used instead. Review: hierarchy 8/10, usability
7/10, identity 8/10. Remaining work is native/live acceptance, stronger all-host
recovery/IME qualification and owner review, not a claim of award-level polish.
