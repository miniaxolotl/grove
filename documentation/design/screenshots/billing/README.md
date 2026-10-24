# Billing interface

One open settings sheet presents the current plan, four labelled usage meters,
short renewal/reset dates and a compact Pro upgrade. Payment recovery is a single
Update payment action. Customer copy omits providers, API limits and internal
accounting explanations; the operational contract remains in the billing guide.

Synthetic Free/Pro accounts, Stripe-hosted destination fixtures and fixed UTC reset
dates. The displayed **$5 USD/month** matches the approved launch amount and numeric
Vercel flag. Accounts and usage in the screenshots are synthetic; no payment is made.

The actual Billing component is bundled by the isolated dashboard fixture and
uses production CSS from Next build `sFGD0Z_d662VWpGdY-UIm`, based on billing source
`8ca18d0` plus the minimalist interface refinement. Node24.21.0 / pnpm10.33.0, Chromium and
Playwright1.64.1 Noble container iPhone/WebKit; locale en-US, local timezone shown
in each capture. Pro's monthly allowances are disclosed before opening Checkout.

| Free, desktop | Pro cancellation, phone | Free, narrow phone |
| --- | --- | --- |
| ![Free usage and checkout](chromium-free-1440.png) | ![Pro with scheduled cancellation](chromium-pro-390.png) | ![Narrow Free checkout](chromium-free-320.png) |

Each engine covers widths 1440, 390 and 320 for `free`, `pro` and `payment` captures.
The additional `usage-320` capture brings the last usage meter into view. The compact
screen often fits without scrolling at this height. Links show the WebKit subset:

| Free | Pro | Payment attention |
| --- | --- | --- |
| ![WebKit Free](webkit-free-390.png) | ![WebKit Pro](webkit-pro-390.png) | ![WebKit payment attention](webkit-payment-320.png) |

Both-engine journeys check labelled usage meters, exhausted allowance, 5-dollar pricing,
zero writes on open, keyboard focus, double-submit suppression, hosted Checkout,
Pro state after return, period-end cancellation, portal access while enabled,
complete removal of billing details after a flag-off 404,
load/checkout retry and past-due recovery, WCAG A/AA, no backend details in visible
copy and no document overflow/browser errors. Late font loading must keep the
complete active Billing tab in view on narrow screens.
Backend tests separately cover real PostgreSQL/RLS and actual Stripe SDK requests
to a loopback provider. These screenshots do not establish real Stripe payment,
Vercel flag targeting, physical-device keyboard or production rollout acceptance.
