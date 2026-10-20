# Compact workspace and Ask Grove

Captured from the isolated dashboard fixture with the production build's fonts
and CSS. All note content is synthetic. Desktop Chromium: 1440 × 1000; touch
Chromium: 390 × 844. These are browser captures, not native app screenshots.

- [Workspace](workspace-desktop.png): one notebook tree with nested note links,
  compact library controls and grouped navigation.
- [Focus mode](focus-desktop.png): full-viewport writing with secondary tools hidden.
- [Plain composer](composer-plain-desktop.png) and
  [Markdown composer](composer-markdown-desktop.png): auto-growing text, an optional
  formatting toolbar and a quiet mode toggle.
- [Touch composer](composer-markdown-mobile.png): the same interaction at 390px.
- [Settings](settings-desktop.png): Preferences, Account, Connections and Your data.
- [Desktop graph](graph-desktop.png) and [narrow graph](graph-mobile.png): the
  workspace palette and correctly fitted nodes after resizing (browser fixture,
  1440 × 1000 and 390 × 1000).

[Review results](review.json) record no page exceptions, horizontal overflow or
automated WCAG A/AA violations on the six new captures. The graph regression also
checks node centers stay within the canvas after viewport changes.

All 55 Chromium browser cases pass. Three additional WebKit/iPhone-emulation
scenarios pass in the Playwright 1.64.1 Ubuntu container: composer growth,
selection/formatting/undo/send; scoped search and dialog dismissal; touch menu
scrolling. Chromium's CDP swipe case remains in the primary suite.
