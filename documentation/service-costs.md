# External-service cost reporting — proposal

**Status: proposed, not implemented.** Grove's current Admin area contains People
& access and Usage reports. It does not provide provider balances, invoices or
spend forecasts. This proposal defines a separate **Settings → Admin → Service
costs** section; it does not change customer billing or authorize provider access.

## Coverage

Account for every paid dependency used to operate Grove or implement/enhance its
functionality, not just AI providers. Reconcile configured services against actual
billing ownership before claiming completeness. Configuration does not prove paid
usage, and a free/local component does not imply a separate subscription.

| Category                    | Services to investigate when configured                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| AI, search and speech       | DeepInfra, MiniMax, Exa, Tavily, OpenAI and configured compatible providers                       |
| Hosting and data            | DigitalOcean compute/database/Spaces, Vercel and alternate storage/database providers             |
| Identity and email          | Clerk, Resend                                                                                     |
| Monitoring                  | Sentry, PostHog, paid Vercel analytics                                                            |
| Operations                  | CloudAMQP/configured broker, Doppler, paid Cloudflare services                                    |
| Other attributable expenses | Stripe processing fees, domains, paid CI/registry resources and separately licensed functionality |

The inventory must distinguish active, disabled, free/local, needs-access and
unsupported integrations. Allow structured manual records for paid dependencies
without a suitable API. Do not silently omit unavailable services or treat them
as zero cost. Unrelated projects, advertising and employee tools are not added
automatically. Hosted engines such as LanguageTool consume hosting already counted
unless a separate charge actually exists.

Identify connections by billing account/resource scope, not individual API keys;
credential rotation must not duplicate costs. Disabling functionality does not
prove a subscription was canceled. Retain renewing charges until authoritative
billing state or a reviewed manual record says otherwise. Future paid integrations
must declare cost-reporting capability or an explicit gap in the service registry.

## Proposed administrator experience

- Overview: known month-to-date costs by currency, projected month-end costs and
  financial-data coverage. Clearly identify missing or estimated contributions.
- One grouped service table: remaining funds/credits or allowance, period usage,
  spend, forecast and sync status. Use distinct units for tokens, requests,
  audio duration, storage and other provider meters.
- Service details: current billing period, historical costs, fixed fees/renewals,
  expiring credits, provenance, scope and provider billing-dashboard link.
- Focused configuration: manual recurring costs, shared-cost allocation, budget
  warnings and sync opt-out. Versioned/audited local changes do not alter provider
  plans, budgets, top-ups or permissions.
- Honest states: last successful observation, provider reporting lag, queued or
  processing refresh, backoff/recovery, failure, partial coverage and missing access.
  Keep last-good data visibly stale during failures; conceal it on access denial.

Keep Settings last in the main navigation. Service costs is a lazy-loaded Admin
section, not another global destination. Preserve filters, row identity, focus,
scroll and unsaved edits during refresh. No page-wide loading reset or repeated
toasts. Use readable desktop/tablet/phone layouts with keyboard-accessible detail
and configuration controls; important financial uncertainty stays visible.

## Financial interpretation

Every amount needs a currency, period/timezone, account/resource scope, observation
time, source and completeness. Missing values are unknown, not zero. Distinguish:

1. **Provider-reported facts:** observed balances, credits, usage and charges, which
   may lag or be revised before final invoicing.
2. **Manual figures:** explicitly entered subscription costs and allocation rules.
3. **Grove estimates:** calculations with known provider/model/unit pricing and
   disclosed coverage, not reconstructed invoices.
4. **Forecasts:** conditional projections with a stated method and enough history.

The existing [usage report](admin-usage-reports.md) includes reservations and some
failed/uncertain attempts and has metering gaps. It must remain separate from exact
provider charges. Never multiply all historical counters by today's price and
present the result as a bill.

Whole-provider-account spend and Grove-attributed spend are different views.
Shared accounts require verified resource/project attribution or a labelled,
effective-dated allocation chosen by the owner. Unknown allocation is not exact
Grove cost. Do not sum a provider total with its product breakdown, an actual charge
with an overlapping estimate, or a shared allowance pool multiple times.

Top-ups fund a balance; they are not additional usage expenses. Keep grants,
credit expiry, refunds, taxes and subscriptions distinct. Separate annual renewal
cash payments from monthly amortized views. Stripe processing fees are expenses;
customer payments, balances and payouts are not external-service expenses.

Use exact decimal monetary arithmetic and explicit rounding. Initial totals stay
grouped by native currency; no guessed exchange rates or misleading mixed-currency
grand total. Provider billing periods and calendar months must be labelled and
must not be silently treated as interchangeable.

## Forecast proposal

Start with deterministic run-rate estimates, not an AI predictor. With at least
seven complete covered days, forecast remaining variable costs from recent mean
daily spend (up to 28 complete days), then add fixed charges due in the remaining
period. Do not count partial days as zeros or charge a subscription twice. A
monthly aggregate supports only a separately qualified elapsed-period estimate,
not an invented daily series.

Show recent-versus-longer-window scenarios when both are available; this is not a
statistical confidence interval. State traffic/pricing assumptions and tier/cap
limitations. Insufficient history produces no forecast rather than false precision.

Estimate prepaid runway only from applicable remaining funds and covered recent
variable burn. Qualify credit restrictions/expiry, stale balances, shared pools and
auto-recharge. Zero observed spend does not guarantee unlimited runway. Initial
warnings stay inside the dashboard: low balance/runway, expiring credits, budget
projection and stale or failed synchronization. No automatic top-up, shutdown,
plan change, email or other provider mutation is proposed.

## Integration feasibility

Public evidence checked on 26 November 2026; no live account was qualified:

- **DeepInfra:** documented [monthly usage/cost](https://docs.deepinfra.com/api-reference/billing/usage.md)
  and [billing checklist](https://docs.deepinfra.com/api-reference/billing/get-checklist.md)
  with `billing:read`. Verify balance signs/units and recent uninvoiced usage before
  claiming available funds.
- **Exa:** [remaining credits](https://exa.ai/docs/reference/team-management/get-team-credits.md)
  and [per-key period costs](https://exa.ai/docs/team-management-spec.yaml) through
  the gated Team Management API/service key. Balance can lag by five minutes;
  selected-key costs are not necessarily complete team costs. Strip secret fields
  that provider key-list/usage responses may include.
- **MiniMax:** its official CLI [selects account balance or plan quota by credential](https://github.com/MiniMax-AI/cli/blob/main/src/client/endpoints.ts).
  Qualify account type, region and currency; monthly cost-history access is still
  unverified. Plan quota must not be displayed as USD credit.
- **Other dependencies:** confirm supported billing APIs, permissions, attribution,
  reporting lag and history individually. Use labelled manual costs or an explicit
  unavailable state where necessary, never browser scraping/session cookies.

Use existing authorized configuration when sufficient. Inference, sending,
ingestion and deployment keys do not automatically confer billing access. Request
only necessary additional permission with explicit owner approval; favor narrowly
scoped read-only credentials. No arbitrary remote-URL connector is proposed.

## Security and durable work

Reuse the [system-administrator boundary](system-administration.md): active website
session, database-controlled role and per-request checks. Ordinary users, API keys
and OAuth agents cannot access financial records. No private notes, prompts,
identities, payment-method details or raw invoice documents are needed.

Billing records are installation-wide, not an arbitrary administrator's tenant.
The existing [task machinery](jobs.md) is mostly account-scoped; implementation
must extend it with narrowly permitted installation-level cost tasks and fenced
functions, without widening private-content RLS or giving workers general admin
access. Worker access is limited to the claimed operation's normalized fields.

The API commits a refresh command and durable task atomically, then returns
acceptance with an operation ID. Workers perform provider reads outside database
transactions, using existing queue lanes, confirmed publication, leases, bounded
retry, concurrency, polling fallback and shutdown. Only opaque work IDs enter the
broker. Scheduling and missed-work recovery are durable; browser status reads do
not execute jobs. A queued refresh is not successful synchronization.

Workers recheck current configuration/enablement, scope, disconnect tombstones,
restore generation and lease before requests and publication. Manual work also
checks the initiating operator's current authority; scheduled work uses installation
authority. Configuration changes and stale workers cannot overwrite newer data.
Keep credentials worker/server-only in existing secret custody; do not store raw
responses or leak financial data to client analytics/logs. Publish complete metrics
atomically or explicitly report partial coverage. Provider corrections must upsert
the same observation scope rather than double count it.

Suggested starting limits are a six-hour refresh, bounded 90-day initial history,
one sync per connection, at most two service-cost remote calls installation-wide,
and a five-minute manual refresh cooldown. Proposed retention is 24 months of
normalized aggregates/configuration audit and 30 days of sanitized sync diagnostics.
These limits and retention require implementation-time confirmation, not a claim
of current behavior or approved data retention.

## Delivery and verification

Proposed implementation sequence:

1. Reconcile the full service/capability inventory; build tested financial contracts,
   forward-only persistence and narrow installation-task authorization.
2. Implement durable sync, DeepInfra/Exa/MiniMax adapters where supported, and then
   supported adapters/manual coverage for every remaining configured dependency.
3. Implement exact totals, attribution, manual recurring charges, forecasts and
   in-dashboard warnings with explicit coverage.
4. Add the Admin section, update owning documentation and capture relevant synthetic
   screenshots after actual UI verification.

Required tests include non-owner/forced-RLS upgrade and restore, unauthorized and
revoked-session denial, provider parser/permission/rate-limit/pagination failures,
two-worker replay/crash/stale-lease recovery, broker outage and graceful drain,
no transaction held during provider I/O, duplicate/overlapping financial facts,
currency and period boundaries, forecast history gaps, dirty/conflicting/uncertain
edits and responsive/accessibility/refresh stability. Use disposable real services
and synthetic provider fixtures; never reset retained databases to pass tests.

Run [required project checks](development/testing.md), documentation validation,
relevant admin/billing/queue/worker regressions and exact-head hosted CI. Before
website coding, read the installed Next.js guides and applicable design/React
instructions. Screenshot evidence belongs in a scoped documentation gallery;
representative PR previews are limited to four per row. This prose-only proposal
requires no screenshot.

Production migrations, credentials and rollout are separate owner operations under
the existing [deployment process](deploy.md). Deploy compatible consumers before
enabling producers, preserve additive schema/history on rollback, and fence restored
or disabled work. Default integrations stay disabled until authorized configuration
is ready; then initial discovery starts without a setup wizard. Compare approved,
bounded read-only live syncs with actual provider dashboards before claiming
provider acceptance. Source tests and a merged plan do not prove live billing
coverage, onboarding timing or feature availability.
