# Error-page refinement

Application source: `efc3e9f223254e07e775c4497f49f219d8cbfc31`.
Production build: `UpJFqxXdLGN3bgNn9nYze`. Captured 22 October 2026 UTC.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Missing page | [404](404-desktop.png) | [390px](404-mobile.png) |
| Root-layout failure | [Global error](global-desktop.png) | [390px](global-mobile.png) |
| Deferred note failure | [Drawer](drawer-desktop.png) | [390px](drawer-mobile.png) |
| Unavailable service | [Notes](service-desktop.png) | [320px](service-mobile.png) |

404 captures use production Next with JavaScript disabled. Drawer and service
captures use real development Clerk authentication, synthetic notes and deliberately
failed API/chunk responses. Root-layout captures mount the actual global-error
component in an isolated document with only its own stylesheet/fonts; framework
host and diagnostics are stubbed in that visual harness.

Verified accessibility at 1440/390/320px, keyboard retry and home navigation,
200% text at 320px, short-drawer scrolling, and stable pending/failed/retried drawer
bounds and focus. The full 131-case Chromium suite and 16 focused iPhone/WebKit
cases pass. Standalone global recovery also passes in Chromium and WebKit.

Raw captures and reports are retained in
`~/.local/state/grove-client-performance/errors-*`. The lazy-check reports were
created before the UI commit and record its parent HEAD; their build ID matches the
application source above. Earlier captures remain under `../client-performance/`.
