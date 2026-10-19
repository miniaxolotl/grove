# Social sign-in and connected accounts

Grove uses Clerk's existing sign-in and sign-up components for GitHub, Google,
Microsoft and Apple. Which providers appear is controlled by the Clerk instance,
so provider credentials are configured in Clerk rather than the website bundle.

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

- Website: `https://usegrove.cloud`.
- Clerk application: `app_3KtGcnwE2Yg0P34l9PVij7LnOTS`.
- Production instance: `ins_3Ktp2ZQ986pL3Dmhk7tJkesRR6A`.
- Clerk issuer: `https://clerk.usegrove.cloud`.
- Dedicated Google project: `grove-clerk-auth-2026` (`Grove Authentication`).

All four production connection settings confirm the same exact callback:
`https://clerk.usegrove.cloud/v1/oauth_callback`. Development uses a separate
Clerk instance, with all four shared development connections enabled.

| Provider | Registration requirements | Clerk configuration section |
| --- | --- | --- |
| GitHub | OAuth app, homepage, exact authorization callback, client ID and secret | `connection_oauth_github` |
| Google | Web OAuth client; External audience published to production; Grove branding, authorized origins and exact redirect | `connection_oauth_google` |
| Microsoft | Entra app supporting organizational and personal accounts; web redirect; client-secret value; email verification claims per Clerk's guide | `connection_oauth_microsoft` |
| Apple | App ID with Sign in with Apple, web Services ID, Team ID, Key ID, `.p8` private key, exact return URL and Clerk private-relay email source | `connection_oauth_apple` |

Configure each connection with `enabled: true`, `authenticatable: true`,
`client_id` and `client_secret` together. Apple additionally needs `team_id` and
`key_id`; its `client_secret` is the complete PEM private key, not a manually
generated client-secret JWT. Validate the partial patch with Clerk's dry-run
before applying it. Never include credentials in Git, command-line arguments,
screenshots or public verification receipts. Maintain the private Grove inventory.

Only basic identity/email scopes are needed. Grove does not request repository,
calendar, email inbox or cloud administration access to sign users in.

### Registration status (2026-10-19)

| Provider | Production state | Registration |
| --- | --- | --- |
| GitHub | Enabled; real-account sign-in and authenticated account access passed | OAuth app `3944913`, client `Ov23liUu9OnmcwEZjPSY` |
| Google | Credentials stored; disabled while consent is in Testing and the product privacy page is pending | Project `grove-clerk-auth-2026`, Web client `913831798455-k1uv2lgpv8mffqkfp61pg4saq57mcdr3.apps.googleusercontent.com` |
| Microsoft | Enabled; personal and organizational account audience | App `4772cb1f-a86c-423b-b123-a3efb67e7f4f`, tenant `345c25c1-c7f1-404b-b756-06f33854ab7d` |
| Apple | Enabled; private-relay sender registered and SPF verified | App ID `cloud.usegrove.app`, Services ID `cloud.usegrove.web`, team `Q266AQB5H8`, key `8D923PV78Q` |

Microsoft's client secret expires **2027-04-17**. Rotate it in Entra and Clerk
before that date. Its saved manifest includes `email` and `xms_edov` in both ID
and access tokens, `acceptMappedClaims`, v2 tokens, the web callback and the OpenID
settings specified by Clerk. Declared Graph permissions are delegated `User.Read`
and `email`. Individual organizations may require administrator consent or a
verified Microsoft publisher before allowing their users to authorize the app.

Apple's private-relay sender is `bounces+116872475@clkmail.usegrove.cloud`.
Its Services ID and signing key are associated with Grove's own primary App ID.

Google's authorized JavaScript origin is `https://usegrove.cloud`; consent is
External. The user assigned privacy policies and terms to a separate website
task. After its Grove policy is live, confirm the URL in Google's Branding page
(currently `https://usegrove.cloud/privacy`), publish the OAuth app to production,
then enable `connection_oauth_google` and perform real-account sign-in/linking.
The public support contact selected for those pages is `grove@mawa.dev`.

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

The Settings UI passes website lint, type checks, production build and the
11-test browser/accessibility suite. GitHub's real-account sign-in is verified.
Apple linking reached Apple's authentication page; Microsoft linking reached
Clerk's account re-verification. Completion of those real-account flows and
Google activation remain pending. Hosting PR #7 is still open; any production
rollout of this UI must include its hosting changes at `fb2b990`.

Provider instructions: [GitHub](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/github),
[Google](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google),
[Microsoft](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/microsoft),
[Apple](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/apple).
