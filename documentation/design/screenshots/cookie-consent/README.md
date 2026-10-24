# Website cookie choices

Owner-approved preview from a local production build, captured in Chromium at
1440 × 900 and 390 × 844. The 320px layout was also checked. These screenshots
show implementation, not production deployment. Existing website artwork is
unchanged; no customer data or new fixture images are included.

- [Desktop notice](desktop.png)
- [Mobile notice](mobile.png)
- [Mobile preferences](preferences.png)

The preferences capture reflects the owner's shorter Analytics description:
"Understand site usage and performance." It was refreshed from the local
production build on 22 October 2026, at 390 × 844 in Chromium.

The compact notice has equally accessible Accept all and No thanks actions.
Settings separates analytics from advertising. Optional collection starts only
after consent, respects browser privacy signals and fails closed when storage is
unavailable. Choices persist for 180 days and can be changed in the footer.
Revoking advertising reloads the document to unload active tags. Tags are limited
to production public marketing routes, excluding authentication, workspaces and
shared notes. Navigation creates a fresh document once advertising is active.
Public copy uses purpose descriptions, not supplier names.

The [registration handoff](../../../advertising-conversions.md) adds one separately
server-qualified, content-free `/welcome` exception. It does not permit vendors
on authentication, private notebooks or shared notes.

Verification: website lint, types, production build and 159 browser scenarios pass
after integrating the independently merged client-performance update. Root lint,
types, build and all five packed-artifact checks also pass.
Review also covers category independence, re-consent, responsive layout,
accessibility, focus, remembered dismissal, public-to-private navigation and no
optional requests before consent. Independent product rollout prerequisites apply
before production promotion.
