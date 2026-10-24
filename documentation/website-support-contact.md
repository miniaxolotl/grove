# Website support and contact

## Public pages and help navigation

`/support` covers notebook/account access, connected tools, safe troubleshooting,
and the distinction between Grove Cloud and self-hosted instances. `/contact`
covers feedback, general inquiries, privacy/account questions and private
security reporting. Both work signed out and without JavaScript; neither adds a
message-submission backend or asks users to disclose private notebook content.

Footer contact links open `/contact`. Footer, FAQ, recovery, sign-in, Clerk UI,
and workspace help links open `/support`. Recovery uses a full-page anchor so it
also works outside a functioning app router. Public pages retain the existing
marketing layout, with their own canonical/social metadata and sitemap entries.
No authentication or public-share protection policy was changed.

Current website source uses **support@usegrove.cloud** for all public contact.
The public-only `packages/website/src/lib/contact.ts` definition is shared by
policies and help/contact pages. Marketing, recovery, sign-in, Clerk UI and
dashboard assistance link to these public pages, without importing server-only
environment settings into client components.

`packages/website/tests/support-contact.spec.ts` guards current public contact
destinations. Preserve authenticated-workspace and public-sharing isolation;
changing an email destination does not authorize broadening route protection.
Use synthetic browser fixtures, never customer notebook data, for verification.
Source changes do not alter provider console contacts or deploy to production.

The new contact regression first failed on old email links. After migration,
all **224 Chromium cases**, root/site lint and typechecks, root/site builds, and
**nine packaged-artifact checks** passed. Expected failure-path server logs from
sharing tests do not represent a failed suite.
[Reviewed capture](design/screenshots/website-support-contact/README.md).

New page tests first fail on missing routes. The first page verification exposed
Grove's root metadata using a plain title rather than a title template; the new
pages therefore set their complete branded titles explicitly. Eight local axe
WCAG A/AA audits pass at 320/390/768/1440px. Local WebKit was attempted but cannot
launch on this host: Playwright reports missing ICU 74, libjpeg-turbo8 and
GStreamer libav dependencies. No Safari/physical-device pass is claimed and no
system packages were modified. Reproduce on a supported Playwright host with
`pnpm --filter website exec playwright test tests/support-contact.spec.ts --browser=webkit`.

After correcting the branded titles, all **227 Chromium cases** pass, including
the four contact/page scenarios, no-JavaScript reading, signed-out access,
canonical/sitemap/navigation and 320/1440px accessibility checks. Root/site lint,
types and builds, nine packaged-artifact checks, and changed-file formatting pass.

Integration follow-up: development advanced to billing commit `2024c07` while the
PR was opening. The merge preserves its billing implementation and historical
evidence, while retaining this task's designated Grove support address and page
links. The integrated tree again passes root/site lint, types/builds, all nine
artifacts, and all 227 Chromium cases. No provider or database operation is part
of this source integration.
