# Queued exports

Captured from the production components with synthetic account/task fixtures after
integrating the accepted workspace controls (#76). No private user content is used.

- [Account ready](account-ready.png): authenticated file download.
- [Notebook progress](notebook-progress.png): saved subtree scope, count and cancel.
- [Desktop retry](desktop.png), [390 px](mobile.png), [320 px](compact.png): concise
  status and accessible icon actions alongside the retained-deletion explanation.

`exports.spec.ts` verifies stable request IDs after a failed create response,
downloaded bytes, notebook scope, cancel/retry across navigation, saved scope after
reopening, keyboard dialog dismissal and WCAG A/AA checks at 1440/390/320 px.
All three Chromium cases and the focused iPhone/WebKit checks pass. The integrated
full Chromium suite passes 196 scenarios.
