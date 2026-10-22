# Timed sharing

Synthetic note and notebook fixtures, production styles, Chromium at 1440×800,
390×800 and 320×800. Captured by `timed sharing offers six durations, stages expiry
edits and preserves retry deadlines` in `packages/website/tests/workspace.spec.ts`.
The displayed capability is a nonfunctional fixture.

- [Desktop](desktop.png)
- [390px phone](phone.png)
- [320px phone](narrow.png)

The images show a four-hour link after replacement: expiry remains visible and
the deadline is retained. The browser case also covers all six duration choices,
uncertain-response retries, staged/cancelled settings, unchanged URLs after edits,
WCAG A/AA checks and horizontal bounds. A separate clock-controlled case removes
Copy/Open at expiry and verifies renewal through a new link.

All seven focused iPhone13/WebKit reader/timed-link cases also pass in Playwright
1.64.1's Noble container, including phone Note actions entry and auth isolation.
