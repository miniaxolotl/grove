# Billing post-merge review

Reviewed PR [#112](https://github.com/miniaxolotl/grove/pull/112), merged as
`2024c07` on 24 October 2026. Scope: Checkout, payment-state entitlements, signed
webhooks, cancellation/deletion and usage enforcement. No UI changes or new captures.

## Findings and corrections

| Finding | Reproduction | Correction |
| --- | --- | --- |
| Resubscription remains blocked after the original subscription ends | Complete Checkout, cancel its subscription, then purchase the same or another configured interval. The retained completed Checkout returns `checkout_processing` or `checkout_pending` forever. | Replace it only after canonical Stripe state confirms that exact subscription is `canceled` or `incomplete_expired`. Missing/ongoing subscriptions remain fenced. |
| Lost-response retry can return an expired payment URL | Lose the Checkout POST response, expire its session, then retry. Stripe's idempotent POST replays its original open-session response. | Retrieve current Checkout state before returning a URL; expired sessions receive a fresh persisted operation. |
| Lost-response recovery can block account deletion and renewal cancellation | Lose Checkout's response, complete payment, then delete the account. Replayed `open` state makes the server try to expire an already-completed session; Stripe rejects it before subscription cancellation. | The same fresh retrieval makes deletion skip expiry of completed Checkout and cancel ongoing subscriptions. |

The regressions failed against merged source before the corrections. The provider
fixture uses the real Stripe SDK over loopback HTTP, immutable idempotent response
snapshots and separately mutable current sessions. No SDK method stubs or live
Stripe writes are required.

## Verified contracts

- **Checkout:** owning sessions only, flag-off refusal, configured/stale quote checks,
  serialized duplicate prevention, open-session reuse, resubscription and missing
  subscription fencing. Redirects do not grant entitlement.
- **Payments/webhooks:** recognized active/trialing subscriptions with future periods
  determine Pro; past-due, unpaid, incomplete, expired-incomplete, paused and canceled
  states use Free. Signed events reconcile canonical state rather than their body.
  Failed reconciliation leaves no receipt; retry succeeds and duplicates do no work.
- **Cancellation:** period-end cancellation retains Pro until expiry. Late paid events
  for deleting accounts cancel renewal; the non-owner worker can repeat cancellation
  and expire open Checkout without billing-table write privileges.
- **Usage:** tenant-isolated UTC daily/monthly counters; concurrent API/worker monthly
  generation limits for Free and Pro; recognized/expired/product-based entitlements;
  research and speech quotas stop actual provider dispatch. Note writes, reads and
  exports remain available at the generation cap; embeddings use existing protections.

Run the [billing verification command](testing.md). Verification results are recorded
in [delivery evidence](../delivery.md); migration 023 is unchanged by this follow-up.

## Not production acceptance

This review makes no charge, creates no live subscription, changes no provider/flag
configuration and deploys nothing. The original operator record verifies only live
Checkout creation/expiry without payment. Successful Stripe test-mode payment,
real endpoint delivery/retry, customer-portal cancellation and test-clock renewal/
failed-payment checks remain explicit [rollout gates](../deploy.md#billing-rollout-023).
Live charging and activation require separate operator approval. Deferred custom
email-domain verification/sending is not qualified by local tests.
