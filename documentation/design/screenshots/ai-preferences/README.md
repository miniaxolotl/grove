# Categorized AI preferences

Captured on 22 October 2026 from `61f4969`, including the merged public-site
refresh. These use the actual workspace components and production CSS in the
isolated browser fixture. All account data is synthetic.

| Viewport | Start                  | End                                     |
| -------- | ---------------------- | --------------------------------------- |
| 1440px   | [Desktop](desktop.png) | [Desktop, scrolled](desktop-bottom.png) |
| 390px    | [Mobile](mobile.png)   | [Mobile, scrolled](mobile-bottom.png)   |
| 320px    | [Compact](compact.png) | [Compact, scrolled](compact-bottom.png) |

Five labelled groups contain ten independent checkboxes. Whole rows are touch
targets; descriptions are associated with each control. Save and its status stay
in the document flow, below the agent controls. The fixture deliberately mixes
enabled/disabled choices and reports an unavailable classification provider while
generation remains available. Unavailable features retain editable preferences.

The iPhone/WebKit run covers keyboard toggling, saved-state reload, independent
controls, held saves/newer edits, failures/retry, persistent navigation, overflow
and WCAG A/AA axe checks. Captures use the Playwright 1.64.1 Noble container. Physical
device keyboards and system controls are outside these emulated browser checks.
