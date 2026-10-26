# System administration

**Settings → Admin** has **People & access** and **Usage reports**, available only to a current website session with the
`system_admin` role. Ordinary accounts use the `user` role. All role decisions
come from the database, never browser state, email-domain rules, token metadata
or connected-agent permissions. API keys and OAuth agents cannot use admin routes,
even when their account belongs to a system admin.

## People and access

Browse all Grove accounts in pages of thirty, or search an **exact email address**
or Clerk user ID. Identity-provider matches without an existing Grove account are
not created or granted anything. Names and primary emails are read from Clerk
only after authorization; they are not copied into the administration tables.

Manage opens one account inspector with **Usage**, **Account**, and **Access**
sections. Existing system roles remain `user` and `system_admin`; there is no
custom permission builder or support-ticket system.

The directory separates access grants, system roles and account availability.
**Standard** means no complimentary override, not necessarily a Free subscription.
**Unavailable** does not identify the cause: open Account to check administrative
suspension, and check the sign-in provider for independent restrictions. A search
miss offers a return to all people; background refresh and pagination failures keep
previously loaded rows available with a retry action.

### Reviewing and saving changes

The inspector keeps identity and section navigation in place while its content
scrolls. Account and Access share one coordinated draft and saved version. Save
and Discard remain reachable in the editing footer, including on narrow/short
screens. Leaving an edited section, closing, Escape or backdrop dismissal asks you
to save, discard or keep editing. A reason of at least three characters is required
for a save; normal browser reload/close receives a dirty-form warning where supported.
Drafts are not persisted to local browser storage.

Confirmed saves keep the selected account and section open, update their saved
version, and refresh the directory/history. An explicit Save from a leaving prompt
continues to the requested destination only after confirmation. A transient failure
to recheck the operator's role does not discard an open draft; server authorization
is still checked on every protected read/write.
The workspace's periodic account-detail refresh also keeps the editor mounted;
background results do not replace a draft or its original conflict version.
Clean forms can adopt fresh saved values. After a save or review removes/disables
its action button, keyboard focus returns to the current section when needed.

An uncertain network outcome freezes the exact submitted request. **Retry same
change** checks that operation safely without a second audit; it cannot be replaced
by a new edit or ordinary Discard. Request-limit failures explain that you must
wait, then retry the same operation rather than claiming the account changed.
Version conflicts offer **Review latest account**, comparing saved values with
the attempted draft. **Use saved values**
discards the draft; **Keep my changes for review** carries only explicitly edited
fields onto the fresh snapshot. Neither review action writes anything; saving
again is deliberate. Losing administrator access conceals the account view.

Suspension/restoration lives under **Account availability**, separate from automatic
capture/recall. Changes to availability or system role require an additional review
with the target, changed values, audit reason and consequences before confirmation.

### Usage and support

For global totals, feature/day breakdowns, paginated per-user usage and CSV feature
exports, open **Usage reports**. It keeps cached/fresh action accounting separate
from provider requests and audio duration; current library counts are snapshots.
See [cross-account reports](admin-usage-reports.md) for units, UTC ranges, metering
coverage, identity fallbacks, retained-history limits and the migration boundary.

Usage shows current note/notebook/active-connection counts and **today / this month**
generation requests, web-research calls, transcription minutes and read-aloud
minutes. Calendar periods are UTC; reset times are displayed in the browser's
local time. These are operational usage counters, not invoices: reservations and
failed attempts may be included, while cached audio reuse is not charged again.
Usage remains available to administrators when billing purchases are hidden.
Only aggregates are exposed—never note titles, text, notebook names, conversation
prompts, connection credentials or payment details.

Support shortcuts open an email draft in the operator's mail app or copy the
account ID / usage summary. Nothing sends automatically. An administrator-only
support note (500 characters maximum) keeps a short follow-up reminder; do not
store credentials or private note content in it. Account history displays matching
entries from the latest fifty administration changes, not an exhaustive history.
Clipboard denial exposes selectable text in the inspector. Recent changes identify
the changed access, role, preference or suspension rather than showing only the final
grant. Support-note events say that the note changed without copying its text into
the history feed.

Account edits can change automatic capture/recall, the support note, and reversible
**suspension**. Suspension blocks Grove access, agent requests and new ordinary
worker dispatch without deleting notes or canceling subscriptions. In-flight work
is fenced by the existing account checks; already-sent provider work cannot be
unsent. Provider updates cannot clear an administrative suspension; restoring it
does not clear an independent provider ban, lock or deletion. The current operator
cannot suspend themselves, and the last active administrator remains protected.
Sign-in profile, email and password edits stay with the identity provider.

Support edits require a reason, account version and expected setting snapshot.
They do not silently overwrite a user's newer preference change. Retry-safe
operations record one before/after audit, and operation IDs cannot be reused across
support and access edits. Restores reconcile current suspension, settings, support
notes and role/grant authority before returning online.

### Access grants

The **Access** section keeps separate access and system-role controls:

| Access    | Effect                                                          |
| --------- | --------------------------------------------------------------- |
| Standard  | Uses the current Stripe subscription or Free plan; no override. |
| Pro       | Complimentary existing Pro allowances; no payment is required.  |
| Unlimited | Removes plan storage/action and provider-usage quotas.          |

Unlimited preserves API rate limits, independent non-generation inference budgets,
speech attempt limits, shared provider concurrency and installation-wide research-spend limits. It does
not promise unbounded physical storage or provider capacity. Under the integrated
action policy, plan note/notebook/action ceilings are removed too, while the
two-generation-call concurrency safeguard remains. API and
worker resolve the same current grant before quota admission.

Explicit Pro/unlimited grants apply when billing is configured, even while
`billing-enabled` hides purchases and billing information. Removing a grant
restores normal flag/subscription behavior. The billing flag does not revoke
complimentary access. An unconfigured self-hosted installation retains its existing
quota behavior. This feature does not change the launch Free/Pro allowance values.

The integrated tier policy uses plan quotas instead of the old generation/research
account ceilings. Unlimited removes those plan quotas too; it does not reinstate a
legacy cap below Pro. Speech still obeys per-item duration/size and daily attempt
bounds, while narration is metered and settled using the same exact-duration path.

The system role is independent of access. A system admin can manage access and
other admins, but gets **no cross-account access to notes, notebooks, attachments,
conversations or exports**. The last active admin cannot be demoted through the
admin interface. Identity-provider bans/deletion still take precedence over roles.
Cloud model/provider configuration and self-hosted `MODEL_ADMIN_SUBJECTS` remain
separate, unchanged controls.

Changes require a reason and saved account version. Conflicting edits require a
fresh review. A retained operation ID makes retries return the original result
without applying or auditing the change twice; changing its payload is rejected.
After an uncertain network outcome the dialog retains the exact request for retry.
It never silently replaces a newer role or grant.

Grants **do not create, reprice or cancel Stripe subscriptions**. An existing paid
subscription keeps renewing until separately canceled through billing management.
The UI explicitly warns about this. Recent changes retain actor, target, before/
after state, reason and time; no private note content or payment details is stored.
The page shows the latest fifty changes, while the full audit remains retained.

## API and database boundary

- `GET /v1/admin`: current website account's system role.
- `POST /v1/admin/accounts/search`: `{ "query": "person@example.com" }`, empty
  for recent accounts, or exact Clerk user ID. No email addresses in URL queries.
- `POST /v1/admin/accounts/browse`: `{ "after"?: "account UUID" }`, returning
  `{ accounts, total, nextCursor }` in stable newest-first order, at most thirty
  accounts per page. Identity enrichment rechecks authorization after remote reads.
- `POST /v1/admin/accounts/details`: `{ "accountId": "UUID" }`, returning
  `{ account, settings, counts, usage }`; usage includes UTC reset times and
  per-metric `{ today, month }`. Speech units in the API remain milliseconds.
- `PATCH /v1/admin/accounts/support`: `accountId`, `operationId`, `expectedVersion`,
  `expectedSettings`, `settings`, `reason`. Both setting objects contain exactly
  `captureEnabled`, `recallEnabled`, `suspended` and `supportNote`.
- `PATCH /v1/admin/accounts`: `accountId`, `operationId`, `expectedVersion`,
  `role` (`user`/`system_admin`), `access` (`default`/`pro`/`unlimited`) and `reason`.
- `GET /v1/admin/audit`: latest fifty changes.
- `POST /v1/admin/usage`: bounded UTC range and user cursor for all-account reports;
  no private content or general-purpose cross-tenant reader is exposed.

Responses are private/no-store. The website proxy admits only these exact methods
and routes, authenticates its session and checks the origin for writes. Every API
operation checks the current active account, bound subject, session revocation and
system role. Identity lookups recheck authorization after the remote request.

Migration **025**, after speech-cache **024**, adds isolated administration state
and an owner-held audit table. Runtime and worker can read only their own grant;
neither can directly write roles or read/mutate the audit. Narrow security-definer
functions expose account metadata and serialized, audited mutations to the API
role only. They use explicit schemas, revoke inherited/public privileges and
recheck the current admin role after the serialization lock. No private-content
RLS policy is widened. A non-superuser migration owner is supported.

Forward migration **027**, after speech-duration **026**, adds the support note,
administrative suspension and narrow account-reporting/edit functions. Reporting
temporarily scopes only fixed aggregate queries to the selected account, restoring
the actor's tenant context on success or error; runtime/worker never receive a
general-purpose cross-account query API or new private-content privileges.
API keys, OAuth agents, ordinary users and workers cannot call support functions.
Readiness requires the new account column, so rollout must apply 027 before the
new API/worker/site are started. Existing roles, grants, counters and private
content are retained. See [support rollout](deploy.md#admin-support-rollout-027).

## First administrator and recovery

No accounts become admins during migration. After the owner has verified the exact
production Clerk identity and existing active Grove account, use a private,
parameterized migration-owner connection to call:

```sql
SELECT grove_bootstrap_system_admin($1, $2);
-- $1: verified existing Clerk user ID; $2: explicit owner-bootstrap reason.
```

This function is not executable by runtime/worker or PUBLIC. It creates no account,
does not grant complimentary access, records a bootstrap audit and is idempotent
for the same current admin. It refuses a different first admin once one exists;
further roles are managed by signed-in admins. Never put owner credentials or a
hardcoded administrator email/subject into source or public configuration.

Restores must remain offline until `reconcile-restore.ts` runs against complete
current authority with matching migrations. It replaces restored role/grant state
with current metadata for retained accounts and replays available audit receipts,
preventing resurrected privileges. If every admin becomes unavailable, an explicit
owner-reviewed recovery is required; do not weaken account or session checks.

See [rollout](deploy.md#system-administration-rollout-025),
[verification](development/testing.md), the [original role captures](design/screenshots/system-admin/README.md)
and [admin polish captures](design/screenshots/admin-polish/README.md). The UI polish
adds no migration or new API permissions; support features retain the 027 rollout
prerequisite above.
