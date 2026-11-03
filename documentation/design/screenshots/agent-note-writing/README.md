# Agent note-writing examples

Application candidate: `b920ba5` (based on development `06d8740`). Website build:
`7tETW8I6_t_YBuYMXMNbz`, Node 24.21.0 / pnpm 10.33.0.

These are **authored synthetic fixtures**, not generated-model examples or a new
design. They use the actual note reader/editor components and production CSS in
the isolated dashboard fixture. No personal notes, live API writes or paid-model
calls were used. The note-writing policy changes guidance, not the renderer.

| Capture | Review |
| --- | --- |
| [Decision, desktop](decision-1440.png) | 1440px; concise rationale, meaningful sections, comparison table, real tasks and literal JSON |
| [Decision, phone](decision-390.png) | 390px; same complete source, readable wrapping, no page overflow |
| [Preference, narrow phone](preference-320.png) | 320px; one sentence without unnecessary headings or a forced template |

All three cases passed in Chromium and WebKit: expected table/code/task/heading
nodes for the decision; no content headings for the short preference; no page
errors, horizontal overflow or writes; automated WCAG A/AA checks. All three saved
Chromium captures were visually reviewed. WebKit used Playwright 1.64.1 Noble.

Existing regression coverage also passed: five Chromium Markdown/task/preview/
full-page/PDF cases and two supported iPhone/WebKit task/PDF cases. These are
renderer/integration checks, not evidence of live-model compliance, hosted OAuth
acceptance or a full physical-device test matrix.

The input examples and labeled behavior corpus are described in the
[writing guide](../../../agent-note-writing.md). Local execution used the existing
dashboard fixture plus an isolated synthetic API route; no application route,
frontend test file, stylesheet or renderer was changed.
