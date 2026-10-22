# Error-page refinement

Production capture source: `7144d821d841a888a41c6539527782bafee3ea03`.
Build: `LTkngUYz6nYcp3UslQsTO`. Captured 22 October 2026 UTC after integrating
landed stable-library and sharing features. The two isolated global-error captures
remain from `efc3e9f`; those component/style files are unchanged.

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
bounds and focus. All 149 Chromium cases and 35 supported focused iPhone/WebKit
cases pass. A Chromium clipboard-permission case cannot start on WebKit because
that engine does not support the requested grant; its real clipboard check passes
in Chromium. Standalone global recovery also passes in Chromium and WebKit.

Raw captures and reports are retained in
`~/.local/state/grove-client-performance/errors-combined-*`. Earlier error captures
use `errors-*`; the first lazy-check reports recorded the pre-commit parent HEAD
and identify their UI through build `UpJFqxXdLGN3bgNn9nYze`. Earlier workspace
captures remain under `../client-performance/`.
