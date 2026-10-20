# Product observability

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

The 60-case browser suite includes eleven observability cases using the real SDKs and
local ingestion sinks: actual errors, streamed spans, metrics and logs; recursively
decoded replay; independent browser privacy signals; cross-tab opt-out/identity
reset; provider outages; clipboard outcomes; and a persistent-layout workspace
fixture exercising account switches and private API bodies. The fixture does not
change production authentication. Backend/CLI instrumentation and production
provider acceptance are separate remaining slices.
