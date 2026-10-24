# Support/contact website evidence

Captured 24 October 2026 from `feat/website-support-contact`, based on `59f1788`,
with the contact-migration source diff present. Local production-build Chromium,
not a production deployment. No customer data or external fixture media is used.

| Capture                              | Scenario                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| [Policy contact](policy-contact.png) | `/privacy`, 1440 × 1000 viewport; clipped to `.legal-contact` to review the designated email |
| [Support desktop](support-1440.png)  | `/support`, 1440px                                                                           |
| [Support phone](support-390.png)     | `/support`, 390px                                                                            |
| [Contact desktop](contact-1440.png)  | `/contact`, 1440px                                                                           |
| [Contact phone](contact-390.png)     | `/contact`, 390px                                                                            |

Page captures use contact-migration revision `a5ce264` plus the support/contact
diff, a 1000px-tall viewport, reduced motion, and JavaScript disabled. Separate
axe audits use JavaScript-enabled explicit browser contexts. Browser captures
are not native-device/Safari or production-release evidence.

Build using the documented synthetic PostHog/Sentry settings, start Next on a free
localhost port, wait for `document.fonts.ready`, and capture the stated route and
element with Playwright. Reviewed for legibility and wrapping.
