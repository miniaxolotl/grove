# Grove website and workspace polish

Captured October 19, 2026 using Playwright Chromium, local website at port 4190
and the isolated dashboard fixture at port 4321. Desktop is 1440px; mobile is
390px. Reduced motion is enabled for stable captures. The website uses its
paper/forest theme. Dashboard content is synthetic; no real account is shown.

- [Desktop homepage](home-desktop.png) and [mobile homepage](home-mobile.png):
  connected-memory hero and corrected Grove mark.
- [Privacy page](privacy-desktop.png): shared legal layout and product-specific text.
- [Mobile library](dashboard-app-390.png), [editor](dashboard-editor-390.png),
  [settings](dashboard-settings-390.png), and [retry state](dashboard-error-390.png).

The connected-accounts panel includes the already-published social sign-in work
from `26b250f`. Hosting remains based on `fb2b990`.

## Verification

- Website ESLint, `next typegen && tsc --noEmit`, and production build pass.
- 19 Playwright tests pass: hosted setup/clipboard, agent tabs, library preview,
  navigation, no-JavaScript content, metadata, editing/archive/restore/delete,
  filtered empty states, service recovery and mobile dashboard accessibility.
- [Route review](route-review.json): home, install, sign-in/up shells, privacy,
  terms and 404; 320/390/768/1024/1440px; no page errors, overflow, or axe
  WCAG A/AA violations including contrast.
- Dashboard fixtures reviewed at 320/390/1440px: populated, empty, editor,
  connection-scope, settings and unavailable-service states; no axe violations.

Local account fixtures verify UI and interactions, not real-provider OAuth.
Production sign-in surfaces are checked separately during publication.

All illustrations are editable SVG/CSS authored for this website.

## Production publication — October 19, 2026

- Live: <https://usegrove.cloud>
- Website source: `94d969553942d2950a0a0beb7e9141731146d431`;
  [PR #9](https://github.com/miniaxolotl/grove/pull/9).
- Vercel deployment: `dpl_2kJf9iTqVGWLUXBpWYs4E4yHeKh1`, independently read
  back as READY with that source SHA and the production domain alias.
- [CI run 39222173127](https://github.com/miniaxolotl/grove/actions/runs/39222173127)
  passed website, database contracts, and image checks.
- [Live route review](live-route-review.json) covers all seven public routes
  at five widths with expected responses, no page errors, document overflow,
  or automated WCAG A/AA violations.
- [Live journeys](live-journeys.json) pass installation switching/copy,
  protected-route redirection, unauthenticated API rejection, navigation,
  metadata and legal-link checks.
- Real Clerk screens rendered successfully:
  [desktop sign-in](sign-in-live-desktop.png), [mobile sign-in](sign-in-live-mobile.png),
  and [mobile sign-up](sign-up-live-mobile.png). These captures contain no account data.

Provider-login completion is not claimed by this review. Signed-in lifecycle,
retry and scope interactions use the isolated dashboard fixtures described above.
