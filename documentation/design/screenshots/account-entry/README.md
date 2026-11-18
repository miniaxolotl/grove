# Account entry without Clerk credentials

Captured November 18, 2026 from the optimized website (`pnpm build:website`,
`next start`, application source `f86cbb57`). Playwright Chromium visited
`/sign-in` and `/sign-up` on loopback with both Clerk keys unset. No account
data or simulated fields were used.

| Viewport | State |
| --- | --- |
| [1440 × 900](sign-in-1440.png) | Sign-in unavailable, light, optional cookies declined |
| [390 × 844](sign-in-390-consent.png) | Sign-in unavailable, light, first visit with cookie choices open |
| [320 × 568](sign-up-320-dark-focus.png) | Sign-up unavailable, dark, keyboard focus on Back to Grove |

Both routes were checked at all three sizes in light and dark. After declining
optional cookies, Tab reached the skip link, home, support, privacy and terms
in order; Enter opened the terms page and returned home from the back link.
There was no horizontal overflow, browser page error or external browser
request. Axe reported no violations for the WCAG 2 A/AA and 2.1 AA tags checked.

These captures exercise the unavailable state only. The Clerk widget, its
loading transition, third-party authorization, redirects after authentication
and physical-device behavior were not exercised in this check.
