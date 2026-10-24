# Support/contact website evidence

Captured 24 October 2026 from `feat/website-support-contact`, based on `59f1788`,
with the contact-migration source diff present. Local production-build Chromium,
not a production deployment. No customer data or external fixture media is used.

| Capture                              | Scenario                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| [Policy contact](policy-contact.png) | `/privacy`, 1440 × 1000 viewport; clipped to `.legal-contact` to review the designated email |

Build using the documented synthetic PostHog/Sentry settings, start Next on a free
localhost port, wait for `document.fonts.ready`, and capture the stated route and
element with Playwright. Reviewed for legibility and wrapping.
