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
Its production ingestion and symbolication acceptance follows the new release.

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
677268. Native/service production acceptance follows the coordinated release.

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
change production authentication. Backend/CLI instrumentation and production
provider acceptance are separate remaining slices.
