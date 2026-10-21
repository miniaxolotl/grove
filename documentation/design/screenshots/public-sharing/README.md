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

The integrated 113-case Chromium suite and 28 iPhone 13/WebKit scenarios pass using
Playwright 1.64.1 Noble with Node 24.21.0. Automated WCAG 2A/AA/2.1AA,
overflow, clipboard fallback, held-write/focus, conflict and revocation checks pass.

Integration with landed gesture #58, actions #61 and connections #60 retains these
sharing surfaces and places the phone entry point in Note actions. Sharing follows
the common note/notebook action order, including the compact mobile note header.
