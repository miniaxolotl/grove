# Usage reports across accounts

Open **Settings → Admin → Usage reports** with a current system-administrator
website session. Reports cover all Grove accounts, including retained usage from
unavailable accounts. Ordinary users, API keys, OAuth agents and workers cannot
access this reporting API. No private notes, notebook names, prompts, research URLs,
credentials or payment details are exposed.

## Reading the report

Choose inclusive **UTC** dates, up to 366 days, ending today or earlier. The default
is this calendar month through today; **Last 30 days** is a rolling inclusive range.
Apply a range or explicitly refresh to read current counters. Reporting stays idle
until you open the view; it does not add a global reporting poll.

- **Accounts** counts all retained accounts. **With recorded activity** counts
  distinct accounts with recorded requests or live action reservations in the range.
- **Current footprint** counts notes, notebooks and active connections now, not at
  the historical range's end. Soft-deleted/expired notes and revoked/expired
  connections are excluded; retained active/archived library rows use the existing
  administration definitions.
- **Recorded user actions** keeps recall/search, Ask, organization and assistance
  separate. Used actions, fresh/cached completed requests and live pending actions
  are independent columns. A fully cached completed request uses 0.2 actions;
  fresh/partly cached work uses 1. Released/expired reservations do not count as
  completed usage. No pooled pricing or changed tier allowance is introduced.
- **Provider & audio usage** reports embedding, classification and generation
  requests/tokens, research calls, transcription and read-aloud duration, and their
  recorded request counts. Failed/uncertain attempts and reservations can be
  included. Audio follows retained duration accounting, including conservative
  legacy/reservation bounds; these are not playback analytics or provider invoices.
- **Activity & people** selects one feature for daily figures and per-account
  amounts. Thirty accounts load per page; **Load more people** continues the same
  range. Global totals cover every account, not only loaded people. **Inspect**
  opens the existing account inspector without adding content access.

Tables scroll within the report on narrow screens. The daily figure disclosure
provides the chart's numeric values. Prior figures stay visible during refresh
failures; an authorization denial hides the report. An identity-directory outage
falls back to account identifiers, with administrator authority rechecked before
returning data. Names/emails are fetched only for the current page, never stored
in a new report table. Accounts no longer available to inspect retain usage but
do not offer an unsupported inspection action.

## Export and interpretation

**Export feature totals** downloads a CSV of the currently displayed global range.
It contains ten feature totals, not a dump of loaded people or private identities.
Audio stays in explicit milliseconds in CSV/API; the UI displays minutes. Blank
CSV fields mean not applicable (for example, cached action counts for provider
attempts), not a fabricated zero. Dates are included in the filename.

Only **retained recorded usage** is available. Action metering is not active for
every installation/plan: unmetered/manual work is not reconstructed as zero-cost
provider work. Action rows are attributed to their operation creation date,
clamped to the recorded quota month when a retry moved periods. They are not a
history of exact completion timestamps. Model/research/speech counters use their
recorded UTC days. Reopening/replaying a completed operation does not create a
new action. Totals can change while new activity arrives; paginated reads are not
an immutable accounting snapshot.

## API and database boundary

`POST /v1/admin/usage` accepts `{from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", after?: UUID}`.
Supply both dates or neither. The response includes `from`, `to`, `generatedAt`,
`totals`, sparse feature/day rows, and `users: {accounts, total, nextCursor}`.
Each feature exposes `used`, `reserved`, `requests`, `fresh`, `cached`, `inputTokens`
and `outputTokens`; only applicable fields should be presented for that feature.
Responses are private/no-store. The website proxy permits this exact POST path
and retains session/origin checks. Reporting works while purchases are hidden.

Forward migration **034**, after caching **033**, adds two fixed aggregate
functions. It creates no report-data table, alters no tenant policy and rewrites
no usage/content. The owner-only helper scopes fixed aggregate queries to known
accounts and restores the operator's tenant context on success or error; only
the guarded report entry point is executable by the runtime role. Workers cannot
call it. A non-superuser, non-bypass migration owner is supported. The read path
checks current administrator/session authority and rechecks after identity reads.

The on-demand aggregation visits accounts under existing RLS rather than adding
a cross-tenant bypass policy. Results have bounded date/feature/page dimensions;
execution still grows with retained account/activity volume and uses existing
database/request deadlines. The synthetic 43-account journey is not production
scale/latency qualification. Large installations may need a separately designed
aggregate pipeline; this change does not silently enable one.

## Rollout and verification

Apply `20261025_034_admin_usage_reports` using the [owner procedure](operations/schema.md)
before matching API/worker/site. Readiness checks the fixed report entry point;
keep additive functions on rollback. No content, usage, role, subscription or RLS
policy is rewritten and no billing activation is required.

`admin-usage.test.ts` and `admin-usage-migration.test.ts` cover independent units,
fifth-action discounts, released reservations, inclusive UTC dates, global versus
page totals, thirty-user paging, identity outages/revocation, forced RLS,
actor-context restoration and non-superuser ownership. The populated 034 upgrade
retains existing rows/policies before upgrading fully for current runtime checks.

Use real Admin components, a disposable non-owner API/database and synthetic
identities in Chromium/WebKit at 1440/390/320px. Check intent-only loading, feature/
date selection, global CSV amounts, pagination, inspection, empty/error recovery,
revocation concealment, accessibility and local table scrolling without page overflow.
See [fixtures](development/testing.md) and [captures](design/screenshots/admin-usage/README.md).
