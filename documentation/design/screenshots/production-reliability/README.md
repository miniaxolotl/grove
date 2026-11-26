# Retrieval, freshness and device recovery — 26 November 2026

Synthetic, isolated browser evidence for runtime source
`d8909f349cb4348b80a1185bcfe419f136ac3e23`, following backend
`837cc98`. Actual workspace components use optimized CSS from local build
`LCTM6ETNrUu8OuCUWZ-fR`; the fixture bundles those source files with synthetic
Clerk hooks. Captures were made before committing the equivalent runtime files.
This is not a production deployment or live Clerk/provider qualification.

| Capture                                                     | Scope                                                                                                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Account setting](device-recovery-settings.png)             | 1440×960; explicit default-off consent, storage/expiry and privacy explanation. Enabled only in a disposable browser profile.                                         |
| [Phone setting](device-recovery-phone.png)                  | 349×420 element capture within a 390×900 viewport; the same disclosure and choice, not a separate onboarding flow.                                                    |
| [Failed save and device checkpoint](device-draft-phone.png) | 390×900; a deliberately lost synthetic save response remains Not saved. Device opens a native popover with the completed checkpoint time, separate from server Saved. |
| [Independent HTTP edit](external-edit-freshness.png)        | 1440×960; an untouched visible clean editor adopts a separately authenticated HTTP commit through the real API and disposable non-owner PostgreSQL/RLS role.          |

## Observed boundaries

- Clean external-edit adoption took about **60.0 seconds**, with one detail GET
  and zero browser writes. No reload, focus event or metadata broadcast was used
  between commit and adoption. The existing shared 60-second refresh already met
  this fixture's 65-second budget; no faster polling or push-service fix is claimed.
  The API used the real `Authentication` class with a fixed synthetic token verifier,
  not live Clerk credentials. A separate dirty-editor API case accelerated only its
  timer, retained the complete Markdown source and showed a newer-version notice
  without writing it back.
- Opt-in source and original pending operation survived reload and a controlled
  browser-process restart. Explicit retry reused the lost create operation: two
  requests, one creation identity, no automatic replay on opening the draft.
  Ciphertext envelopes contained no plaintext source; the AES-GCM key refused export.
- Independent IndexedDB adapter instances refused stale sequence writes and late
  writes after scoped or account erasure. Counts/bytes/absolute expiry, corrupted
  ciphertext and missing-key non-replacement were exercised. Offline authorization
  uncertainty kept ciphertext locked; explicit reconnect/unlock recovered it.
  Revoked notebook scope did not restore its source. The actual account-switch UI
  erased that account's ciphertext and key.
- Settings, the opted-in editor and the Device popover were inspected at 1440,
  768, 390 and 320px. No horizontal overflow was observed; Escape returned focus
  from the popover. Checkpoint feedback stays inside the existing status surface,
  not an extra toolbar row. Recovery validation is lazy-loaded: the unchanged Notes
  entry budget passed at approximately 500 KiB gzip.

The device-recovery, native popover, cross-tab disable and keyword-fallback
geometry journeys passed in both Chromium and WebKit. WebKit ran in the existing
Playwright 1.64.1 container because the Linux host lacks its native libraries;
its separate captures were retained outside Git. The linked images above are
Chromium captures. This is browser-engine verification, not physical iPhone testing.

These are synthetic local checks, not real-provider semantic quality, production
p95/capacity, sudden process/power loss, physical-device storage or remote erasure
of a closed/offline browser. The [acceptance design](../../production-reliability.md#regression-and-acceptance-matrix)
keeps those gates separate. Private account/note data and credentials were not used.
