# Product observability

## Verified delivery

Website release **1.6.0** passed protected source CI, promotion #40 and live
browser acceptance. PostHog indexes the exact production release, opt-out clears
both tabs and only a fresh identity resumes collection. A sampled recording was
decoded locally and read back from PostHog; private markers were absent and text
was masked. Sentry event `8e304a9ab2c94c26a48bd10e2fda575a` resolves the deployed
JavaScript coordinate to `packages/website/src/lib/diagnostics.ts`.

The native/service slice passes 60 PostgreSQL/provider/client/SDK checks,
five production-configured packed-artifact checks, root/website lint/types/builds,
five relevant browser scenarios, 17 release/deployment contracts and workflow lint.
These include stalled response bodies, silent bounded shutdown, host SDK isolation,
concurrent first-workspace creation, commit/rollback/replay conversion semantics,
chat apply/undo, model usage accounting and browser/API opt-out propagation.
Release **1.7.0** from `e37635d483d0985c867e43e726964a5e147d5b57` is published
and active on both API/worker components at
`sha256:4fe7fc3a13c9767b96f65a8f947354f0e2b8fe3323c331734bcc4c96179309c5`.
All five npm package integrities and native opt-out/rotation checks pass. Sentry
event `bb43800afa03429d893c01a18e770f3a` resolves to
`lib/integration-core/src/node.ts:189`. Both health endpoints return 200, including
semantic readiness. PostHog indexes exact-release API/worker milestones, successful
jobs, maintenance, recalls/chat and bounded model metadata. Sentry indexes
exact-release worker maintenance/job and API request logs and accepts metrics.

Live acceptance exposed `missing_dsc` rejection of the native streamed spans:
Sentry v11's asynchronous buffer reads the current host client after Grove's
private scope has ended. The send boundary now rebuilds the sampling header from
the configured Grove project, release, rate and projected trace. It preserves
buffering and opt-out checks and cannot copy another host's project or context.
Actual SDK tests cover an absent host client and timer delivery with a second
client active, as well as the existing queued opt-out test. Root lint/types/build,
all **62 database/provider/SDK cases**, five artifacts and 17 release/deployment
contracts pass. Exact-release span indexing remains the follow-up release gate.

## Service and developer-tool collection

`lib/telemetry` is shared by the API, worker, CLI, MCP bridge and agent adapters.
Official production builds embed only public ingestion credentials and the admitted
source SHA. Local, staging, CI and private-mode execution is inert. The server also
requires `GROVE_TELEMETRY_ENABLED=true` at runtime. Upload credentials and the
server account-pseudonym salt never enter client builds.

- CLI preference: `grove telemetry status|disable|enable`, `GROVE_TELEMETRY=0`,
  or `DO_NOT_TRACK=1`. The protected local identity is separate from credentials;
  disabling or switching accounts invalidates running generations and queued sends.
- Request opt-out travels through the authenticated BFF/CLI to the API. Browser,
  installation and server account pseudonyms remain separate. Background operations
  use an ephemeral service identity rather than account identifiers.
- Workspace creation, notebook creation, new memory creation and completed chat
  replies are emitted only after durable success. Idempotent repeats, edits,
  rolled-back writes and denied requests do not produce creation conversions.
- Provider/role/outcome/token/timing metadata is projected explicitly; no model
  prompts, responses, embeddings, notebook names, Git origins, file paths, keys,
  headers or bodies are collected. Custom model names are not sent.
- Sentry clients are isolated from the host agent: no global handlers or context
  strategy replacement. Error frames retain only emitted entrypoint filenames and
  coordinates; exact-source maps resolve them privately. Operations emit sampled
  spans, numeric metrics and fixed-message logs.
- Queues are bounded at 128 records. Enqueue never waits for a provider; requests
  time out, provider failures open a short drop window, and shutdown waits at most
  550 ms (50 ms for optional context hooks). Every upload rechecks collection.

Production release uploads `grove-api@<source>`, `grove-cli@<source>` and
`grove-opencode@<source>` source maps before publication. API and worker share
Sentry `grove-api`; developer tools share `grove-cli`. PostHog project remains 677268. Native/service production readbacks are recorded above; the sampling-header
repair requires a new coordinated release across all bundled consumers.

## Website and workspace

Production uses the US PostHog **Grove** project (`677268`) and Sentry
**grove-website** in `bramble-labs-inc`. Development/preview builds are inert.
The PostHog/Sentry footer preference applies throughout the website and workspace;
Do Not Track and Global Privacy Control also disable both browser providers.
Private storage failure stops collection. Disabling clears the analytics identity
and invalidates all open tabs; re-enable uses a new identity. Older tabs cannot
resume the cleared identity. Account changes reset it without transmitting the
account identifier. Browser, CLI, backend and other-product identities are not
joined.

Only explicit, projected events are sent: public navigation, CTA/referral clicks,
successful installation copies and bounded operation outcomes. No autocapture or
person profiles. Query strings, fragments and private route identifiers are
removed. Clipboard contents, note text, prompts, responses, credentials, emails,
request headers/bodies and arbitrary error details never enter analytics.
Workspace operations record categories such as `memory_write` and `memory_recall`;
backend code owns successful product milestones to prevent duplicate conversions.

PostHog owns replay: 10% sampling, 30-day retention, masked text and inputs,
blocked images/media/iframes/private regions, no console or network headers/bodies.
Recording stops before client navigation and is enabled only on enumerated public
routes. Authenticated, connection approval and sign-in screens are blocked from
recording. Captured DOM URL attributes are normalized and JSON-LD capture is off.

Sentry collects sanitized errors, 10% sampled spans, and bounded operation metrics
and logs. Final projections exclude private details independently of SDK collection
settings. Stack file/line/debug IDs remain for source maps; local paths, source
excerpts and variables are removed. The browser transport rechecks opt-out and
identity generation for every envelope, including queued logs/metrics/spans.
Propagation is restricted to the website's own API proxy; server propagation is
off. Server diagnostics have independent operator settings and are content-redacted.

The public CTA reads `website-cta-copy`; `session-replay` controls the recorder.
The existing rating-only milestone survey and CTA experiment remain drafts pending
matching production acceptance. Cross-product footer links carry public referral
campaign labels only, without cross-project identifiers.

## Production configuration and delivery

Vercel production-only variables were installed and read back October 20, 2026:
`NEXT_PUBLIC_POSTHOG_ENABLED`, `NEXT_PUBLIC_POSTHOG_KEY`,
`NEXT_PUBLIC_SENTRY_ENABLED`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENABLED`,
`SENTRY_DSN`, `SENTRY_AUTH_TOKEN`. The first two provider keys/DSNs are public
ingestion configuration. The upload token is build/server-only, never public.
The ignored authoritative `secrets.md` records the existing owner-managed token's
source and rotation coordination.

The build creates `grove-website@<source SHA>`, uploads source maps, and deletes
maps after upload. Production upload without an upload credential fails the build.
Protected delivery remains feature PR → development → Release Please tag → frozen
production PR. Do not deploy a moving development head or alter a released tag.

## Verification

The 66-case browser suite includes eleven observability cases using the real SDKs and
local ingestion sinks: actual errors, streamed spans, metrics and logs; recursively
decoded replay; independent browser privacy signals; cross-tab opt-out/identity
reset; provider outages; clipboard outcomes; and a persistent-layout workspace
fixture exercising account switches and private API bodies. The fixture does not
change production authentication. Native service acceptance additionally checks
actual indexed spans, rather than treating an HTTP ingestion acknowledgement as
proof that the provider accepted the payload.
