# Product observability

## Google Search Console

Verified on **21 October 2026 UTC**: the
[usegrove.cloud Domain property](https://search.google.com/search-console?resource_id=sc-domain%3Ausegrove.cloud)
reports **You are a verified owner**. The apex Cloudflare TXT record was read
back through its API and public Google DNS. Keep that verification record in DNS
to retain ownership; the account, exact record and private evidence are recorded
in the original checkout's ignored `secrets.md`.

Google processed [the production sitemap](https://usegrove.cloud/sitemap.xml)
successfully on the same date: **Success**, **5 discovered pages**, zero videos.
Both `/robots.txt` and `/sitemap.xml` return HTTP 200. The sitemap lists public
marketing pages; robots excludes `/app`, `/api`, `/sign-in` and `/sign-up`.
Discovered pages are not an indexed-page count; initial indexing and
search-performance reports are collecting data. Use **Sitemaps** for processing
errors, **Pages** for indexing, and **Performance** for search queries,
impressions, clicks and position. Search Console complements PostHog acquisition
and behavior reporting through Google's search data and DNS ownership verification.

## Verified delivery

Initial website release **1.6.0** passed protected source CI, promotion #40 and live
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
contracts pass. The coordinated 1.7.1 release below passes exact-release span
indexing.

### Coordinated 1.7.1 acceptance — 21 October 2026 UTC

Repair #45, Release Please #46 and frozen production #47 are merged. Immutable
**v1.7.1** identifies source `d22d90bc2b2968ed3c296249297f732e7e17d358`; production
is `bccc1f0bef6f1514229375d205608904bb987e8b`, with matching source tree
`43ca5541136e627ae8888eddfaf8078875af4ab1`. Source CI 39547303448 and both frozen
candidate runs 39547922113/39547918123 pass. Protected
[Deploy 39548392395](https://github.com/miniaxolotl/grove/actions/runs/39548392395)
successfully published all five packages and deployed API/worker. Registry
SHA-1/SHA-512 and local SHA-256 checks pass, and all bundles embed the admitted
source revision.

Both services are ACTIVE on deployment `26298863-67e4-407b-9a6c-37ad0e45e562`,
digest `sha256:f1cc152f102ee53b23a02ebf43e4faf5c27b711ffcf94f061eea3d6a4cdcdda9`.
Liveness and semantic readiness return 200; runtime readback retains collection
switches and the API-only secret salt. No migration was needed. The published
Linux CLI preserves product configuration, sends no provider requests after
durable opt-out, and rotates its anonymous identity on re-enable. PostHog indexes
12 exact-release events, excluding the opted-out command; private markers are
absent. Error `0bc1ca0ffda742c19c869634010e9758` resolves to original integration
source without Sentry processing errors. The current Sentry **spans** dataset
indexes CLI span `96f18b69500bcb6d` and API spans `981b1a4534164865` and
`8962c5ffef45979d`, all attributed to the exact released source. The unchanged 10%
sampler is exercised through ordinary commands and public metadata requests.
Worker maintenance and API requests also reach PostHog; exact-release worker logs
and service metrics are accepted. The native/service trace-delivery defect is
resolved.

The live 1.7.1 website passes cross-tab disable/re-enable and private-marker
checks. PostHog indexes seven personless events for the actual production release.
Sentry event `874818a2f8de4880b47824d7b9ce3318` resolves through the deployed source
map to `packages/website/src/lib/diagnostics.ts:44`, without processing errors.
API, CLI and OpenCode source releases each have an eight-file symbol bundle and
both actual source commits. Explicit commit metadata was uploaded after readback:
providerless SHA references alone do not import Git metadata.

All **14 dashboard queries** execute successfully. The activation table counts
distinct anonymous event identities by surface. Provider readback finds zero
person profiles; reference-cohort counts are not authoritative for personless
collection. The final controls retain 10%/30-day masked replay, no console or
network content, enabled daily failure alerts and Monday reports. Experiments and
milestone surveys remain drafts.

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
Sentry `grove-api`; developer tools share `grove-cli`. PostHog project remains
**677268**. Native/service production readbacks are recorded above; the sampling-header
repair is released across all five bundled consumers in 1.7.1.

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
