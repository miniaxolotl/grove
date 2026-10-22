# Organization, queue delivery, and account email

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

Set worker-only `AMQP_URL` to a TLS `amqps://` URL. The durable `grove.jobs.v1` queue
carries only `{kind, id}` envelopes. Note text, recipients, and credentials never
enter the broker. PostgreSQL remains the transactional outbox and lease authority.

Publisher confirms precede dispatch timestamps. A 60-second redispatch window
recovers missed deliveries; claims use 120-second database leases. Duplicate
deliveries cannot execute an already-claimed job. Retry state stays in PostgreSQL
and exhausted jobs remain inspectable. The worker reconnects and uses database
polling while the broker is unavailable. Queue limits are 10,000 messages and a
one-hour message TTL; work remains in the database when messages expire.

## Resend

Worker-only configuration:

```sh
RESEND_API_KEY=re_YOUR_DOMAIN_SCOPED_SENDING_KEY
EMAIL_FROM=notifications@mail.usegrove.cloud
```

No key means email delivery is disabled. Account creation and connection
approval/revocation enqueue generic transactional notifications atomically with
the account change. Existing accounts are not backfilled with welcome emails.
Clerk continues to handle authentication email.

The worker resolves only the current verified primary Clerk email, checks the
account is active, and sends HTML plus plain text without note content. A stable
Resend idempotency key protects retries. Transient failures retry up to five times;
delivery stops after 23 hours, within Resend's 24-hour deduplication window. Completed
and failed rows are removed after 30 days. Recovery discards restored pending mail.

Cloud's verified sending domain is `mail.usegrove.cloud`. Cloudflare hosts its
DKIM and DNS-only `send.mail`/`rsend.mail` CNAME records. The DNS-only tracking CNAME
`links.mail` points to `links2.resend-dns.com`; click tracking is enabled, open
tracking disabled, matching the existing Fern setup. Use each new domain's own
Resend-provided records. API and Clerk CNAMEs must remain DNS-only.

## Rollout and checks

Back up the database, stop API/worker, apply forward migrations
`20261020_006_memory_lifetimes` and `20261020_007_background_services`, then deploy
the matching API/worker before the website. Keep the same model configuration on
both processes. Earlier clients can omit retention fields and preserve existing
expiry when editing.

Inspect `broker_connected`, `broker_retry`, `organization_scheduled`, and
`worker_retry` log codes; check database `jobs` and `transactional_emails` status,
and confirm a delivery in Resend. Logs must omit broker URLs, keys, and recipient
addresses. Restore procedures are in [deploy.md](deploy.md).
