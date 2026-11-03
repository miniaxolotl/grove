# Product observability

Collection must expose operational outcomes without notebook content or credentials.
Current code owns projection/privacy controls; dated provider acceptance is linked
from the [archive](archive/README.md), not presented as today's deployment state.

## Service and developer tools

`lib/telemetry` is shared by API, worker, CLI, MCP and agent adapters. Official
production builds embed public ingestion configuration and admitted source SHA;
local/staging/CI/private execution is inert. Services also require
`GROVE_TELEMETRY_ENABLED=true`. Upload credentials and account-pseudonym salt never
enter clients.

- CLI: `grove telemetry status|disable|enable`, `GROVE_TELEMETRY=0` or
  `DO_NOT_TRACK=1`. Local identity is separate from credentials; opt-out/account
  changes invalidate running generations and queued sends.
- Opt-out travels through authenticated BFF/CLI requests to API. Browser, installation
  and server identities stay separate; background work uses an ephemeral identity.
- Durable workspace/notebook/note creation and completed replies emit milestones
  only after commit. Replays, denied/rolled-back writes and edits are not conversions.
- Allowlisted provider/role/outcome/token/timing metadata excludes prompts, responses,
  vectors, names, origins, paths, keys, headers, bodies and custom model names.
- Sentry uses an isolated client/scope, not host-agent global handlers. Emitted
  filenames/coordinates support source maps without local paths/source excerpts.
  The sampling header is projected from Grove's own client configuration at send
  time, never borrowed from another host client.
- Queues are bounded to 128 records; enqueue never waits for a provider. Uploads
  recheck collection, time out and drop during short provider-failure windows.
  Shutdown waits at most 550ms (50ms for optional hooks).

## Website and workspace

Production browser ingestion uses the US PostHog Grove project and Sentry
`grove-website`; preview/development builds are inert. Footer preference, Do Not
Track and Global Privacy Control disable both providers. Storage failure stops
collection. Disable clears identity across tabs; re-enable creates a new identity.
Account changes reset it without transmitting account identifiers.

Only explicit projected events are sent: public navigation, CTA/referral clicks,
installation copy and bounded outcomes. No autocapture/person profiles. Remove
query strings, fragments, private route IDs and arbitrary diagnostics. Clipboard
contents, notes, prompts, replies, credentials, emails and HTTP bodies/headers are
not analytics. Backend code owns durable milestones to avoid double counting.

Replay is PostHog-only: 10% sampling, 30-day retention, masked text/inputs, blocked
images/media/iframes/private regions, no console/network content. Stop recording
before navigation; only enumerated public routes may record. Authenticated, approval,
shared-reader and sign-in pages remain excluded. Normalize DOM URL attributes and
disable JSON-LD capture. `session-replay` gates recording; `website-cta-copy` controls
the public CTA. An experiment/flag definition does not establish a live experiment.

Sentry projects sanitized errors, 10% spans, bounded metrics/logs, exact-source debug
coordinates and opt-out/generation checks at transport, including queued envelopes.
Browser propagation is restricted to the same-origin API proxy; server propagation
is off. Application redaction does **not** sanitize hosting access logs; capability
path exposure remains an [actual-host acceptance check](sharing.md#storage-and-rollout).

## Configuration and release

Production website public inputs: `NEXT_PUBLIC_POSTHOG_ENABLED`,
`NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_SENTRY_ENABLED`, `NEXT_PUBLIC_SENTRY_DSN`.
Server/build inputs: `SENTRY_ENABLED`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`. Public
ingestion keys/DSNs are not management credentials; upload tokens remain private.
Use current private provider inventory/readback, never copy values from old reports.

Builds create `grove-website@<source SHA>` and upload exact-source maps, then remove
the maps from output. Production source-map upload requires its credential. Service/
native release maps use `grove-api@<source>`, `grove-cli@<source>` and
`grove-opencode@<source>`; API/worker share `grove-api`, developer tools `grove-cli`.
Follow [protected deployment](deploy.md), not a moving development head.

## Search Console

Maintain the existing `sc-domain:usegrove.cloud` ownership TXT record in DNS;
the October 21 verification and five-page sitemap observation are historical.
Current public routes come from `packages/website/src/app/sitemap.ts`. Verify
actual sitemap processing in Search Console: **Sitemaps** shows processing errors,
**Pages** indexing, and **Performance** queries/impressions/clicks. Discovered pages
are not indexed pages or evidence of acquisition. Keep private/auth/API routes out
of indexing and follow [reference publishing](website-discovery.md).

## Verification

`telemetry.test.ts` uses real SDKs with local sinks for projected payloads, concurrent
context, durable milestones, opt-out races, host-client isolation and bounded silent
shutdown. Browser `telemetry.spec.ts` decodes actual envelopes/replay and checks
privacy signals, cross-tab/account resets, outages and private-route canaries.
Artifact checks ensure offline doctor creates no identity/requests, and its explicit
probe performs only the requested API read with telemetry disabled.

Use the [synthetic telemetry build](development/testing.md#website-and-browsers).
Actual provider acceptance needs indexed exact-release events/spans, private-marker
absence and source-map resolution; HTTP ingestion acknowledgement alone is not
indexing success. Provider configuration, alerts, survey/experiment activation and
live traffic changes require separate approval.
