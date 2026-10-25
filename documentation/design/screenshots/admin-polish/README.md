# Admin interface polish

Synthetic identities and notes only. Captures use the actual AdminPanel and
production-built CSS, served by the isolated dashboard fixture with a disposable
real API/PostgreSQL and non-owner runtime role. No production accounts, payments,
provider calls or private-note content appear in these captures.

## Layout

- `people-desktop.png`, `people-phone.png`: distinct person, grant, role and
  availability, exact-match search and loaded-account counts.
- `usage-desktop.png`, `usage-phone.png`: stable identity/navigation, semantic usage
  table, explicit units and calendar-period guidance.
- `account-desktop.png`, `account-phone.png`: ordinary preferences and staff note,
  separate account availability and attached Save/Discard actions.
- `access-desktop.png`: complimentary grants independent of system role and billing.
- `conflict-desktop.png`: explicit saved/attempted comparison before a new save.
- `suspension-review-desktop.png`: reviewed suspension, target, reason and consequences.
- `account-short-phone.png`: reachable actions in a 390×460px window.

Desktop is 1440×1050px; phone is 390×844px. The 320px layout is also checked without
adding a duplicate capture for every state. Space Grotesk and the existing workspace
paper/forest/sage tokens are retained; the inspector is 600px wide where space allows.

## Verification context

Application source: `8e083b1` (admin components/styles). The reviewed production
CSS build is `_ZlW94i0NFZnYpdDIJHAc`, generated on 25 October 2026 with Node
24.21.0 and pnpm 10.33.0. The source checkpoint was made after that build; no
application input changed between the final build/journeys and the checkpoint.

Actual API/database journeys pass in Chromium and mobile/touch-enabled WebKit
at 1440/390/320px, with WCAG A/AA, no horizontal overflow and no page errors.
They cover guarded exits, retained saves across sections, reviewed role/suspension
changes, clipboard denial, version conflicts and identical uncertain retries
with exactly one audit. Separate held-save/minute-refresh checks verify draft
retention, confirmed-save/detail-read failure and keyboard scope. Long identities,
missing names/emails, long drafts and large usage counters also fit at 320px.
Forced-color/reduced-motion and enlarged-text overflow checks pass; the short
phone window is 390×460px. WebKit uses the pinned Playwright 1.64.1 Noble container
because the host lacks its required libraries.
Clean account forms adopt fresh saved values; drafts and uncertain operations
retain their original snapshots. Focus recovery is checked after saves and reviews.
The request-limit path has separate wait/retry wording and retains the entire
original operation. Final engine runs use separate newly created disposable
preview databases/accounts so repeated verification does not accidentally exhaust
one synthetic operator's real minute allowance; no rate limit was raised.

See [delivery](../../../delivery.md), [behavior and safety contract](../../../system-administration.md)
and [verification guidance](../../../development/testing.md#admin-interface-polish)
for final-source results. Each screenshot is a UI state, not evidence of a deployed
production feature. Local scripts and disposable database receipts are retained in
the external task plan; the UI polish introduces no new migration or API permission.

Browser emulation does not qualify physical iOS/Android keyboards, OS clipboard
prompts or the operator's mail application. Email opens a draft and never sends it.
