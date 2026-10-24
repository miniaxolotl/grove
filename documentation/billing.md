# Billing and usage

Grove Cloud starts on **Free**. **Pro** increases AI allowances through a Stripe
subscription; it does not sell a prepaid credit balance. Pro starts at **$5 USD/month**.
The Vercel number flag `billing-pro-monthly-usd` controls the displayed amount and
the amount charged for new monthly subscriptions. No yearly price is offered in
the configured Cloud launch.

The server validates whole-cent USD amounts between 1 and 10,000 dollars, resolves
an immutable Stripe Price under the configured Grove Pro product, and refuses an
outdated browser quote with `billing_price_changed`. Missing/invalid flag evaluation
stops new checkout rather than silently charging a fallback amount. Changing the
flag does not reprice existing subscriptions; product-based entitlement preserves
their Pro access. Reusing an open checkout retains its original agreed price;
review the new amount after that checkout expires before starting another.

| Usage                       | Free                    | Pro                      |
| --------------------------- | ----------------------- | ------------------------ |
| AI generation requests      | 10/day; 100/month       | 200/day; 2,000/month     |
| Web research provider calls | 3/day; 10/month         | 20/day; 200/month        |
| Transcription               | 10 minutes/month        | 120 minutes/month        |
| Read-aloud text             | 10,000 characters/month | 200,000 characters/month |

These are configurable launch defaults, not measured cost guarantees. Generation
includes background titles, organization, relationships, summaries and Ask Grove.
One visible action may reserve several provider requests. Embeddings and basic
classification do not consume the generation allowance. Transcription measures
original duration in milliseconds; read aloud measures JavaScript UTF-16 units.
All voices share one synthesis allowance.

Counters reserve **attempts**, including retries, before dispatch. Uncertain,
failed or cancelled provider calls do not promise refunds. Reusing a valid cached
result does not reserve another attempt. Research has both per-account allowances
and an independent installation-wide estimated monthly provider-spend cap.

Allowances reset at **UTC midnight** and the **first of each UTC calendar month**,
not the subscription renewal date. They do not roll over. The Billing page shows
monthly usage meters, daily counts and short local reset dates. Usage
already recorded in the current month counts when a rollout or upgrade starts.
Daily protections still apply: 180 API operations/minute/account, 2,000 total AI
attempts/day/account, and 20 speech attempts/day/type with 10 transcription minutes
or 60,000 synthesis units/day. A larger monthly allowance does not remove these
caps. Shared provider limits may also stop dispatch earlier.

Writing, reading, editing, basic search and exporting remain available at the AI
allowance. Generation workers defer at their existing daily retry boundary rather
than consuming further provider calls. Research can return an explicitly incomplete
answer; speech reports an allowance failure without removing original recordings,
saved transcripts or notes. Upgrade or wait for the relevant reset; there are no
automatic overage charges.

## Subscriptions

- **Settings → Billing** opens Stripe-hosted Checkout and the customer portal.
  The browser supplies an interval and the last displayed amount in cents, never
  customer, account, Stripe Price ID or return URL. The amount is a stale-quote
  check, not permission to choose a different charge.
- Only the owning website session can manage subscriptions. Connected agents and
  API keys cannot check out or open billing management.
- Customer/account mappings and subscriptions are tenant-isolated. Workers read
  subscription entitlements but cannot write them. A narrow owner function resolves
  a signed webhook customer before entering the tenant context; it works with a
  non-superuser migration owner.
- Canonical Stripe subscriptions, not the Checkout redirect, determine entitlement.
  Only a recognized, single-item, quantity-one `active` or `trialing` subscription
  with a future period end receives Pro. Other states use Free. Period-end
  cancellation preserves Pro until the period ends; past-due/unpaid subscriptions
  need attention in the portal.
- Customer creation has an account idempotency key. Checkout reserves an operation
  and its price before the remote write, serializes competing requests, reuses an
  open checkout and refuses a second ongoing subscription. Expired checkouts can
  be replaced. Billing reads reconcile from Stripe, including after a lost webhook.
- Signed webhooks reconcile current Stripe state under the same customer lock.
  Duplicate event IDs are recorded only after successful reconciliation, and
  out-of-order event bodies cannot restore obsolete entitlement. Raw event bodies,
  payment details and invoice contents are not stored.
- Account deletion cancels subscriptions and expires known open checkouts before
  removing access. Worker cleanup repeats cancellation for identity-provider-led
  deletion, retrying failures; late signed events for closed accounts also cancel
  renewal. Provider customer/invoice records are retained, not deleted.

## Vercel feature flag

The **`billing-enabled`** boolean is evaluated server-side using the same Clerk
user ID entity in Next.js, API and worker processes. It defaults **false**. The
Next.js Flags SDK declaration uses `@flags-sdk/vercel`; the off-Vercel API/worker
uses `@vercel/flags-core` with a project/environment SDK key. Website flag overrides
cannot override API/worker authorization or entitlements.

`BILLING_CONFIGURED=false` leaves billing unconfigured and self-hosting unchanged.
When configured, the flag controls subscriptions, all billing information and
plan quota enforcement. **Off hides Settings navigation, returns 404 for the billing
page/API/portal, and removes previously loaded billing details on refresh.**
The open Billing page refreshes every minute. Turning it off resumes pre-existing
safety limits; it does not cancel subscriptions or stop Stripe renewals. Webhooks
and account-deletion cancellation remain active. Keep credentials installed for
that lifecycle handling; while hidden, customer requests can be managed in Stripe.

Flags Explorer discovery is available at `/.well-known/vercel/flags` using the
SDK's `FLAGS_SECRET` authentication. Set up the Vercel flag with false defaults
for every environment, and enable an internal-user cohort before broader rollout.

## Configuration

API and worker use matching values:

```sh
GROVE_EDITION=cloud
BILLING_CONFIGURED=true
FLAGS=YOUR_VERCEL_ENVIRONMENT_SDK_KEY
STRIPE_SECRET_KEY=YOUR_SERVER_STRIPE_KEY
STRIPE_WEBHOOK_SECRET=YOUR_ENDPOINT_SIGNING_SECRET
STRIPE_PRO_PRODUCT_ID=prod_YOUR_GROVE_PRODUCT
STRIPE_PORTAL_CONFIGURATION_ID=bpc_YOUR_GROVE_PORTAL
```

Use a dedicated Grove product and active, licensed recurring monthly USD prices
with interval count one. Runtime needs Customers/Subscriptions/Checkout/Portal/Prices
write and Products read; restricted `rk_live_` keys are supported. Stripe test/live
keys, products and webhook endpoints must all belong to the same mode. The optional
legacy fixed `STRIPE_PRO_MONTHLY_PRICE_ID`/`STRIPE_PRO_YEARLY_PRICE_ID` path remains
available, but product/flag pricing takes precedence. Preserve recognized legacy
IDs for existing subscribers when migrating to the product path.
Configure the portal to allow payment updates and cancellation, but not arbitrary
price/quantity changes. Configure tax, payment methods, receipts, legal details and
customer support in Stripe before accepting payments.

The Vercel website needs `BILLING_CONFIGURED=true`, its existing Clerk/API settings,
and the project's flag OIDC integration/`FLAGS_SECRET`. It needs **no Stripe key**.
For local flag development, link the intended Vercel project and use `vercel env
pull`; do not put credentials in source or client-prefixed variables. Outside
Vercel, the website can also use the matching `FLAGS` SDK key.

Allowances are configured by `BILLING_{FREE,PRO}_GENERATION_{DAILY,MONTHLY}`,
`BILLING_{FREE,PRO}_RESEARCH_{DAILY,MONTHLY}`,
`BILLING_{FREE,PRO}_TRANSCRIPTION_MONTHLY_MS` and
`BILLING_{FREE,PRO}_SYNTHESIS_MONTHLY_CHARACTERS`. Zero stops that metric. Defaults
and Compose forwarding are in `.env.example` and `docker-compose.yml`.

## API

- `GET /v1/billing`: subscription status, Stripe prices, plan usage and reset dates.
- `POST /v1/billing/checkout`: `{ "interval": "month", "expectedAmount": 500 }`;
  returns a Stripe-hosted URL. Flag-disabled requests are rejected. The legacy
  fixed-price path additionally supports a configured yearly interval.
- `POST /v1/billing/portal`: opens the existing customer's configured portal.
  Ownership, account/session availability and the flag are always checked.
- `POST /v1/webhooks/stripe`: raw signed events; no Clerk session is required.
  Subscribe to `customer.subscription.created/updated/deleted`,
  `checkout.session.completed/async_payment_succeeded/async_payment_failed`, and
  `invoice.paid/payment_failed`. Unrelated or unmapped customers do not grant access.

Authenticated responses are private/no-store. The website proxy allowlists only
these billing operations and checks request origin for writes.

See [rollout](deploy.md#billing-rollout-023) and [verification](development/testing.md).
