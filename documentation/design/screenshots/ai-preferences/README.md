# Settings and categorized AI preferences

Captured on 22 October 2026 from settings polish `8ef350e` and the final tab-visibility
fix `e3744a8`, including the merged public-site refresh. These use actual workspace
components and production CSS in the isolated browser fixture. All data is synthetic.

| Viewport | Start                  | End                                     |
| -------- | ---------------------- | --------------------------------------- |
| 1440px   | [Desktop](desktop.png) | [Desktop, scrolled](desktop-bottom.png) |
| 390px    | [Mobile](mobile.png)   | [Mobile, scrolled](mobile-bottom.png)   |
| 320px    | [Compact](compact.png) | [Compact, scrolled](compact-bottom.png) |

- AI availability: [desktop](ai-services.png), [320px](ai-services-mobile.png).
- Self-hosted provider settings: [desktop](provider-settings.png),
  [320px save controls](provider-settings-mobile.png).
- [Account at 390px](account-mobile.png) and [Your data at 320px](data-mobile.png).

Five labelled groups contain ten native checkboxes styled as toggles. Whole rows
are touch targets; descriptions are associated with each control. Save, Discard
and status stay in the document flow. The fixture deliberately mixes
enabled/disabled choices and reports an unavailable classification provider while
generation remains available. Unavailable features retain editable preferences.

The settings layout retains drafts and held saves when switching sections. A quiet
dot marks unsaved preferences. The current section stays visible on resize, with
space for focus rings and rounded browser scroll offsets. Provider forms reuse
Save/Discard feedback, keep masked keys after failure and use two columns on desktop.

The iPhone/WebKit run covers keyboard toggling, saved-state reload, independent
controls, held saves/newer edits, failures/retry, draft navigation/discard, session
replacement, provider forms, overflow and WCAG A/AA axe checks. Captures use the
Playwright 1.64.1 Noble container. Physical
device keyboards and system controls are outside these emulated browser checks.
