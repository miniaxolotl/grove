# Billing and usage

Grove Cloud starts on **Free**. **Pro** increases AI allowances through a Stripe
subscription; it does not sell a prepaid credit balance. Pro starts at an
**introductory $5 USD/month**. A future price change is a separate owner decision.
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

## Your plan at a glance

The workspace shows a small Free/Pro/Unlimited badge in the existing controls,
without adding a navigation row. Hover or keyboard-focus it to see **used / limit**
counts for notes, notebooks, recall/search, Ask replies, organization and assistance.
Pending actions and monthly reset dates are explicit; additional AI/research/audio
budgets sit behind a disclosure. Click or tap to keep the panel open. Escape,
outside press or leaving the panel dismisses it. **Account details** opens
**Settings → Account → Your plan**.

The breakdown uses compact text rows rather than repeating a meter for every
allowance. The linked plan heading/source opens Account details, without a separate
footer action. Used and pending amounts remain distinct; exhausted limits stay
explicit rather than relying on color.

The panel distinguishes **Paid subscription**, **Trial subscription**, and
**Complimentary** access provided by the Grove team at no charge. Complimentary
access remains visible when purchases are hidden; it never cancels a separate
subscription. Billing keeps subscription status, renewal/end dates and **Manage
subscription** independent of the effective access label.

The optional `plan` object on owner-session `GET /v1/me` and `GET /v1/billing`
contains `tier` (`free`, `pro`, `unlimited`) and `source` (`free`, `paid`, `trial`,
`complimentary`). Both use the existing entitlement resolver and grant precedence;
expired, unsupported and non-entitled subscriptions never create a Pro badge.
The lightweight workspace read uses local records, not a Stripe request. Opening
the panel fetches the existing owner-only `GET /v1/account/usage`, whose additive
`planUsage` object contains `plan`, `resources`, provider `usage`, and explicit
`units`. It reuses the same quota accounting and configured limits as Billing,
including complimentary/Unlimited grants with purchases hidden. No detailed usage
read occurs before intent. Billing still reconciles Stripe and then refreshes the
workspace snapshot. Account/session cache isolation and existing visible refresh
rules apply. Scoped agents receive neither plan metadata nor account usage. A null
plan (unconfigured/disabled policy without a grant) or older API response never
invents a Free/paid status or usage limit. Failures offer one concise retry. No
billing flag or schema change is required.

## Library and user actions

| Resource                                  |         Free |           Pro |
| ----------------------------------------- | -----------: | ------------: |
| Stored notes                              |       10,000 |        50,000 |
| Notebooks/projects                        |          100 |           500 |
| Agent recalls / semantic library searches | 30,000/month | 150,000/month |
| Ask Grove replies                         |    300/month |   1,500/month |
| Note organization runs                    |  1,000/month |   5,000/month |
| On-demand summaries and assistance        |     50/month |     250/month |

Both tiers retain **180 API operations/minute/account** and allow **two concurrent
generation calls/account**, shared by foreground requests and all worker replicas.
The latter is independent of the existing lane/provider capacity controls. An
unlimited grant removes plan action/storage limits, not the two-call safety ceiling.

These counters describe user actions, not provider requests. A complete conversation
turn counts one reply, including its planner and internal retrieval. Reopening or
retrying its same ready turn does not charge again. Failed/cancelled replies release
the action reservation; their provider-attempt evidence remains retained. Stateless
Ask calls and external recall/search calls are independent operations; transport
retries without a durable result identity may count again. Automatic agent hooks
share the same account-wide recall allowance as explicit calls.

Organization coalesces content changes for five seconds in configured Cloud. A note
ID/content digest shares one action across classification, titles and connection
discovery; unchanged-content retries and already processed content do not charge
again. Re-enabling a preference cannot bypass the allowance for unprocessed content.
Owner-initiated model/profile backfills remain provider-budgeted system maintenance,
not new authored-note actions. Relationship fan-out retains its existing bounded
candidate windows. Automatic briefs/notebook relationships retain their independent
provider-attempt budget; the assistance allowance applies to on-demand work.

An on-demand preview or summary reserves one result, not each worker fragment.
Cached reads, polling, Apply and Undo do not create another action. A completed
preview consumes its action even if the user chooses not to apply it. Cached-only
summary processing releases its reservation. Pending actions occupy capacity for
15 minutes and refresh on worker progress; abandoned reservations expire. Publication
checks the reservation token, and completion stays in its original UTC month even
if inference finishes after reset. Existing provider counts are never converted into
actions or reset during migration.

Meeting preparation follows this assistance allowance: one completed generated
brief, not one charge per source. Empty notebooks invoke no model and release the
reservation. Cancel/failure releases action capacity while retaining provider-attempt
evidence; reading, reviewed Save/Undo and durable replay do not add actions. The
feature does not activate billing or the separately proposed weighted-credit wallet.

Active, archived and expired non-deleted notes count toward storage. Soft-deleted
notes and notebooks do not count, but their authored content/history remains retained.
Imports, agent writes, Apply and nested notebook creation use the same account-locked
capacity checks. A downgrade preserves content and current-period usage: existing
notes remain editable/readable/exportable, while new counted items/actions require
remaining capacity. Library search explicitly falls back to keywords when semantic
allowance is exhausted; agent recall instead returns an allowance error.

Settings → Billing shows used/pending actions, storage, reset dates and warnings at
80%/95%. `GET /v1/billing` adds optional `resources` and `proResources`; older API
responses still render the existing meters. Account-wide totals are owner-session
only. Scoped agents receive only the relevant operation error, never other usage
totals. `usage_limit` includes `resource` and `resetAt`; monthly errors use the actual
reset for `Retry-After`. Storage exhaustion has no timed retry, and `ai_busy` suggests
a one-second retry. Basic reads, edits, keyword search and export remain available.

The new policy uses the existing configured billing/entitlement gate: flag-off and
self-hosted installations keep their prior safeguards. No new billing activation,
subscription, price or provider configuration is implied. See the
[028 rollout](deploy.md#user-action-allowances-rollout-028).

## Provider-attempt and audio safeguards

| Usage                       | Free                    | Pro                      |
| --------------------------- | ----------------------- | ------------------------ |
| AI generation requests      | 1,000/day; 31,000/month | 5,000/day; 155,000/month |
| Web research provider calls | 20/day; 620/month       | 100/day; 3,100/month     |
| Transcription               | 2 hours/month           | 8 hours/month            |
| Read aloud                  | 2 hours/month           | 8 hours/month            |

These are separate configurable safety budgets, not additional user-action credits
or measured cost guarantees. Both action and provider budgets must have room; a
large multi-call action can hit a provider budget first. Generation
includes background titles, organization, relationships, summaries and Ask Grove.
One visible action may reserve several provider requests. Embeddings and basic
classification do not consume the generation allowance. Transcription measures
original duration in milliseconds; read aloud counts the decoded MPEG frame duration
of newly generated audio, not text length or time spent replaying it. Its budget
is independent of transcription. All voices share one synthesis allowance. Monthly
AI/research limits allow 31 daily allowances without claiming reserved provider
capacity. The [cost report](development/tier-costs.md) distinguishes published rates,
calculated usage scenarios and actual invoices; the intro price is not a margin claim.

System admins can grant complimentary Pro or unlimited access independently of a
subscription. Unlimited removes these plan quotas, not installation-wide safety
limits. Explicit grants remain effective while purchases are hidden; the billing
flag does not revoke them. Grants never alter or cancel a subscription. See
[system administration](system-administration.md).

Counters reserve **attempts**, including retries, before dispatch. Uncertain,
failed or cancelled provider calls do not promise refunds. Reusing a valid cached
result does not reserve another attempt. Research has both per-account allowances
and an independent installation-wide estimated monthly provider-spend cap.

TTS reserves a conservative duration before dispatch, bounded by the remaining
allowance and the maximum 3 MiB MP3 response at the supported minimum bitrate
(52 minutes 25.8 seconds). Successful, source/lease-valid publication settles to
decoded frame duration rounded up to the next millisecond. Encoded frame padding
is included; duration tags cannot reduce the frame count. Invalid audio or audio
longer than the reservation cannot publish. Failed, cancelled, stale, crashed or
uncertain attempts retain their reservation; an overrun can incur provider costs
without usable output. Cache hits/replaying audio do not generate or charge again.
An in-flight reservation can temporarily consume the available balance.

Migration 026 adds a duration counter **without changing retained character or
attempt counters**. Historical attempts with unknown duration are conservatively
charged the same maximum per attempt; old character-only writers also accrue this
bound rather than bypassing the new quota. Historical usage can therefore exhaust
the new time budget until the normal calendar reset. This is not a fabricated exact
conversion from characters and does not delete or reset retained usage.

Allowances reset at **UTC midnight** and the **first of each UTC calendar month**,
not the subscription renewal date. They do not roll over. The Billing page shows
monthly usage meters, daily counts and short local reset dates. Usage
already recorded in the current month counts when a rollout or upgrade starts.
Daily protections still apply: 180 API operations/minute/account and 20 speech
attempts/day/type. In flagged Cloud, tier generation/research allowances replace
the old per-account generation/research guard; non-generation AI work retains a
separate 2,000-attempt/day guard for background indexing/classification and model
diagnostics by default. Action-covered query embeddings record a distinct
`retrieval` role, not that smaller background budget: their monthly safety ceiling
is recall plus Ask allowances (30,300 Free / 151,500 Pro), retaining failed/empty
query attempts too. Unlimited access retains the default Pro retrieval safety
ceiling independently of custom plan quotas. This admits every advertised action
without a hidden 2,000-query/day limit; keyword-only search needs no embedding.
When Ask generation is unavailable, its free fallback is keyword-only. Speech uses its monthly tier budget
instead of the legacy daily duration/character guard. Shared provider capacity,
installation-wide research spend, bounded per-item input and response limits remain.
In self-hosted/unconfigured/flag-off mode, the original total AI/day, research/day,
10 transcription minutes/day and 60,000 synthesis units/day protections remain.
The existing recording path still accepts up to 60 seconds per item, and read aloud
up to 3,000 text units per request: these are cumulative monthly allowances, **not
support for uploading/transcribing a complete 90-minute lecture in one request**.

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
  be replaced. A completed checkout can be replaced only when its exact Stripe
  subscription is canonically `canceled` or `incomplete_expired`; a missing or still
  ongoing subscription stays fenced. This permits resubscription after cancellation
  without opening a second subscription while payment is processing.
  Idempotent create responses are historical: the server retrieves current Checkout
  state before returning its URL or trying to expire it during account deletion.
  Billing reads reconcile from Stripe, including after a lost webhook.
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
ordinary subscription-based plan quota enforcement. Explicit admin grants remain
effective as described above. **Off hides Settings navigation, returns 404 for the billing
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
`BILLING_{FREE,PRO}_SYNTHESIS_MONTHLY_MS`. Speech defaults are 7,200,000 ms Free
and 28,800,000 ms Pro **for each metric**. Zero stops that metric. Defaults and
Compose forwarding are in `.env.example` and `docker-compose.yml`. Shared and
parsed defaults come from the same catalog; explicit overrides remain authoritative.
Old `SYNTHESIS_MONTHLY_CHARACTERS` settings are rejected with a configuration error;
remove them and choose duration values explicitly, never rename a numeric value
without changing its unit. API and worker settings must match. A source-default
change does not overwrite deployed environment values or activate billing.

Storage/action settings are `BILLING_{FREE,PRO}_NOTES`,
`BILLING_{FREE,PRO}_NOTEBOOKS` and
`BILLING_{FREE,PRO}_{RECALL,ASK,ORGANIZATION,ASSISTANCE}_MONTHLY`.
Their defaults come from the shared resource catalog; explicit zero/custom overrides
are preserved. API and worker must use matching values. These settings do not change
the generation/research/audio configuration or installation-wide spending controls.

## API

- `GET /v1/billing`: subscription status, Stripe prices, plan usage and reset dates.
  `units` explicitly identifies requests, calls and milliseconds; both speech meters
  display hours. Old responses without duration metadata retain character display
  for read aloud rather than being mislabelled as hours. Deploy API before website.
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

See [tier rollout](deploy.md#tier-allowances-and-speech-duration-rollout-026),
[initial billing setup](deploy.md#billing-rollout-023) and
[verification](development/testing.md).
The [post-merge review](development/billing-review.md) records recovered Checkout
edge cases and distinguishes synthetic lifecycle coverage from paid acceptance.
