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
