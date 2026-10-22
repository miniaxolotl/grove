# Website cookie choices

Owner-approved preview from a local production build, captured in Chromium at
1440 × 900 and 390 × 844. The 320px layout was also checked. These screenshots
show implementation, not production deployment. Existing website artwork is
unchanged; no customer data or new fixture images are included.

- [Desktop notice](desktop.png)
- [Mobile notice](mobile.png)
- [Mobile preferences](preferences.png)

The compact notice has equally accessible Accept all and No thanks actions.
Settings separates analytics from advertising. Optional collection starts only
after consent, respects browser privacy signals and fails closed when storage is
unavailable. Choices persist for 180 days and can be changed in the footer.
Revoking advertising reloads the document to unload active tags. Tags are limited
to production public marketing routes, excluding authentication, workspaces and
shared notes. Navigation creates a fresh document once advertising is active.
Public copy uses purpose descriptions, not supplier names.

Verification: website lint, types, production build and 131 browser scenarios pass.
Review also covers category independence, re-consent, responsive layout,
accessibility, focus, remembered dismissal, public-to-private navigation and no
optional requests before consent. Independent product rollout prerequisites apply
before production promotion.
