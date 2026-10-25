# Search quality

Synthetic notes only, using the actual global-search components and production
CSS build **`HArZBbGDgVxsAh2HMACkD`**, Node 24.21.0/pnpm 10.33.0. No owner notes,
provider calls, real identities or production settings are used.

- `prefix-desktop.png` (1440×850 CSS px): title and passage prefix marks.
- `prefix-phone.png` (390×850): viewport-contained palette and source context.
- `prefix-narrow.png` (320×850): narrow-screen wrapping/ellipsis without overflow.
- `typo-phone.png` (390×850): ordinary source excerpt with **no invented fuzzy
  highlights**. Typo lookup itself is qualified by real database/service tests.

Captures are Chromium images from the committed `search quality` cases in
`packages/website/tests/workspace.spec.ts`; the same scenarios pass with touch/
mobile WebKit in the pinned Playwright1.64.1 Noble image. Payload evidence is
synthetic and explicitly labelled: these images verify rendering, not SQL
matching or production latency. Backend service/REST/migration tests independently
verify title tiers, all-term prefix/typo recovery, scope and version/profile rules.

The integrated 244-case Chromium suite and eight focused touch/mobile WebKit
cases pass for the application UI. Checks include WCAG A/AA contrast, no horizontal
overflow, stale-evidence rejection, explicit date-sort retention, global lexical
shortfall behavior, anchored input/retry and stale-cursor restart. The first
contrast run found4.34:1 muted text on marked backgrounds; the final mark uses
Grove's existing forest token, preserving forced-color Highlight/HighlightText.

Application code was developed on base `05fe8fd` and integrated with development
`06d8740` before these captures; the feature PR records the source commit.
These captures are source-review evidence, not a
release/deployment or physical-device keyboard qualification.
