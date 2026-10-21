# Website performance verification

Build the website with production telemetry enabled and synthetic telemetry
identifiers (see `documentation/development/testing.md`). Keep authentication,
build flags, machine and browser profiles identical before/after; record intentional
resource-loading changes.

```sh
node scripts/performance/website-bundles.mjs --output /path/to/before.json
node scripts/performance/website-bundles.mjs --compare /path/to/before.json --output /path/to/after.json
node scripts/performance/website-bundles.mjs --check
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

For a separate baseline checkout/server, set `PERF_BUILD_DIR` to its `.next`
directory and `PERF_SOURCE` to its exact Git source for either script. Set
`PERF_ORIGIN` to that server for the browser runner. Retain the original baseline
and a paired confirmation when CDN SDK versions change between measurements.

Set `PERF_VERIFY_LAZY=1` and `PERF_BUNDLE_REPORT=/path/to/after.json` to verify that
sign-in/account controls render, the editor is absent before opening a note,
deliberately fail its first chunk load, retry in place, and verify anonymous BFF
denial/private cache headers. Add
`PERF_ONLY_LAZY=1` to run these checks without timing samples.
The held-load check also compares drawer geometry through loading, failure and
successful keyboard retry, and verifies focus stays inside the dialog. Set
`PERF_VERIFY_WIDTH=390` (or `320`) to exercise the same production path on mobile.

CI checks the Notes entry against **513,351 gzip bytes** (75% of the baseline)
and requires the editor marker to remain absent. Real-component browser tests gate
request sharing, fresh navigation, mutation/race behavior and privacy; field timings
remain separate from this deterministic budget.

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

## Cache delivery and paired confirmation (21 October 2026)

Application source `44f5a072e591176cb991ef7fe17860aa61826b1f`, build
`wB9L2PDqM7nlyyouvjpzR`. The measurements below refer to this cache-delivery build;
the later visual loading-state refinement is verified separately below.
Clerk's hosted UI changed from 1.40.0 during the original baseline to 1.41.1.
Rebuilt the exact baseline source as `Lqd9nclWsDAIzkvhogoWe` and ran it immediately
before the final candidate with the same current SDK and profiles. Each column
contains ten runs per profile. The baseline bundle reproduction differs by one byte.

| Metric | Original baseline | Paired baseline | Final |
| --- | ---: | ---: | ---: |
| Desktop cold Notes p75 | 951ms | 941ms | 938ms |
| Desktop Settings→Notes p75 | 227ms | 227ms | **85ms** |
| Desktop first drawer p75 | 99ms | 87ms | 437ms |
| Mobile cold Notes p75 | 7686ms | 7762ms | **6141ms** |
| Mobile Settings→Notes p75 | 453ms | 512ms | 612ms |
| Mobile first drawer p75 | 338ms | 318ms | 2291ms |
| Initial application reads, every run | 2 | 2 | 2 |
| First Settings→Notes round-trip reads, every run | 2 | 2 | **1** |

All four initial targets pass: Notes-entry JS **-33.6%**, first round-trip reads
**-50%**, desktop cached readiness **85ms** (target ≤200ms), and mobile cold
readiness **-20.1%** versus the original / **-20.9%** versus the paired baseline.
Real-component tests also verify zero reads for three further fresh round trips.

The first drawer trades initial loading cost for an on-demand editor download;
the mobile warm return is also slower. These are measured regressions, retained
alongside the cold-load and desktop-navigation gains. Intent preloading can begin
on note hover/focus; touch-first opening still pays the deferred cost.

| Production entry | Original gzip bytes | Final gzip bytes | Change |
| --- | ---: | ---: | ---: |
| Notes | 684,469 | 454,146 | -33.6% |
| Notebook | 695,542 | 456,830 | -34.3% |
| Full note | 673,043 | 685,358 | +1.8% |
| Settings | 433,217 | 447,360 | +3.3% |
| Marketing | 376,679 | 376,705 | +0.0% |

At cold Notes readiness, paired desktop mean heap is **24.09→20.50 MB**, and
mean long-task time **139→64ms**; mobile is **20.80→15.66 MB** and **762→558ms**.
These are point-in-time browser observations, not a heap-leak claim. Separate
tests verify the 200-inactive-entry cap and teardown. Font bytes are
**208,188→128,792** on both profiles: JetBrains Mono's 79,396 bytes now load on demand.

Maximum observed CLS is **0.0545 desktop / 0.1383 mobile**. The original maxima
were 0.0545/0.1442, and paired baseline maxima 0.0371/0.1383. Mobile remains above
the separate 0.1 field goal. Reviewed desktop/mobile captures preserve drawer
geometry, readable content and reachable editing controls. Public-page and workspace
accessibility/geometry regressions pass.

### Remaining-bottleneck decision (P4)

Keep the client-owned cache and deferred boundaries. The remaining cold cost is
dominated by runtime/authentication/UI script loading on the throttled connection;
the independent API reads are fixed at 100ms in this experiment. Request-local
server hydration and backend batching therefore need their own live-service profile
before adoption. The current experiment cannot establish backend lookup costs.

Trialled Clerk `prefetchUI={false}` after finding that this SDK waits for its UI
entry. Actual sign-in failed with “Clerk was not loaded with Ui components”, so the
trial was reverted. Restored sign-in and account controls pass. Telemetry loading
and early privacy/diagnostics retain their existing behavior. Future cold/drawer
work should measure supported auth-UI separation and shared runtime/editor costs
against the same privacy, account-switching and interaction regressions.

Retained evidence: `baseline-*`, `confirmation-before*`, `confirmation-bundles.json`,
`final-browser*`, `final-bundles.json` and `final-lazy-check.json` under the local
state directory above. Intermediate `after-*` reports precede the font change.

## Loading-state refinement

The UI follow-up keeps drawer bounds and focus stable during held/failed/retried
loading, adds static placeholders, and reserves a quiet refresh/retry slot beside
the library count. Its Notes entry is **454,807 gzip bytes**: 661 bytes above the
cache-delivery build, still **33.6% below the original baseline** and within the CI
budget. The editor remains deferred. Geometry checks use actual held production
chunks; interrupted-refresh checks retain actual note selection and position.
Pagination failures retry the same cursor without re-reading earlier pages.

Application source `1eeb1eb4bef50296934ca3d56008c0aa0aa3ae78`, production build
`uW7m97JQuuzxxsQobN2jQ`. Production drawer geometry, keyboard retry/focus, actual
sign-in/account controls and anonymous private/no-store denial pass at 1440, 390
and 320px. The real-component suite additionally covers reduced-motion feedback.
The earlier p75 measurements above remain attached to their original build.
Refinement bundle/auth/geometry reports and synthetic screenshots use the
`refined-*` prefix in the same local evidence directory.

## Gesture integration

Development merged gesture polish (#58) during closeout. The integration at
`abe1e50c220702e0f1f92eb8e109fbf59928c4a1`, build `-SuxdPVBr4YOk8HdoYoTF`, combines
the compact toolbar, reader-controlled chat following and gesture feedback with
cache-owned reads/mutations and deferred loading. Focus transfers from the temporary
drawer header to its ready close control; graph scope uses the normalized query key.

The integrated Notes entry is **457,678 gzip bytes (-33.1% original baseline)** and
notebook entry is **460,613 (-33.8%)**. Both remain within the target; Notes still
passes its CI ceiling and excludes the editor. Reports/captures use `integrated-*`.
Earlier timing samples remain attached to their measured sources above.
The combined suite passes **112 Chromium** and **15 selected iPhone/WebKit** cases;
production held/failed/retried drawer geometry and focus, sign-in/account controls,
and anonymous private/no-store denial pass at **1440, 390 and 320px**.

## Final workspace integration

Landed actions #61 and relationships #60 are integrated at application source
`e20deb615c01ea061a1064aef18eb3269883e7ca`, build `OpJqVPQE_A1t4l2TZW1a1`.
Notes entry is **463,180 gzip bytes (-32.3% original baseline)**; notebook entry
is **466,081 (-33.0%)**. The editor and PDF renderer remain deferred. Canonical
connection pages are cached and fetched only after Linked notes expands, replacing
individual legacy title requests. Review and source changes reconcile that resource
family, including cancellation/deletion fencing; row-delete replay retains conflicts.
Earlier p75 measurements still describe their original source and build.
Final synthetic screenshots and bundle/auth reports use `closeout-*` in local state.
Verification: **131 Chromium / 32 selected iPhone/WebKit** cases, root and website
lint/types/builds, five artifacts, and production auth/chunk/bounds/focus recovery
at 1440/390/320px pass. Seven [reviewed screenshots](../../documentation/design/screenshots/client-performance/README.md)
are committed for the chat/PR handoff.
