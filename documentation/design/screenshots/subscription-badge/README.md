# Subscription badge and access source

Actual workspace/account components with production CSS, synthetic identities and
HTTP responses only. No customer data, real payment or live-provider change.

The small outlined badge shares existing utility controls; it adds no mobile row.
Hover/focus reveals the subscription source and actual used/limit counts. Click/tap
keeps it open, with the same details available to touch/keyboard users. Additional
provider/audio limits are collapsed. Account details remain reachable while Billing
is hidden. Existing account typography, palette and notebook navigation are retained.

| Compact badge at rest | Usage on hover, desktop | Usage on phone | Unlimited at 320px |
| --- | --- | --- | --- |
| ![Paid Pro](pro-paid-1440.png) | ![Complimentary Pro](pro-complimentary-1440.png) | ![Complimentary Pro on phone](pro-complimentary-390.png) | ![Complimentary Unlimited at 320px](unlimited-complimentary-320.png) |

Reviewed Chromium captures at1440/390/320px. **24 journeys per Chromium and supported
Noble WebKit** pass. Browser checks cover all five tier/source
combinations across three widths; hover, keyboard and touch;44px targets, WCAG A/AA,
no added mobile row or horizontal overflow/page errors; accurate used/pending/limit
and audio-hour units; idle usage before intent; pending/error/retry, zero/unlimited/
unconfigured/older-response states; short-viewport bounds, focus return, hover
dismissal and Account navigation; account switching and Billing reconciliation.
The local WebKit
host lacks ICU/media libraries; verification uses the documented Playwright1.64.1
Noble image with Node24.21.0 instead of changing the workstation.

Production build and final source verification are recorded in
[delivery evidence](../../../delivery.md#visible-subscription-and-complimentary-access-25-october-2026).
