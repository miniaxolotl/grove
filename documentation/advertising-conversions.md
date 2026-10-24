# Consent-safe registration measurement

Implemented in source; production requires the protected release/promotion process.
This does not launch or submit any advertising campaign. Google/Meta traffic and
page-view objectives are not evidence of completed-signup optimization.

## Registration boundary

Ordinary sign-up falls back to `/welcome`; explicit connection/authentication
continuations remain authoritative. Sign-in still falls back to `/app`.
`/welcome` is dynamic, private/no-store, no-referrer and excluded from indexing.
The server reads Clerk's authenticated identity and fetches its user/session in
parallel. Eligibility requires:

- Matching user and session IDs, active/unexpired initial session, no impersonator,
  and a user who is neither banned nor locked.
- User age at most 15 minutes, session created at or after the user and within
  60 seconds. Exact boundaries are inclusive; invalid/future timestamps fail closed.
- Provider errors yield no conversion and continue to `/app`; no provider payload
  is logged or serialized. Unauthenticated visitors go to `/sign-up`.

The page contains no name, email, account/session ID, notebook or note content.
Only this server-qualified page mounts the dedicated advertising loader. Default
public-route loading still excludes `/welcome`, authentication, `/app` and `/s`.
An authentication/private client transition or unsafe referrer forces a fresh
`/welcome` document before vendors can load. Authentication and workspace responses
also suppress referrers. **Open your notebook** is a full-document link so vendor
code cannot survive into private notes. The page is usable without JavaScript.

## Delivery and consent

Advertising opt-in, production HTTPS hostname, clean `/welcome` URL and isolated
document are all required. Only standard `utm_*` keys are allowed; fragments and
other query keys suppress measurement. The shared consent policy vetoes DNT/GPC,
opt-out and unavailable storage. Denied/revoked consent is never queued for later
delivery; a newly granted consent can initiate measurement while on the handoff.

The helper waits at most 20 attempts at 500ms intervals for the exact Grove AdRoll
advertiser `ZITLPJB6MZGJLI3HIT3FNG` and pixel `5MRQQSBIQJA4HJWZA64ET3`.
It sends only `adroll.track("pageView", { segment_name: "30a39d31" })`.
Consent and URL safety are rechecked on every retry. Failures do not affect access.
A content-free `grove.registration-conversion.sent=true` sessionStorage receipt
suppresses repeat effects/reloads in that tab; it is not a durable unique-account
ledger or a promise of exactly-once vendor delivery. No monetary value is invented.

The existing GTM `GTM-M5WKD5LZ` AdRoll base tag remains. Published version **3**,
**Allow isolated registration handoff** (24 October 2026), adds only `/welcome`
to its public DOM Ready trigger; no auth/private route is added. The
application emits the conversion directly, not a second GTM conversion tag. Keep
the 90-day conversion audience excluded from the retargeting draft.

## Verification and rollout

- Nine server policy/provider tests demonstrate red/green behavior and cover
  boundaries, returning users, identity mismatches, expiry and provider failures.
- Disposable PostgreSQL suite: 319 passed, four optional S3/broker integrations
  skipped; packed artifacts: nine passed. Root/site lint, types and builds pass.
- Existing website suite: all 223 scenarios pass on isolated ports, including
  consent, private-route isolation and public-to-auth document navigation. An
  interrupted earlier run reported two workspace timeouts; both passed unchanged
  in a focused rerun and the subsequent full run. No workspace repair is claimed.
- Local synthetic SDK probes cover exact payloads, wrong advertiser/pixel, delayed
  SDK, bounded retries, denied/revoked consent, private navigation, unsafe URLs,
  private initial document/referrer, reload receipt and storage/provider failures.
  No live account or synthetic production conversion was created.
- [Desktop/mobile captures](design/screenshots/registration/README.md) are local
  synthetic previews, not production signup evidence.

Follow [hosting/releases](deploy.md). Merge does not itself deploy the site. Do
not bypass frozen selection or activate unrelated pending billing work. After the
admitted production release, verify real signup consent and document isolation
without forging conversion traffic. Retargeting can remain too small to deliver;
pixel-dashboard status may lag actual consent-gated network activity.
