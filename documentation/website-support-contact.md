# Website support and contact

Current website source uses **support@usegrove.cloud** for all public contact.
The public-only `packages/website/src/lib/contact.ts` definition is shared by
marketing, policies, recovery, sign-in, Clerk UI help, and dashboard help without
importing server-only environment settings into client components.

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
