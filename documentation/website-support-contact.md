# Support and contact

`/support` covers notebook/account access, connected tools, safe troubleshooting,
and Cloud versus self-hosted responsibilities. `/contact` covers feedback, general
inquiries, privacy/account questions and private security reports. Both are public
and readable without JavaScript. Neither accepts messages through a new backend
or asks for private notebook content.

Public contact is **support@usegrove.cloud**, defined once in
`packages/website/src/lib/contact.ts`. Legal/help/contact pages reuse it. Provider
console contacts are separate operator configuration; changing website prose does
not change them.

Footer contact opens `/contact`; FAQ, recovery, sign-in, Clerk UI and workspace
help open `/support`. Recovery uses a full-page anchor so it works outside the
router. Keep public canonical/social metadata and sitemap entries, and preserve
private-workspace/public-sharing isolation. Do not import server-only settings
into these client-facing definitions.

## Verification

`packages/website/tests/support-contact.spec.ts` checks public routes, destinations,
no-JS reading, complete branded titles, canonical/sitemap/navigation and desktop/
phone accessibility. Review keyboard use and 320/390/768/1440px with synthetic
fixtures. Use the supported [WebKit runner](development/testing.md#website-and-browsers)
when host libraries are missing; a failed launch is not a Safari pass. Edge email
obfuscation can alter server text before hydration, so deployed legal pages need
real-browser verification after edge changes.

[Reviewed captures](design/screenshots/website-support-contact/README.md) and the
[historical ledger](archive/README.md) preserve source-specific outcomes. They are
not current-head test totals or production status.
