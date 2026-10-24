# System administration

**Settings → Admin** is available only to a current website session with the
`system_admin` role. Ordinary accounts use the `user` role. All role decisions
come from the database, never browser state, email-domain rules, token metadata
or connected-agent permissions. API keys and OAuth agents cannot use admin routes,
even when their account belongs to a system admin.

## People and access

Search an **exact email address** or Clerk user ID, or use the thirty most recent
Grove accounts. Identity-provider matches without an existing Grove account are
not created or granted anything. Names and primary emails are read from Clerk
only after authorization; they are not copied into the administration tables.

Manage opens separate **Access** and **System role** controls:

| Access    | Effect                                                          |
| --------- | --------------------------------------------------------------- |
| Standard  | Uses the current Stripe subscription or Free plan; no override. |
| Pro       | Complimentary existing Pro allowances; no payment is required.  |
| Unlimited | Removes per-plan generation, research and speech quotas.        |

Unlimited preserves API rate limits, total daily inference/speech protections,
shared provider concurrency and installation-wide research-spend limits. It does
not promise unbounded provider capacity, storage or note-count limits. API and
worker resolve the same current grant before quota admission.

Explicit Pro/unlimited grants apply when billing is configured, even while
`billing-enabled` hides purchases and billing information. Removing a grant
restores normal flag/subscription behavior. The billing flag does not revoke
complimentary access. An unconfigured self-hosted installation retains its existing
quota behavior. This feature does not change the launch Free/Pro allowance values.

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
- `PATCH /v1/admin/accounts`: `accountId`, `operationId`, `expectedVersion`,
  `role` (`user`/`system_admin`), `access` (`default`/`pro`/`unlimited`) and `reason`.
- `GET /v1/admin/audit`: latest fifty changes.

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
[verification](development/testing.md) and [reviewed captures](design/screenshots/system-admin/README.md).
