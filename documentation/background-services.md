# Organization, queue delivery, and account email

See [durable jobs](jobs.md) for lane capacity, exports/imports, retained deletion,
storage configuration and migration014 rollout.

The worker periodically checks active accounts for missing embeddings, titles,
relationships, and summaries. `ORGANIZATION_INTERVAL_SECONDS` defaults to 900
(allowed: 60–86,400). Each pass claims at most 20 accounts and bounds note/scope
selection. Existing failed jobs stay failed until explicitly retried (relationship
assessments also become eligible after their source snapshot changes); organization
does not rewrite, move, merge, or delete notes.

[Grounded relationships](relationships.md) use separate note-scan, pair-assessment
and notebook-profile jobs. Notebook contents and candidate collections are processed
in resumable bounded batches. Generation uses the existing daily inference budget,
while source discovery stays available independently of summaries. Review metadata
survives retries and reindexing; workers recheck revisions, settings and leases
before publishing explanations.

## CloudAMQP

Set worker-only `AMQP_URL` to a TLS `amqps://` URL. Durable `grove.jobs.v2.<lane>` queues
carries only `{kind, id}` envelopes. Note text, recipients, and credentials never
enter the broker. PostgreSQL remains the transactional outbox and lease authority.

Publisher confirms precede dispatch timestamps. A15-second redispatch window
recovers missed deliveries; claims use 120-second database leases. Duplicate
deliveries cannot execute an already-claimed job. Retry state stays in PostgreSQL
and exhausted jobs remain inspectable. The worker reconnects and uses database
polling while the broker is unavailable. Queue limits are 10,000 messages and a
one-hour message TTL; work remains in the database when messages expire.

## Resend

Worker-only configuration:

```sh
RESEND_API_KEY=re_YOUR_DOMAIN_SCOPED_SENDING_KEY
EMAIL_FROM=notifications@grovenote.app
```

No key means email delivery is disabled. Account creation and connection
approval/revocation enqueue generic transactional notifications atomically with
the account change. Existing accounts are not backfilled with welcome emails.
Clerk continues to handle authentication email.

For ordinary mail the worker resolves only the current verified primary Clerk email, checks the
account is active, and sends HTML plus plain text without note content. A stable
Resend idempotency key protects retries. Transient failures retry up to five times;
delivery stops after23 hours, within Resend's24-hour deduplication window. Recovery
discards restored pending mail. The optional [account deletion receipt](jobs.md#account-deletion-receipts)
uses a short-lived encrypted snapshot from before access ended.

Retries pin a keyed request fingerprint before contacting Resend. If a recipient,
sender, template, site origin or sending key changes after the first attempt,
delivery stops with `email_payload_changed` instead of changing the payload under
the same idempotency key. Inspect that state before considering a manual resend;
the first request may already have been accepted. The snapshot is not a copy of
the message body or recipient address. Optional export notices are enabled with
`EMAIL_EXPORT_READY_ENABLED=true` on the worker only after sender validation;
the default is off. See [exports](jobs.md#exports-and-storage).

Cloud's intended From domain is `grovenote.app`. Verify **its own** Resend DNS
records, sending-key authorization and DMARC alignment before changing the
worker's sender. Disable click and open tracking and preserve existing inbound
mail routing. Keep `SITE_URL` pointed at the website; it is independent of the
mail domain. Drain or reconcile pending sends before changing From or templates.

### Letter design and content

Welcome, connection approval/revocation, export-ready and deletion-request letters
share one renderer, with HTML and plain-text versions. They use the web app’s
system-interface type, green ink/action, neutral paper, restrained spacing and one
primary action. Compact headings replace full subjects inside the message;
subjects themselves remain unchanged. The renderer uses inline styles and
presentation tables, without images, remote fonts, tracking pixels or decorative
card framing. A wrapping fallback address remains available below the action.

Security letters remain generic and link to authorized connection settings.
Export notices retain the absolute UTC deadline and sign-in/task landing page,
not a direct file URL. A deletion receipt confirms the request and ended access,
not completed cleanup; support remains public after access ends. Do not shorten
these distinctions away when editing copy. Clerk authentication mail and
payment-provider mail are separate, provider-managed templates.

To inspect the five [sample letters](design/screenshots/transactional-email/README.md)
without contacting Resend, run `node scripts/testing/email-previews.mjs render /tmp/grove-email-preview`.
For an authorized test inbox, use `node scripts/testing/email-previews.mjs send REVIEW_ADDRESS`
with a domain-scoped `RESEND_API_KEY`. Samples are labelled **Preview** and contain
synthetic data. Provider acceptance is not proof of inbox delivery.

Run `pnpm exec tsx --test tests/src/email-template.test.ts` for layout/content,
HTML/plain-text destination/deadline, preview-label, URL-origin and escaping
regressions. Review normal and preview letters at narrow and desktop widths,
with images unavailable, long fallback links and keyboard access. Browser previews
do not establish Gmail, Outlook, Apple Mail, forced-dark-mode or inbox delivery
acceptance. Preserve retry fingerprint fencing and the pending-send reconciliation
requirement above when rolling out a renderer change.

## Rollout and checks

Use the [owner migration procedure](operations/schema.md) to back up and drain
the current API/worker before applying pending forward migrations. This email
release requires `20261119_046_export_ready_email` and
`20261119_047_deletion_receipt`. Do not repeat already-applied historical migrations.
Deploy compatible readers/workers before enabling new producers and then deploy
the website. Both new email types default off; enable separately after validating
the sender and, for deletion receipts, encryption key and retention controls.

Inspect `broker_connected`, `broker_retry`, `organization_scheduled`, and
`worker_retry` log codes; check database `jobs` and `transactional_emails` status,
and confirm a delivery in Resend. Logs must omit broker URLs, keys, and recipient
addresses. Restore procedures are in [deploy.md](deploy.md).
