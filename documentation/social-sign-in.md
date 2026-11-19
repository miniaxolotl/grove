# Social sign-in and connected accounts

Grove uses Clerk's existing sign-in and sign-up components for GitHub, Google,
Microsoft and Apple. Which providers appear is controlled by the Clerk instance,
so provider credentials are configured in Clerk rather than the website bundle.

Both entry routes offer a **Back to Grove** link above the form. Clerk handles
the sign-in/sign-up switch and verification. Without a pending destination,
sign-in returns to `/app` and sign-up continues to `/welcome`. If Clerk keys
are missing, the page explains which action is unavailable and links to support
instead of requesting credentials. See the [local fallback captures](design/screenshots/account-entry/README.md).

## Connecting another account

While signed in, open **Settings → Sign-in & connected accounts**. The panel
shows the current user's external accounts and distinguishes verified connections
from accounts that still need verification. Choose **Connect an account** or
**Manage connected accounts**, then **Connected accounts → Connect account** in
the Clerk profile dialog. Complete the selected provider's authorization flow.

Clerk handles provider verification, callback state, cancellation, duplicate
identities and disconnect restrictions. Linking through the signed-in profile
attaches the provider to the current Clerk user. Grove's database maps that user's
Clerk subject to its existing account, so memories and agent grants remain tied
to the same account. The panel updates from Clerk's reactive user resource.

For providers using different email addresses, including Apple's Hide My Email,
connect from the existing signed-in profile before using that provider to sign in.
Do not create a second Grove account and expect its memories to be merged.

## Production configuration

- Website: `https://grovenote.app` (see [domain cutover](deploy.md#domain-cutover)).
- Clerk application: `app_3KtGcnwE2Yg0P34l9PVij7LnOTS`.
- Production instance: `ins_3Ktp2ZQ986pL3Dmhk7tJkesRR6A`.
- Clerk issuer: `https://clerk.grovenote.app`; the existing production instance
  and user identities are retained.
- Dedicated Google project: `grove-clerk-auth-2026` (`Grove Authentication`).

The production callback is `https://clerk.grovenote.app/v1/oauth_callback`.
Check each provider's saved callback independently; changing the Clerk domain
does not update a provider's registration. Development uses a separate Clerk
instance. The dated registration and account-linking evidence below predates the
domain change and does not establish acceptance on the new domain.

### Verify the deployed public key

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is a build-time input. Updating its saved Vercel
value or redeploying an old `.vercel/output` directory does not replace the key
already compiled into the browser bundle. A READY deployment or HTTP 200 sign-in
document is not sufficient: the form can remain at “Loading sign-in…” while the
old Clerk script host fails CORS.

For a configuration-only repair, use a clean checkout of the **currently admitted
website source**, pull its current production environment, and run an actual
production build before deploying the resulting prebuilt output. Preserve the
release source/version identity and coordinate with the release owner; do not
substitute a newer moving branch or bypass backend/schema admission. Keep pulled
environment files private and remove them after use.

Verify the public-key hostname in the built output before deployment. Then check
the served sign-in document, successfully loaded Clerk scripts and initialized
form in a real browser on `grovenote.app`. The current host must be
`clerk.grovenote.app`, not `clerk.usegrove.cloud`. See the scoped
[browser comparison](design/screenshots/clerk-build/README.md).
Rendering the form is not a completed provider login, email-delivery test or
authenticated API/MCP acceptance; perform those checks separately with the user.

| Provider  | Registration requirements                                                                                                                  | Clerk configuration section  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| GitHub    | OAuth app, homepage, exact authorization callback, client ID and secret                                                                    | `connection_oauth_github`    |
| Google    | Web OAuth client; External audience published to production; Grove branding, authorized origins and exact redirect                         | `connection_oauth_google`    |
| Microsoft | Entra app supporting organizational and personal accounts; web redirect; client-secret value; email verification claims per Clerk's guide  | `connection_oauth_microsoft` |
| Apple     | App ID with Sign in with Apple, web Services ID, Team ID, Key ID, `.p8` private key, exact return URL and Clerk private-relay email source | `connection_oauth_apple`     |

Configure each connection with `enabled: true`, `authenticatable: true`,
`client_id` and `client_secret` together. Apple additionally needs `team_id` and
`key_id`; its `client_secret` is the complete PEM private key, not a manually
generated client-secret JWT. Validate the partial patch with Clerk's dry-run
before applying it. Never include credentials in Git, command-line arguments,
screenshots or public verification receipts. Maintain the private Grove inventory.

Only basic identity/email scopes are needed. Grove does not request repository,
calendar, email inbox or cloud administration access to sign users in.

### Registration status (2026-10-19)

| Provider  | Production state                                                                                           | Registration                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| GitHub    | Enabled; real-account sign-in and authenticated account access passed                                      | OAuth app `3944913`, client `Ov23liUu9OnmcwEZjPSY`                                                                     |
| Google    | Enabled; External audience In production; real-account linking, cancellation and subsequent sign-in passed | Project `grove-clerk-auth-2026`, Web client `913831798455-k1uv2lgpv8mffqkfp61pg4saq57mcdr3.apps.googleusercontent.com` |
| Microsoft | Enabled for personal and organizational accounts; existing-account connection verified                     | App `4772cb1f-a86c-423b-b123-a3efb67e7f4f`, tenant `345c25c1-c7f1-404b-b756-06f33854ab7d`                              |
| Apple     | Enabled; existing-account connection verified; private-relay sender registered and SPF verified            | App ID `cloud.usegrove.app`, Services ID `cloud.usegrove.web`, team `Q266AQB5H8`, key `8D923PV78Q`                     |

Microsoft's client secret expires **2027-04-17**. Rotate it in Entra and Clerk
before that date. Its saved manifest includes `email` and `xms_edov` in both ID
and access tokens, `acceptMappedClaims`, v2 tokens, the web callback and the OpenID
settings specified by Clerk. Declared Graph permissions are delegated `User.Read`
and `email`. Individual organizations may require administrator consent or a
verified Microsoft publisher before allowing their users to authorize the app.

Apple's private-relay sender is `bounces+116872475@clkmail.usegrove.cloud`.
Its Services ID and signing key are associated with Grove's own primary App ID.

Google's last verified JavaScript origin was `https://usegrove.cloud`; its External
audience was published **In production**. Branding linked to the separately published
homepage, [privacy policy](https://usegrove.cloud/privacy) and
[terms](https://usegrove.cloud/terms). Current website source uses
`support@grovenote.app` as the public support contact; publication follows the
normal release process. Update the provider origin and branding links to
`https://grovenote.app` during the coordinated cutover; source changes do not
update Google's console. Its contact is recorded in the private inventory.

Google declares only `openid`, `https://www.googleapis.com/auth/userinfo.email`
and `https://www.googleapis.com/auth/userinfo.profile`. The live authorization
request uses those same scopes, the dedicated Grove client and the exact Clerk
callback above. Google lists zero sensitive or restricted scopes.

## Verification and delivery

For each enabled provider, verify:

1. The provider appears on sign-in and sign-up, and its authorization request uses
   the intended Grove client and exact callback.
2. A real provider sign-in returns to `/app` and can access only that Grove account.
3. From an existing account, connecting another provider preserves both the Clerk
   user ID and `/api/grove/me` account ID. Existing memories remain accessible.
4. Cancelling authorization leaves the session and existing connections usable;
   failed/pending connections are not displayed as verified.
5. A later sign-in through the added provider reaches that same account.
6. Apple's Hide My Email flow can receive verification mail via the registered
   relay source. Microsoft supports both intended account audiences.

Configuration inspection and mocked website checks do not establish successful
real-provider OAuth. Keep completion evidence explicit in the execution status.

### Historical account-linking evidence — October 2026

The Settings UI passed website lint, type checks, production build and the
19-test browser/accessibility suite. All four providers appear on live sign-in
and sign-up. GitHub's real-account sign-in is verified. The existing account now
reports verified connections for Google, Microsoft, Apple and GitHub.

Google's production verification passed:

- Cancelling Google consent preserved the signed-in account and displayed the
  incomplete connection as needing verification.
- Completing account re-verification and Google consent linked the Google identity
  to the original Clerk user and Grove account.
- Signing out and signing back in through Google returned to `/app` with those
  same identifiers. Authenticated `/api/grove/me` and private memory search both
  returned 200; the original zero-item memory collection was unchanged.

Hosting PR #7 and social-login PR #8 are merged into `development`. The website
branch retains their hosting configuration, connected-account panel and completed
Google verification alongside the Sprout identity and Settings retry handling.
The policy pages are live. Google activation is instance configuration and does
not require another website deployment.

Provider instructions: [GitHub](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/github),
[Google](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google),
[Microsoft](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/microsoft),
[Apple](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/apple).
