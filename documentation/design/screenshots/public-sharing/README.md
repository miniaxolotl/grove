# Public sharing refinement

Reviewed captures of the implemented UI with synthetic notes, notebooks and link
tokens. Owner controls use the isolated dashboard fixture with production CSS;
signed-out readers use the production-built Next server and synthetic upstream.

- [Note sharing](01-note-sharing.png), Chromium 1440 × 1000: grouped permissions,
  inherited notebook access, integrated URL/open control and primary Copy link.
- [Notebook sharing](02-notebook-sharing.png), Chromium 1440 × 1000: explicit
  subtree scope, live-content explanation and quieter replacement action.
- [Mobile sharing](09-note-sharing-mobile.png), Chromium 390 × 844: 44px controls,
  contained URL field and reachable footer actions.
- [Public notebook](05-public-notebook.png), Chromium 1440 × 1000: scoped notebook
  and note navigation, update dates and bounded pagination.
- [Desktop note](06-public-note-desktop.png) and
  [mobile note](07-public-note-mobile.png), Chromium 1440px / 390px: readable saved
  Markdown, aligned task lists, restrained metadata and quieter spacing.

Additional reviewed captures in the canonical execution plan cover scope options,
revocation, unavailable links and a long-name dialog at 320 × 568. Content remains
inside the viewport and the dialog scrolls to its primary actions.

The full 85-case Chromium suite passed, then all four sharing-control regressions
passed after the final inline-feedback correction. Eight iPhone 13/WebKit scenarios
passed using Playwright 1.64.1 Noble with Node 24.21.0. Automated WCAG 2A/AA/2.1AA,
overflow, clipboard fallback, held-write/focus, conflict and revocation checks pass.

The subsequent integration with gesture PR #58 retains these sharing surfaces and
places the phone entry point in Note actions. Combined verification covers all 97
Chromium cases and 16 iPhone/WebKit cases, including the compact mobile note header.
