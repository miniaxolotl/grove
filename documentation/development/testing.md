# Verification

Use **Node 24** and **pnpm 10.33.0**. Run from the repository root unless noted.
Use synthetic identities/content and task-owned ports, temporary directories and
output paths. Never reset a retained database or weaken RLS, assertions or limits
to make a check pass. Feature-specific cases belong in that feature's topic guide,
not in a growing central test log.

## Required checks

```sh
pnpm install --frozen-lockfile
pnpm test:docs
pnpm lint
pnpm check-types
pnpm build
pnpm test:artifacts
```

Run relevant backend/browser tests as well. For release/workflow inputs also run:

```sh
node --test scripts/ci/*.test.mjs scripts/release/*.test.mjs tests/digitalocean.test.mjs
bash scripts/ci/run-actionlint.sh
```

`pnpm test:docs` checks local Markdown links, images and heading anchors, including
reference links and HTML image links. It does not certify external websites,
deployed configuration or the truth of prose; compare changed claims with source.
See [documentation maintenance](documentation.md).

## Disposable PostgreSQL

Choose an unused container name and loopback port for your task; do not reuse
another workstream's database. The following is an example for a **new** fixture:

```sh
docker run -d --name grove-doc-example-test -p 127.0.0.1:26432:5432 \
  -e POSTGRES_DB=grove_test -e POSTGRES_PASSWORD=grove_disposable_test pgvector/pgvector:0.8.2-pg17
export TEST_MIGRATION_DATABASE_URL=postgresql://postgres:grove_disposable_test@127.0.0.1:26432/grove_test
export TEST_DATABASE_URL=postgresql://grove_api:grove_disposable_api@127.0.0.1:26432/grove_test
export TEST_WORKER_DATABASE_URL=postgresql://grove_jobs:grove_disposable_worker@127.0.0.1:26432/grove_test
pnpm test:db:setup
pnpm test
```

Wait for PostgreSQL readiness before bootstrap. All configured test databases must
end in `_test`. The migration role needs `CREATEDB`; upgrade/recovery tests create
and remove only their own uniquely named databases. API/worker URLs must use real
**non-owner, non-superuser, non-BYPASSRLS roles**. Bootstrap applies forward schema
and creates runtime roles; rerun it after integrating new migrations, not a reset.

Bound backend test-file concurrency to local capacity when necessary:

```sh
pnpm exec tsx --test --test-concurrency=2 tests/src/*.test.ts
```

`TEST_AMQP_URL` enables disposable broker checks. Optional source-store S3 tests
are described in [media verification](../media.md#storage-implementation-and-verification); export-store tests
use `TEST_STORAGE_ENDPOINT`, `TEST_STORAGE_BUCKET`, `TEST_STORAGE_KEY` and
`TEST_STORAGE_SECRET` against owned fixtures. Record missing-service skips explicitly.
Never use application buckets for tests that create/remove objects.

## Website and browsers

Build **before**, never during, browser execution. The dashboard fixture captures
production CSS filenames at startup; restart it after rebuilding. Run type generation
and the build serially because both write `.next`.

```sh
pnpm lint:website
pnpm check-types:website
VERCEL_ENV=production NEXT_PUBLIC_POSTHOG_ENABLED=true \
  NEXT_PUBLIC_POSTHOG_KEY=phc_playwright_only NEXT_PUBLIC_SENTRY_ENABLED=true \
  NEXT_PUBLIC_SENTRY_DSN=https://00000000000000000000000000000000@o0.ingest.us.sentry.io/1 \
  pnpm build:website
node scripts/performance/website-bundles.mjs --check
pnpm --filter website exec playwright install chromium
pnpm test:website
```

The telemetry identifiers above are synthetic; the suites intercept SDK traffic.
Fixtures use actual components with synthetic HTTP responses, not production auth
bypasses. Real API/parser/worker journeys are separate evidence. Expected error-path
server logs do not imply failure; inspect the final exit code and test counts.

Review relevant desktop, 390px and 320px states, short windows, keyboard/focus,
accessibility, overflow and errors. Use existing focused `playwright.*-webkit.config.ts`
files under `packages/website`; for example:

```sh
pnpm --filter website exec playwright install webkit
pnpm --filter website exec playwright test --config playwright.webkit.config.ts
```

If Linux lacks WebKit libraries, use the image matching the locked Playwright version:

```sh
docker run --rm --ipc=host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:$PWD" -w "$PWD/packages/website" \
  mcr.microsoft.com/playwright:v1.64.1-noble \
  node node_modules/@playwright/test/cli.js test --config playwright.webkit.config.ts
```

Concurrent suites need distinct `WEBSITE_TEST_PORT`, `SHARING_TEST_PORT`,
`DASHBOARD_TEST_PORT` **and** `--output` directories; runners clear their outputs.
Use a task-owned `TMPDIR` when shared scratch is constrained. Native downloads
bypass Playwright page routing; use an owned upstream and `saveAs` to inspect bytes.
Emulation does not qualify physical keyboards, microphone permissions, file delivery,
back-edge gestures or touch/pen feel. Filtered dialog accessibility and full-catalog
functional checks must be reported separately.

## Packaged and live integrations

After `pnpm build`, `pnpm test:artifacts` packs distributables and tests them away
from workspace source. `pnpm test:agents` uses isolated temporary homes and the
integrity-locked Linux x64 OpenCode/Claude/Codex binaries in
`scripts/testing/hosts/package-lock.json`; it does not qualify other host versions
or operating systems. Never use your normal agent credential/config directory.

Live Clerk, hosted-chat, Stripe, storage and model checks require separate approval
and disposable identities/content. Mocked OAuth/provider success is not live-host
or payment acceptance. Keep request/token/spend bounds explicit for paid evaluations.
Record exact source, commands, failures/skips and acceptance limits in the PR or
topic evidence, as described in [delivery](../delivery.md).
