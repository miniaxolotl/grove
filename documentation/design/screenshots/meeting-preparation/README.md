# Meeting preparation — visual verification

Synthetic data only, actual workspace components and production CSS. No owner or
customer notes, tokens, provider traffic or participant messaging.

| Capture                                             | Scenario                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [Form, desktop](form-desktop.png)                   | Notebook-local scope, agenda, optional date and explicit generation                          |
| [Brief, desktop](brief-desktop.png)                 | Real loopback API/PostgreSQL/worker, two supplied/cited notes and reviewed save              |
| [Brief, 320px](brief-phone.png)                     | Same real-service flow; wrapped content, source disclosures and save destination             |
| [Partial sources, 320px](partial-sources-phone.png) | Synthetic response fixture with explicit partial coverage and opened exact-revision evidence |

The real-service fixture is `tests/src/fixtures/meeting-api.ts`: non-owner API/worker,
saved synthetic notes, structured deterministic inference and the real HTTP routes.
The component tests in `meeting-preparation.spec.ts` additionally inject lost enqueue/
save replies, default-off opt-in, cancellation and exact-pin recovery without losing
the agenda. The broader assistance tests retain offline expiry and existing flows.

Reviewed at 1440/390/320px with WCAG A/AA, horizontal-overflow and page-error checks.
The refreshed captures use source `56b675dcc1fdceeed6f354be678e13645e5d6b45`
and production CSS/build `TbNm5ggTLWqDzmLQS5OoP`. The first three are Chromium
real-service captures; the partial-source capture is supported Noble WebKit with a
synthetic API response. Five focused WebKit cases pass, including lost replies,
consent, cancellation, exact-pin recovery and offline expiry.

Screenshots verify layout and browser behavior, not semantic model accuracy, paid
provider latency or physical-device keyboards. Verification counts and remaining
qualification limits are recorded in [delivery](../../../delivery.md).
