# Unified note workspace

Reviewed browser captures from the isolated dashboard fixture, with production
CSS and local fonts. Notes, notebooks and account details are synthetic.

- [Desktop drawer](note-drawer-desktop.png), Chromium 1440 × 1000: the wider
  persistent workspace, reading/editing toggle, collapsed connections and copy
  toast. The test verifies unchanged content geometry after copying.
- [Mobile drawer](note-drawer-mobile.png), Chromium 390 × 844: contained drawer
  bounds, accessible actions and mode switch, with no horizontal overflow.
- [Settings](settings-mobile.png), Chromium 320 × 750: persistent heading and
  horizontally scrollable section navigation, with independently scrolling content.
- [Revision comparison](revision-history.png), desktop Chromium: version-fenced
  history remains available from the same workspace.

All 75 Chromium scenarios passed, including the scrollbar-gutter drawer correction
and first-save modal focus/command regressions. Seven iPhone/WebKit scenarios passed: settings
navigation and toast geometry, long-note scrolling and mode-position restoration,
mobile notebook creation, formatting/history/preview, long notebook menus, and
first-save command and shortcut-help focus/preview retention.
Responsive captures and WCAG A/AA checks passed. These are browser captures.
