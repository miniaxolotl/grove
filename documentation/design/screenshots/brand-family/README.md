# Grove brand family refresh

Captured 20 October 2026 from the production build on the local WireGuard preview
at `http://10.8.0.5:4183`. Desktop: Chromium, 1440 × 1000. Mobile: WebKit,
390 × 1000 with touch. Reduced motion stabilizes captures; images and fonts finish
loading before capture. These are browser captures, not native app screenshots.

- [Desktop homepage](home-desktop.png), [mobile homepage](home-mobile.png):
  notebook-first story, Space Grotesk and JetBrains Mono, forest palette and
  dedicated connected-agent sequence.
- [Design kit](design-kit.png): approved signatures, tokens, licensed fonts,
  banners, social images and individual downloads.
- [Notebook desktop](notebook-desktop.png), [notebook narrow](notebook-mobile.png):
  the isolated dashboard fixture with the production brand fonts and CSS, long
  notebook names and seeded example notes. No customer data or live API writes.
- [Route review](route-review.json): expected responses, no page exceptions,
  document overflow or WCAG A/AA violations in both browser engines.

Verification: repository lint, types, build and five artifact checks pass. All 49
browser cases pass across the full run and the targeted rerun after updating the
brand-font assertion. Coverage includes notebook editing, connection approval,
model settings, nested notebooks, search, graph, keyboard and touch controls.
The install-page contrast finding was fixed by removing translucent code labels.
Visual review also found long notebook destinations extending over the main pane.
The strengthened containment regression failed before bounding the sidebar's grid
track, then passed with the fix.

Artwork is imported byte-for-byte from marketing collection 04, with SHA-256
provenance in `packages/website/design-kit/asset-manifest.json`. Notebook and
agent examples are labelled illustrations. Local signup shows the configured
auth-setup fallback; real authentication is verified through existing fixture
journeys and deployment readback.
