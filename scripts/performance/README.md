# Website performance verification

Build the website with production telemetry enabled and synthetic telemetry
identifiers (see `documentation/development/testing.md`). Keep authentication,
fonts, build flags, machine and browser profiles identical before/after.

```sh
node scripts/performance/website-bundles.mjs --output /path/to/before.json
node scripts/performance/website-bundles.mjs --compare /path/to/before.json --output /path/to/after.json
```

The bundle report unions the shared runtime and route entry chunks, gzipping each
individually. It is a reproducible entry budget, not observed browser transfer.

For browser measurements, serve that production build on `http://localhost:4382`
with a Clerk **development** instance configured. Supply `PERF_CLERK_SECRET_KEY`
and `PERF_USER_ID` for an existing disposable development user via the environment;
the runner issues a short-lived sign-in ticket without logging/storing it.

```sh
PERF_OUTPUT=/path/to/before-browser node scripts/performance/website-browser.mjs
```

This uses real Clerk authentication, production Next routing and actual chunks.
Application API reads are intercepted with 30 synthetic notes, one notebook and
a fixed 100ms delay. It measures client costs, not live API/database latency or
field Web Vitals. Synthetic PostHog/Sentry traffic is intercepted. Ten cold and
warm runs per profile collect useful Notes readiness, Settings→Notes readiness,
drawer readiness, request counts, JS resource timing, long tasks, heap and CLS.
The mobile profile uses 390×844, 4× CPU slowdown, 1.6Mbps down and 100ms latency;
desktop uses 1440×1000 without throttling. Browser HTTP cache is disabled, while
the application remains mounted for the warm navigation. Run without competing
builds/tests; timing assertions belong in controlled measurements, not shared CI.

## Baseline (21 October 2026)

Application source `8d65ec03218893c2426a391ee4560388c6b36c6d`, production build
`8zoqoCEgIPSMHG-yCEZZT`, Node 24.21.0, pnpm 10.33.0, Chromium via Playwright 1.64.1.

| Metric | Desktop p75 | Mobile p75 |
| --- | ---: | ---: |
| Cold useful Notes | 951ms | 7686ms |
| Settings→Notes | 227ms | 453ms |
| First drawer | 99ms | 338ms |

Notes entry JS: **684,469 gzip bytes**; editor-containing chunk: **238,251 bytes**.
The raw machine-local reports and screenshots are retained in
`~/.local/state/grove-client-performance/`.
